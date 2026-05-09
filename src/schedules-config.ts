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

const ScheduleSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().regex(/^\d{15,25}$/),
  /** Daily fire time, host local zone, "HH:MM". */
  at: TimeOfDaySchema,
  /** Reserved for cron support — unused in v1. */
  cron: z.string().optional(),
  prompt: z.string().min(1),
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
})
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
 * Compute the next fire time (epoch ms) for a daily HH:MM schedule
 * given a `now` reference. If `now` is past today's slot, the next
 * fire is tomorrow's. Returns wall-clock host time.
 */
export function nextFireMs(at: string, now: Date = new Date()): number {
  const [h, m] = at.split(':').map((s) => Number(s))
  const target = new Date(now)
  target.setHours(h ?? 0, m ?? 0, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime()
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
