/**
 * Lightweight, persistent scheduler. Ticks every 60s, walks the
 * schedules table, and fires anything that's due. Each fire is a
 * synthetic Discord-shaped envelope dispatched through the project
 * pool — same code path a real Discord message would take, so the
 * underlying agent (claude / openclaw / future MiniMax runner)
 * doesn't need to know the request was scheduled.
 *
 * Survives bot restarts: lastRunAt + hasFiredToday() means a missed
 * tick (e.g. host was asleep at 09:00) doesn't double-fire when the
 * bot comes back up at 09:30.
 */
import * as fs from 'fs'
import * as path from 'path'
import {
  hasFiredToday,
  hasFiredWithin,
  loadSchedules,
  nextFireMs,
  saveSchedules,
  type Schedule,
} from './schedules-config.ts'
import type { InboundEnvelope } from './project-process.ts'

function appendScheduleLog(chatId: string, scheduledAt: string, firedAt: string, status: 'ok' | 'stalled' | 'skipped', durationMs: number): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return
  try {
    const entry = JSON.stringify({ chatId, scheduledAt, firedAt, status, durationMs }) + '\n'
    fs.appendFileSync(path.join(mcdDir, 'schedule-log.jsonl'), entry)
  } catch {
    // Non-fatal — don't break scheduler on log failure
  }
}

export interface SchedulerDeps {
  /**
   * Inject a synthetic message into the project pool. Should resolve
   * once delivery is queued — the scheduler doesn't await replies.
   */
  deliver: (chatId: string, envelope: InboundEnvelope) => Promise<void>
  /** Diagnostics. Defaults to stderr with a `[scheduler]` prefix. */
  log?: (msg: string) => void
  /** Optional hook called after each successful fire. */
  onFire?: (chatId: string, jobId: string, scheduledTime: string) => void
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly log: (msg: string) => void

  constructor(private readonly deps: SchedulerDeps) {
    this.log = deps.log ?? ((m) => process.stderr.write(`[scheduler] ${m}\n`))
  }

  /** Begin ticking. Idempotent. */
  start(intervalMs = 60_000): void {
    if (this.timer) return
    // Run a tick immediately so a schedule whose slot is in the past
    // (e.g. bot started right after 09:00) fires within seconds rather
    // than waiting another full minute.
    void this.tick()
    this.timer = setInterval(() => void this.tick(), intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    this.log('started')
  }

  /** Stop ticking. */
  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.log('stopped')
  }

  /** One pass over the schedules table. Public for testing + manual run. */
  async tick(): Promise<void> {
    let file
    try {
      file = loadSchedules()
    } catch (err) {
      this.log(`load failed: ${err}`)
      return
    }

    const now = new Date()
    let dirty = false

    for (const s of file.schedules) {
      if (!s.enabled) continue
      if (!isDue(s, now)) continue

      this.log(`firing schedule ${s.id} → chat ${s.chatId}`)
      const fireStart = Date.now()
      try {
        await this.deps.deliver(s.chatId, this.envelopeFor(s, now))
        appendScheduleLog(s.chatId, s.at ?? s.interval ?? 'unknown', now.toISOString(), 'ok', Date.now() - fireStart)
        this.deps.onFire?.(s.chatId, s.id, now.toISOString())
        s.lastRunAt = now.toISOString()
        s.runCount = s.runCount + 1
        if (s.maxRuns !== null && s.runCount >= s.maxRuns) {
          s.enabled = false
          this.log(`schedule ${s.id} reached maxRuns=${s.maxRuns}, auto-paused`)
        }
        dirty = true
      } catch (err) {
        this.log(`fire failed for ${s.id}: ${(err as Error).message}`)
        appendScheduleLog(s.chatId, s.at ?? s.interval ?? 'unknown', now.toISOString(), 'stalled', Date.now() - fireStart)
      }
    }

    if (dirty) {
      try {
        saveSchedules(file)
      } catch (err) {
        this.log(`persist failed: ${err}`)
      }
    }
  }

  private envelopeFor(s: Schedule, now: Date): InboundEnvelope {
    const ts = now.toISOString()
    const footer =
      '\n\n[Scheduled task — REQUIRED: you MUST call mcp__mcd__reply when done. ' +
      'mcp__mcd__reply is the ONLY way your output reaches Discord. ' +
      'Include all key results: PR URLs, branch names, error messages, or "no changes needed". ' +
      'If you created or updated a PR, post the full URL. ' +
      'Finishing without calling mcp__mcd__reply means the operator sees nothing.]'
    return {
      messageId: `sched-${s.id}-${now.getTime()}`,
      userId: '__mcd_scheduler__',
      username: 'scheduler',
      content: s.prompt + footer,
      ts,
    }
  }
}

/**
 * Whether a schedule should fire on this tick. Conditions:
 *  - enabled
 *  - for `at` entries: daily-at-HH:MM has already passed for today's
 *    local-zone day and we haven't fired today yet
 *  - for `interval` entries: lastRunAt + duration <= now
 *
 * Cron support (when added) plugs in here.
 */
function isDue(s: Schedule, now: Date): boolean {
  if (!s.enabled) return false
  if (s.interval !== undefined) {
    const match = s.interval.match(/^every (\d+)([mh])$/)
    if (!match) return false
    const value = Number(match[1])
    const unit = match[2] as 'm' | 'h'
    const durationMs = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000
    if (hasFiredWithin(s, durationMs, now)) return false
    return now.getTime() >= nextFireMs(s, now)
  }
  // at-based daily schedule
  if (hasFiredToday(s, now)) return false
  // Today's target time (next-fire returns tomorrow's slot if today's
  // is past, so we have to compute today's slot independently).
  const [h, m] = s.at!.split(':').map((x) => Number(x))
  const todayTarget = new Date(now)
  todayTarget.setHours(h ?? 0, m ?? 0, 0, 0)
  return now.getTime() >= todayTarget.getTime()
}

// Re-export for callers that want the helper without pulling
// schedules-config directly.
export { nextFireMs }
