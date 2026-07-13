/**
 * Persistent schedule registry. Lives at
 * `~/.claude/channels/discord-multi/schedules.json` (overridable via
 * MCD_CHANNELS_DIR). Each entry fires a synthetic Discord-style
 * message into a project channel on a recurring schedule, so a
 * project's agent can grind through a backlog without an operator
 * present.
 *
 * Timing: daily at HH:MM, host local zone. Cron support is a small
 * follow-up — `cron` field is reserved in the schema for it.
 *
 * Agent-agnostic by construction: the scheduler dispatches through
 * `ProjectPool.deliver()`, which doesn't know whether the underlying
 * process is `claude`, `openclaw`, or some other CLI. Swapping in a
 * MiniMax-via-Anthropic-API runner per-project is a separate change.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { channelsDir } from './paths.ts'

export const SchedulesFile = (): string => join(channelsDir(), 'schedules.json')

const TimeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '`at` must be HH:MM (24h)')

export const IntervalSchema = z.string().regex(/^every \d+[mh]$/, '`interval` must be "every Xm" or "every Xh"')

const ScheduleSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().regex(/^\d{15,25}$/),
  /** Daily fire time, host local zone, "HH:MM". Mutually exclusive with `interval`. */
  at: TimeOfDaySchema.optional(),
  /** Recurring interval, e.g. "every 30m" or "every 2h". Mutually exclusive with `at`. */
  interval: IntervalSchema.optional(),
  /** Reserved for cron support — unused in v1. */
  cron: z.string().optional(),
  prompt: z.string().min(1),
  /** 'prompt' = send as agent prompt (default). 'inject' = direct session inject with variable substitution. */
  type: z.enum(['prompt', 'inject']).default('prompt'),
  /** For inject-type schedules: the inject-templates.json template id (optional). */
  templateId: z.string().optional(),
  enabled: z.boolean().default(true),
  /** ISO timestamp of the last firing, or null. */
  lastRunAt: z.string().nullable().default(null),
  createdAt: z.string().default(() => new Date().toISOString()),
  /**
   * Optional run cap. After `maxRuns` firings, the schedule auto-pauses
   * so an unattended job can't loop forever. null = no cap.
   */
  maxRuns: z.number().int().positive().nullable().default(null),
  /** Number of successful firings. */
  runCount: z.number().int().nonnegative().default(0),
  /**
   * When true, the Scheduler will override this schedule's interval with
   * a pattern-mining recommendation (from the behaviour-mirror pattern
   * cache) if one is available for the associated project.
   */
  autoSchedule: z.boolean().optional(),
  /** When true, the schedule fires only when the target project is idle (no in-flight turn or recent transcript write). */
  onlyWhenIdle: z.boolean().optional(),
  /** Grace window in minutes for the idle gate. Defaults to 5 when `onlyWhenIdle` is true and this is unset. */
  idleGraceMinutes: z.number().int().positive().optional(),
  /** ISO timestamp of the most recent busy-skip; a later successful fire updates lastRunAt past it. */
  lastSkippedAt: z.string().nullable().optional(),
  /**
   * Optional auto-pause pattern. After a fire, if the project's outbound
   * reply matches this regex (case-insensitive), the scheduler disables
   * the schedule deterministically — no more post-completion fires.
   */
  stopOnReply: z.string().refine((p) => { try { new RegExp(p, 'i'); return true } catch { return false } }, 'stopOnReply must be a valid regex').optional(),
  /**
   * ISO timestamp set when the scheduler suspended this schedule
   * because the target project's specclaw loop halted on a guardrail.
   * Guards against escalating the same halt twice; `schedule resume`
   * clears it.
   */
  escalatedAt: z.string().nullable().optional(),
}).refine(
  (s) => [s.at, s.interval, s.cron].filter((v) => v !== undefined).length === 1,
  { message: 'Exactly one of `at`, `interval`, or `cron` must be set' },
)
export type Schedule = z.infer<typeof ScheduleSchema>

export const SchedulesFileSchema = z.object({
  version: z.literal(1).default(1),
  schedules: z.array(ScheduleSchema).default([]),
})
export type SchedulesFileShape = z.infer<typeof SchedulesFileSchema>

const EMPTY: SchedulesFileShape = SchedulesFileSchema.parse({})

