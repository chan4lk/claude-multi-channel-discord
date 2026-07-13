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
  matchesCron,
  nextFireMs,
  saveSchedules,
  type Schedule,
} from './schedules-config.ts'
import type { InboundEnvelope } from './project-process.ts'

function resolveInjectVars(template: string, slug: string): string {
  const now = new Date()
  return template
    .replace(/\{\{slug\}\}/g, slug)
    .replace(/\{\{date\}\}/g, now.toLocaleDateString('en-CA'))
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString())
    // turnsToday and contextPct require fleet data — left as-is per spec
}

function appendScheduleLog(chatId: string, scheduledAt: string, firedAt: string, status: 'ok' | 'stalled' | 'skipped', durationMs: number, reason?: string): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return
  try {
    const entry = JSON.stringify({ chatId, scheduledAt, firedAt, status, durationMs, ...(reason ? { reason } : {}) }) + '\n'
    fs.appendFileSync(path.join(mcdDir, 'schedule-log.jsonl'), entry)
  } catch {
    // Non-fatal — don't break scheduler on log failure
  }
}

function appendSchedulerHistory(
  s: Schedule,
  slug: string | undefined,
  firedAt: string,
  injected: boolean,
  error?: string,
): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return
  try {
    const entry = JSON.stringify({
      ts: firedAt,
      scheduleId: s.id,
      slug: slug ?? s.chatId,
      interval: s.interval ?? s.at ?? null,
      message: s.prompt.slice(0, 200),
      injected,
      error: error ?? null,
    }) + '\n'
    fs.appendFileSync(path.join(mcdDir, 'scheduler-history.jsonl'), entry)
  } catch {
    // Non-fatal
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
  /** Resolve chatId → slug (for inject variable substitution). */
  slugForChatId?: (chatId: string) => string | undefined
  /**
   * Busy probe for idle-gated schedules. Returns true when the target
   * project has a live process doing work (in-flight turn or fresh
   * transcript write within graceMs). Absent = fail-open (gated
   * schedules fire as if idle).
   */
  isBusy?: (chatId: string, graceMs: number) => boolean
  /**
   * Notice hook fired when a stopOnReply pattern matches and the
   * schedule is auto-paused. Used by the server to post a one-line
   * notice to the master channel. Absent = pause happens silently.
   */
  onAutoPause?: (schedule: Schedule, pattern: string) => void
  /**
   * Specclaw halt probe. Returns halted state for the target chat's
   * project (guardrail halt: verify red, open issues, failed tasks).
   * Absent = fail-open (schedules fire as before).
   */
  checkHalt?: (chatId: string) => { halted: boolean; change?: string; evidence?: string }
  /**
   * Escalation hook fired once per halt when a due schedule is
   * suspended because its target project's specclaw loop halted.
   * Used by the server to post a 🛑 notice to the master channel.
   */
  onEscalate?: (schedule: Schedule, change: string, evidence: string) => void
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly log: (msg: string) => void

  // Pattern-mining cache: slug → recommended interval in minutes
  private patternCache = new Map<string, number>()

  // Tracks injection timestamps per chatId for the 60-min hard cap
  private readonly injectionLog = new Map<string, number[]>()

  constructor(private readonly deps: SchedulerDeps) {
    this.log = deps.log ?? ((m) => process.stderr.write(`[scheduler] ${m}\n`))
  }

  /**
   * Update the pattern-mining recommendation cache. Called externally
   * (e.g. from a nightly behaviour-mirror analysis pass). Maps
   * slug → recommended interval in minutes.
   */
  setPatternCache(cache: Map<string, number>): void {
    this.patternCache = cache
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

      // If autoSchedule is enabled, override the interval with the pattern-mining
      // recommendation for this project's slug (if one exists in the cache).
      let effectiveSchedule: Schedule = s
      if ((s as Schedule & { autoSchedule?: boolean }).autoSchedule && s.interval !== undefined) {
        const slug = this.deps.slugForChatId?.(s.chatId)
        if (slug) {
          const mins = this.patternCache.get(slug)
          if (mins !== undefined) {
            effectiveSchedule = { ...s, interval: `every ${mins}m` as Schedule['interval'] }
          }
        }
      }
      if (!isDue(effectiveSchedule, now)) continue

      if (this.deps.checkHalt) {
        const halt = this.deps.checkHalt(s.chatId)
        if (halt.halted) {
          if (!s.escalatedAt) {
            s.escalatedAt = now.toISOString()
            s.enabled = false
            dirty = true
            this.log(`schedule ${s.id} suspended — specclaw loop halted on ${halt.change ?? 'unknown'}`)
            appendScheduleLog(s.chatId, s.at ?? s.interval ?? 'unknown', now.toISOString(), 'skipped', 0, 'specclaw-halted')
            this.deps.onEscalate?.(s, halt.change ?? 'unknown', halt.evidence ?? 'unknown')
          }
          continue
        }
      }

      if (effectiveSchedule.onlyWhenIdle && this.deps.isBusy) {
        const graceMs = (effectiveSchedule.idleGraceMinutes ?? 5) * 60_000
        if (this.deps.isBusy(s.chatId, graceMs)) {
          this.log(`skipping schedule ${s.id} → chat ${s.chatId} (busy)`)
          appendScheduleLog(s.chatId, s.at ?? s.interval ?? 'unknown', now.toISOString(), 'skipped', 0, 'busy')
          s.lastSkippedAt = now.toISOString()
          dirty = true
          continue
        }
      }

      this.log(`firing schedule ${s.id} → chat ${s.chatId}`)
      const fireStart = Date.now()
      const slug = this.deps.slugForChatId?.(s.chatId)
      try {
        await this.deps.deliver(s.chatId, this.envelopeFor(s, now))
        appendScheduleLog(s.chatId, s.at ?? s.interval ?? 'unknown', now.toISOString(), 'ok', Date.now() - fireStart)
        appendSchedulerHistory(s, slug, now.toISOString(), true)
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
        appendSchedulerHistory(s, slug, now.toISOString(), false, (err as Error).message)
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

  /**
   * Feed an outbound reply into the stopOnReply matcher. Called by the
   * server for every text reply a project emits. For each enabled
   * schedule on this chat with a stopOnReply pattern and at least one
   * prior fire, a case-insensitive match disables the schedule and
   * persists — deterministic auto-pause, no agent cooperation needed.
   * Cheap when nothing matches; never throws on a bad pattern.
   */
  noteReply(chatId: string, text: string): void {
    let file
    try {
      file = loadSchedules()
    } catch (err) {
      this.log(`noteReply load failed: ${err}`)
      return
    }
    let dirty = false
    for (const s of file.schedules) {
      if (s.chatId !== chatId || !s.enabled || !s.stopOnReply || !s.lastRunAt) continue
      let re: RegExp
      try {
        re = new RegExp(s.stopOnReply, 'i')
      } catch {
        this.log(`noteReply: invalid stopOnReply pattern on ${s.id}, skipping`)
        continue
      }
      if (!re.test(text)) continue
      s.enabled = false
      dirty = true
      this.log(`schedule ${s.id} auto-paused — reply matched /${s.stopOnReply}/`)
      this.deps.onAutoPause?.(s, s.stopOnReply)
    }
    if (dirty) {
      try {
        saveSchedules(file)
      } catch (err) {
        this.log(`noteReply persist failed: ${err}`)
      }
    }
  }

  /**
   * Register a periodic sweep that injects behaviour-mirror messages into
   * autonomous-mode projects. Safe to call once at startup — idempotent
   * per Scheduler instance (re-registering creates an additional timer, so
   * don't call more than once).
   */
  registerBehaviourMirrorSweep(opts: {
    pool: { deliver: (chatId: string, envelope: InboundEnvelope) => Promise<void>; isCircuitOpen?: (chatId: string) => boolean }
    getChannels: () => import('./channels-config.ts').ChannelsConfig
    saveChannels: (cfg: import('./channels-config.ts').ChannelsConfig) => void
    getVoiceModel: () => import('./behaviour-mirror.ts').VoiceModel
    mcdDir: string
    sweepIntervalMs?: number
  }): void {
    const intervalMs = opts.sweepIntervalMs ?? 30 * 60 * 1000
    const timer = setInterval(() => void this.runBehaviourMirrorSweep(opts), intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.log('behaviour-mirror sweep registered')
  }

  private async runBehaviourMirrorSweep(opts: {
    pool: { deliver: (chatId: string, envelope: InboundEnvelope) => Promise<void>; isCircuitOpen?: (chatId: string) => boolean }
    getChannels: () => import('./channels-config.ts').ChannelsConfig
    saveChannels: (cfg: import('./channels-config.ts').ChannelsConfig) => void
    getVoiceModel: () => import('./behaviour-mirror.ts').VoiceModel
    mcdDir: string
  }): Promise<void> {
    const { buildInjectionMessage } = await import('./behaviour-mirror.ts')
    const config = opts.getChannels()
    const now = Date.now()
    const cooldownDefault = (config.defaults as { injectCooldownMinutes?: number } | undefined)?.injectCooldownMinutes ?? 60

    for (const [chatId, project] of Object.entries(config.projects)) {
      if (project.heartbeat?.mode !== 'autonomous') continue
      if (opts.pool.isCircuitOpen?.(chatId)) continue

      const cooldownMs = ((project as { injectCooldownMinutes?: number }).injectCooldownMinutes ?? cooldownDefault) * 60_000
      const lastInjectedAt = (project as { lastInjectedAt?: string }).lastInjectedAt
      if (lastInjectedAt) {
        const lastMs = Date.parse(lastInjectedAt)
        if (!isNaN(lastMs) && now - lastMs < cooldownMs) continue
      }

      // Hard cap: ≤3 injections in any 60-min rolling window
      const window60 = now - 60 * 60 * 1000
      const recent = (this.injectionLog.get(chatId) ?? []).filter((t) => t > window60)
      if (recent.length >= 3) continue

      const voiceModel = opts.getVoiceModel()
      if (voiceModel.sentences.length === 0) continue

      const text = buildInjectionMessage(project.slug, [], voiceModel)
      if (!text) continue

      try {
        const envelope: InboundEnvelope = {
          messageId: `auto-inject-${chatId}-${now}`,
          userId: '__mcd_auto__',
          username: 'auto',
          content: text,
          ts: new Date(now).toISOString(),
        }
        await opts.pool.deliver(chatId, envelope)
        recent.push(now)
        this.injectionLog.set(chatId, recent)

        // Persist lastInjectedAt
        const latest = opts.getChannels()
        opts.saveChannels({
          ...latest,
          projects: {
            ...latest.projects,
            [chatId]: { ...latest.projects[chatId]!, lastInjectedAt: new Date(now).toISOString() },
          },
        })
        this.log(`[auto-inject] ${project.slug}`)
      } catch (err) {
        this.log(`[auto-inject] failed for ${project.slug}: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Register a nightly cron that writes/updates GOALS.md for every project.
   * Fires once per night at `opts.cronHour:00` local time (default 02:00).
   * Safe to call once at startup — re-registering creates an additional timer.
   */
  registerGoalReconcileCron(opts: {
    mcdDir: string
    getChannels: () => import('./channels-config.ts').ChannelsConfig
    patternMiner: (slug: string, mcdDir: string) => Promise<import('./pattern-mining.ts').PatternResult>
    cronHour?: number   // default 2 (02:00 local)
  }): void {
    // Register a daily HH:MM schedule that fires at opts.cronHour:00
    // We use setInterval with 60s checks to see if it's 02:00 local
    const timer = setInterval(() => {
      const now = new Date()
      if (now.getHours() === (opts.cronHour ?? 2) && now.getMinutes() < 2) {
        void this.runGoalReconcile(opts)
      }
    }, 60_000)
    if (typeof timer.unref === 'function') timer.unref()
    this.log('goal reconcile cron registered (02:00 local)')
  }

  private async runGoalReconcile(opts: {
    mcdDir: string
    getChannels: () => import('./channels-config.ts').ChannelsConfig
    patternMiner: (slug: string, mcdDir: string) => Promise<import('./pattern-mining.ts').PatternResult>
  }): Promise<void> {
    const { join } = await import('node:path')
    const { readFileSync, writeFileSync, existsSync, readdirSync } = await import('node:fs')
    const config = opts.getChannels()

    for (const project of Object.values(config.projects)) {
      const slug = project.slug
      const projectCwd = join(opts.mcdDir, 'projects', slug)
      const specclawDir = join(projectCwd, '.specclaw')
      const backlogPath = join(projectCwd, 'BACKLOG.md')
      const hasSpecclaw = existsSync(join(specclawDir, 'STATUS.md'))
      const hasBacklog = existsSync(backlogPath)
      if (!hasSpecclaw && !hasBacklog) continue

      // Parse proposals from STATUS.md
      const proposals: Array<{ name: string; done: boolean }> = []
      if (hasSpecclaw) {
        try {
          const changesDir = join(specclawDir, 'changes')
          if (existsSync(changesDir)) {
            for (const change of readdirSync(changesDir)) {
              const statusFile = join(changesDir, change, 'status.md')
              if (!existsSync(statusFile)) continue
              const text = readFileSync(statusFile, 'utf-8')
              const verifyGreen = /\|\s*Verify\s*\|\s*🟢/.test(text)
              proposals.push({ name: change, done: verifyGreen })
            }
          }
        } catch { /* skip */ }
      }

      // Get pattern-mining data
      let scheduling = ''
      try {
        const pattern = await opts.patternMiner(slug, opts.mcdDir)
        scheduling = [
          `## Scheduling`,
          `- **Recommended interval:** ${pattern.recommendedIntervalMinutes} min`,
          `- **Peak hour:** ${String(pattern.peakHour).padStart(2, '0')}:00 UTC`,
          `- **Avg turns/day:** ${pattern.avgTurnsPerDay.toFixed(1)}`,
          `- **Last updated:** ${new Date().toISOString()}`,
        ].join('\n')
      } catch { /* skip */ }

      // Read existing GOALS.md to preserve non-managed sections
      const goalsPath = join(projectCwd, 'GOALS.md')
      let preserved = ''
      if (existsSync(goalsPath)) {
        try {
          const existing = readFileSync(goalsPath, 'utf-8')
          // Preserve sections that are NOT ## Proposals or ## Scheduling
          const lines = existing.split('\n')
          let inManaged = false
          const kept: string[] = []
          for (const line of lines) {
            if (line.startsWith('# Goals:') || line.startsWith('## Proposals') || line.startsWith('## Scheduling')) {
              inManaged = true
              continue
            }
            if (line.startsWith('## ') && inManaged) inManaged = false
            if (!inManaged) kept.push(line)
          }
          preserved = kept.join('\n').trim()
        } catch { /* skip */ }
      }

      // Build proposals section
      const proposalLines = proposals
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => `- [${p.done ? 'x' : ' '}] ${p.name}`)
        .join('\n')

      // BACKLOG summary line for projects with BACKLOG.md
      let backlogSummary = ''
      if (hasBacklog) {
        try {
          const bl = readFileSync(backlogPath, 'utf-8')
          const done = (bl.match(/Status.*\[x\] done/g) ?? []).length
          const pending = (bl.match(/Status.*\[\s*\] pending/g) ?? []).length
          backlogSummary = `\n- **BACKLOG.md:** ${done} done / ${pending} pending`
        } catch { /* skip */ }
      }

      const sections = [
        `# Goals: ${slug}`,
        '',
        scheduling,
        '',
        `## Proposals`,
        proposalLines || '_(no specclaw changes yet)_',
        backlogSummary,
        '',
        preserved,
      ].filter((s) => s !== undefined).join('\n').trimEnd() + '\n'

      try {
        writeFileSync(goalsPath, sections, { encoding: 'utf-8' })
        this.log(`[goal-reconcile] wrote GOALS.md for ${slug}`)
      } catch (err) {
        this.log(`[goal-reconcile] failed for ${slug}: ${(err as Error).message}`)
      }
    }
  }

  private envelopeFor(s: Schedule, now: Date): InboundEnvelope {
    const ts = now.toISOString()
    let content: string
    if (s.type === 'inject') {
      const slug = this.deps.slugForChatId?.(s.chatId) ?? s.chatId
      content = resolveInjectVars(s.prompt, slug)
    } else {
      const footer =
        '\n\n[Scheduled task — REQUIRED: you MUST call mcp__mcd__reply when done. ' +
        'mcp__mcd__reply is the ONLY way your output reaches Discord. ' +
        'Include all key results: PR URLs, branch names, error messages, or "no changes needed". ' +
        'If you created or updated a PR, post the full URL. ' +
        'Finishing without calling mcp__mcd__reply means the operator sees nothing.]'
      content = s.prompt + footer
    }
    return {
      messageId: `sched-${s.id}-${now.getTime()}`,
      userId: '__mcd_scheduler__',
      username: 'scheduler',
      content,
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
  if (s.cron !== undefined) {
    // Cron fires at most once per minute. Dedup by checking lastRunAt is not this same minute.
    if (s.lastRunAt) {
      const last = new Date(s.lastRunAt)
      if (
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate() &&
        last.getHours() === now.getHours() &&
        last.getMinutes() === now.getMinutes()
      ) return false
    }
    return matchesCron(s.cron, now)
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
