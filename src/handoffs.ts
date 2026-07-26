/**
 * Handoff registry — tracked collaboration handoffs between project sessions
 * and external bot peers.
 * File: <MCD_CHANNELS_DIR>/shared/handoffs.json
 *
 * Lifecycle: pending → done (explicit `handoff_complete` or implicit reply
 * detection) | expired (sweep escalation).
 *
 * Sweep policy: nag the receiver once when a pending handoff is older than
 * `timeoutMs` (persists `naggedAt`), escalate to master and mark `expired`
 * at 2× `timeoutMs`. Each transition fires at most once per handoff —
 * re-running the sweep never duplicates actions.
 *
 * Constraints:
 *   - Closed (done/expired) records are pruned on save: older than 30 days,
 *     or oldest-first beyond 200 closed entries. Pending records never pruned.
 *   - Writes are atomic (tmp + rename). Directory is created on first write.
 *   - Reads are fail-open: absent or corrupt file → empty registry (stderr
 *     warning on corruption); the next write rewrites the file clean.
 *   - Decision logic takes an injectable clock (`nowMs` param) — `Date.now()`
 *     appears only as a default argument.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { handoffsPath } from './paths.ts'

const CLOSED_MAX_ENTRIES = 200
const CLOSED_MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000  // 30 days

export type HandoffTarget =
  | { kind: 'project'; slug: string; chatId: string }
  | { kind: 'botPeer'; botId: string; chatId: string }

export type HandoffState = 'pending' | 'done' | 'expired'

export interface HandoffRecord {
  id: string               // "h-<base36ts>-<hex4>"
  from: string             // source project slug
  to: HandoffTarget
  task: string
  state: HandoffState
  createdAt: string        // ISO timestamp
  naggedAt?: string        // ISO — set once by the sweep's nag transition
  closedAt?: string        // ISO — set when state leaves 'pending'
  outcome?: string
}

export interface HandoffSweepAction {
  kind: 'nag' | 'escalate'
  record: HandoffRecord
}

/**
 * Load the registry from disk.
 * Fail-open: absent file → empty; corrupt file → empty with a stderr warning
 * (the next save rewrites it clean).
 */
export function loadRegistry(): HandoffRecord[] {
  const filePath = handoffsPath()
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return []  // no registry yet
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed as HandoffRecord[]
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error(`[handoffs] corrupt registry at ${filePath} — treating as empty (${detail})`)
    return []
  }
}

/** Timestamp used for prune-age ordering of a closed record. */
function closedAtMs(record: HandoffRecord): number {
  return Date.parse(record.closedAt ?? record.createdAt)
}

/**
 * Prune closed (done/expired) records: drop any older than 30 days, then
 * drop oldest-first beyond 200 entries. Pending records are never pruned.
 */
function pruneClosed(records: HandoffRecord[], nowMs: number): HandoffRecord[] {
  const kept = records.filter(
    r => r.state === 'pending' || nowMs - closedAtMs(r) <= CLOSED_MAX_AGE_MS,
  )
  const closed = kept.filter(r => r.state !== 'pending')
  if (closed.length <= CLOSED_MAX_ENTRIES) return kept
  const oldestFirst = [...closed].sort((a, b) => closedAtMs(a) - closedAtMs(b))
  const drop = new Set(oldestFirst.slice(0, closed.length - CLOSED_MAX_ENTRIES).map(r => r.id))
  return kept.filter(r => !drop.has(r.id))
}

/**
 * Persist the registry atomically (tmp + rename), creating the shared/
 * directory if absent. Closed records are pruned per NFR1 before writing.
 */
export function saveRegistry(records: HandoffRecord[], nowMs: number = Date.now()): void {
  const filePath = handoffsPath()
  mkdirSync(dirname(filePath), { recursive: true })
  const pruned  = pruneClosed(records, nowMs)
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(pruned, null, 2) + '\n', 'utf8')
  renameSync(tmpPath, filePath)
}

/**
 * Create a pending handoff record, assign its id, and persist it.
 */
export function createHandoff(
  { from, to, task }: { from: string; to: HandoffTarget; task: string },
  nowMs: number = Date.now(),
): HandoffRecord {
  const record: HandoffRecord = {
    id: `h-${nowMs.toString(36)}-${randomBytes(2).toString('hex')}`,
    from,
    to,
    task,
    state: 'pending',
    createdAt: new Date(nowMs).toISOString(),
  }
  const records = loadRegistry()
  records.push(record)
  saveRegistry(records, nowMs)
  return record
}

/**
 * Mark a pending handoff done. Idempotent: an already-closed (done/expired)
 * record is returned unchanged with no error; an unknown id returns null.
 */
export function completeHandoff(
  id: string,
  outcome?: string,
  nowMs: number = Date.now(),
): HandoffRecord | null {
  const records = loadRegistry()
  const record  = records.find(r => r.id === id)
  if (!record) return null
  if (record.state !== 'pending') return record  // idempotent no-op
  record.state    = 'done'
  record.closedAt = new Date(nowMs).toISOString()
  if (outcome !== undefined) record.outcome = outcome
  saveRegistry(records, nowMs)
  return record
}

/**
 * Return ids of pending handoffs targeted at `chatId` whose exact `#<id>`
 * marker appears in `text`. Loop safety: only *pending* records for that
 * channel can match — arbitrary `#h-…` text never matches a closed record.
 */
export function matchPendingIds(chatId: string, text: string): string[] {
  return loadRegistry()
    .filter(r => r.state === 'pending' && r.to.chatId === chatId && text.includes(`#${r.id}`))
    .map(r => r.id)
}

/**
 * Sweep pending handoffs against the timeout policy:
 *   - age ≥ 2× timeout → escalate action; record becomes `expired` (closedAt set)
 *   - age ≥ timeout and not yet nagged → nag action; `naggedAt` persisted
 * Idempotent across repeated runs: nag fires once (naggedAt latch), escalate
 * fires once (record leaves `pending`). Persists only when something changed.
 */
export function sweepHandoffs(nowMs: number, timeoutMs: number): HandoffSweepAction[] {
  const records = loadRegistry()
  const actions: HandoffSweepAction[] = []
  let changed = false
  for (const record of records) {
    if (record.state !== 'pending') continue
    const ageMs = nowMs - Date.parse(record.createdAt)
    if (ageMs >= 2 * timeoutMs) {
      record.state    = 'expired'
      record.closedAt = new Date(nowMs).toISOString()
      actions.push({ kind: 'escalate', record })
      changed = true
    } else if (ageMs >= timeoutMs && !record.naggedAt) {
      record.naggedAt = new Date(nowMs).toISOString()
      actions.push({ kind: 'nag', record })
      changed = true
    }
  }
  if (changed) saveRegistry(records, nowMs)
  return actions
}