export function loadSchedules(path: string = SchedulesFile()): SchedulesFileShape {
  if (!existsSync(path)) return structuredClone(EMPTY)
  const raw = readFileSync(path, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  const result = SchedulesFileSchema.safeParse(parsed)
  if (!result.success) throw new Error(`${path} failed schema:\n${result.error.toString()}`)
  return result.data
}

export function saveSchedules(file: SchedulesFileShape, path: string = SchedulesFile()): void {
  const validated = SchedulesFileSchema.parse(file)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

/**
 * Compute the next fire time (epoch ms) for a schedule entry.
 *
 * - `at` entries: daily HH:MM, host local zone. If `now` is past today's
 *   slot, next fire is tomorrow's.
 * - `interval` entries: `lastRunAt + duration` if `lastRunAt` is set,
 *   otherwise `now` (fire immediately on first tick).
 */
export function nextFireMs(
  entry: Pick<Schedule, 'at' | 'interval' | 'lastRunAt'>,
  now: Date = new Date(),
): number {
  if (entry.interval !== undefined) {
    const match = entry.interval.match(/^every (\d+)([mh])$/)
    if (!match) throw new Error(`Invalid interval: ${entry.interval}`)
    const value = Number(match[1])
    const unit = match[2] as 'm' | 'h'
    const durationMs = unit === 'h' ? value * 60 * 60 * 1000 : value * 60 * 1000
    if (entry.lastRunAt) {
      return new Date(entry.lastRunAt).getTime() + durationMs
    }
    return now.getTime()
  }
  const at = entry.at!
  const [h, m] = at.split(':').map((s) => Number(s))
  const target = new Date(now)
  target.setHours(h ?? 0, m ?? 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime()
}

/**
 * Returns true if `entry.lastRunAt` exists AND `now - lastRunAt < durationMs`.
 */
export function hasFiredWithin(entry: Schedule, durationMs: number, now: Date = new Date()): boolean {
  if (!entry.lastRunAt) return false
  return now.getTime() - new Date(entry.lastRunAt).getTime() < durationMs
}

/**
 * Has this schedule fired today already? Used to dedup ticks within
 * the same minute and to guard against multiple-fire bugs across
 * bot restarts. Compares calendar day in host local zone.
 */
export function hasFiredToday(s: Schedule, now: Date = new Date()): boolean {
  if (!s.lastRunAt) return false
  const last = new Date(s.lastRunAt)
  return last.toDateString() === now.toDateString()
}

/** A fresh id for new schedules. Short, sortable-ish. */
export function newScheduleId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Validate a 5-field cron expression. Returns an error string on failure,
 * null on success.
 * Format: `minute hour day-of-month month day-of-week`
 * Each field: `*`, `N`, `N-M`, `* /N` (no space), `N,M,...`, `N-M/S`
 */
export function validateCron(expr: string): string | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return `cron must have 5 fields (got ${fields.length}): "minute hour day month weekday"`
  const ranges = [
    { name: 'minute', min: 0, max: 59 },
    { name: 'hour', min: 0, max: 23 },
    { name: 'day', min: 1, max: 31 },
    { name: 'month', min: 1, max: 12 },
    { name: 'weekday', min: 0, max: 7 },
  ]
  for (let i = 0; i < 5; i++) {
    const err = validateCronField(fields[i]!, ranges[i]!)
    if (err) return `cron field ${i + 1} (${ranges[i]!.name}): ${err}`
  }
  return null
}

function validateCronField(field: string, { min, max }: { name: string; min: number; max: number }): string | null {
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? Number(stepMatch[2]) : null
    const base = stepMatch ? stepMatch[1]! : part
    if (step !== null && (step <= 0 || step > max - min + 1)) return `step ${step} out of range`
    if (base === '*') continue
    const rangeMatch = base.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const lo = Number(rangeMatch[1]), hi = Number(rangeMatch[2])
      if (lo < min || hi > max || lo > hi) return `range ${base} invalid (allowed ${min}-${max})`
      continue
    }
    const n = Number(base)
    if (!Number.isInteger(n) || n < min || n > max) return `value ${base} invalid (allowed ${min}-${max})`
  }
  return null
}

/**
 * Returns true if `expr` matches the given `now` date (minute-level precision).
 * Assumes a valid 5-field cron expression (validate first with `validateCron`).
 */
export function matchesCron(expr: string, now: Date): boolean {
  const [mField, hField, domField, monField, dowField] = expr.trim().split(/\s+/)
  return (
    cronFieldMatches(mField!, now.getMinutes(), 0, 59) &&
    cronFieldMatches(hField!, now.getHours(), 0, 23) &&
    cronFieldMatches(domField!, now.getDate(), 1, 31) &&
    cronFieldMatches(monField!, now.getMonth() + 1, 1, 12) &&
    cronFieldMatches(dowField!, now.getDay(), 0, 7)
  )
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/)
    const step = stepMatch ? Number(stepMatch[2]) : 1
    const base = stepMatch ? stepMatch[1]! : part
    let lo = min, hi = max
    if (base !== '*') {
      const rangeMatch = base.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        lo = Number(rangeMatch[1])
        hi = Number(rangeMatch[2])
      } else {
        lo = hi = Number(base)
      }
    }
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true
  }
  return false
}
