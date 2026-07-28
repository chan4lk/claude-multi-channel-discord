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
  /** Owning chain id when this handoff is a chain step. Absent on single hops. */
  chainId?: string
  /** Zero-based step index within the owning chain. */
  chainStep?: number
}

export interface HandoffSweepAction {
  kind: 'nag' | 'escalate'
  record: HandoffRecord
}

// ---------------------------------------------------------------------------
// Chains (work-graph layer): linear multi-step handoffs. Each fired step is a
// normal HandoffRecord tagged chainId/chainStep; the chain tracks the cursor.
// ---------------------------------------------------------------------------

export interface ChainStep {
  /** Collab role name to resolve at fire time. Exactly one of role/target. */
  role?: string
  /** Literal slug or bot-peer id to resolve at fire time. */
  target?: string
  task: string
  /** 'approve' — chain halts unless this step's outcome starts with "approve". */
  gate?: 'approve'
}

export type ChainState = 'active' | 'done' | 'halted' | 'expired'

export interface ChainRecord {
  id: string               // "c-<base36ts>-<hex4>"
  from: string             // source slug ('master' allowed, same as handoffs)
  sourceChatId: string     // progress posts go here; survives slug renames
  steps: ChainStep[]
  cursor: number           // index of the currently-fired step
  stepHandoffIds: string[] // handoff id per fired step (length = cursor+1 while active)
  state: ChainState
  createdAt: string
  closedAt?: string
  closeReason?: string     // gate-failed / resolution error / expired-step detail
}

/** Registry file v2. Legacy format (bare HandoffRecord[]) migrates on read. */
export interface RegistryFileV2 {
  version: 2
  handoffs: HandoffRecord[]
  chains: ChainRecord[]
}

export type ChainAction =
  | { kind: 'halt-gate' }
  | { kind: 'complete' }
  | { kind: 'advance'; nextStep: ChainStep; nextIndex: number }

/**
 * Load the full registry file from disk.
 * Fail-open: absent file → empty; corrupt file → empty with a stderr warning
 * (the next save rewrites it clean). The legacy format — a bare array of
 * HandoffRecord — migrates in memory to the v2 envelope; the first save
 * writes v2 to disk.
 */
export function loadRegistryFile(): RegistryFileV2 {
  const empty: RegistryFileV2 = { version: 2, handoffs: [], chains: [] }
  const filePath = handoffsPath()
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    return empty  // no registry yet
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { version: 2, handoffs: parsed as HandoffRecord[], chains: [] }
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.handoffs)) {
      return {
        version: 2,
        handoffs: parsed.handoffs as HandoffRecord[],
        chains: Array.isArray(parsed.chains) ? (parsed.chains as ChainRecord[]) : [],
      }
    }
    throw new Error('not a handoff registry')
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error(`[handoffs] corrupt registry at ${filePath} — treating as empty (${detail})`)
    return empty
  }
}

/** Load just the handoff records (legacy API — every #318 caller unchanged). */
export function loadRegistry(): HandoffRecord[] {
  return loadRegistryFile().handoffs
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

/** Timestamp used for prune-age ordering of a closed chain. */
function chainClosedAtMs(chain: ChainRecord): number {
  return Date.parse(chain.closedAt ?? chain.createdAt)
}

/** Same prune policy as closed handoffs: 30 days, then oldest-first beyond 200. */
function pruneClosedChains(chains: ChainRecord[], nowMs: number): ChainRecord[] {
  const kept = chains.filter(
    c => c.state === 'active' || nowMs - chainClosedAtMs(c) <= CLOSED_MAX_AGE_MS,
  )
  const closed = kept.filter(c => c.state !== 'active')
  if (closed.length <= CLOSED_MAX_ENTRIES) return kept
  const oldestFirst = [...closed].sort((a, b) => chainClosedAtMs(a) - chainClosedAtMs(b))
  const drop = new Set(oldestFirst.slice(0, closed.length - CLOSED_MAX_ENTRIES).map(c => c.id))
  return kept.filter(c => !drop.has(c.id))
}

/**
 * Persist the full registry file atomically (tmp + rename), creating the
 * shared/ directory if absent. Closed handoffs and chains are pruned before
 * writing. A chain transition (close step + create next + move cursor) is
 * therefore a single rename — crash-safe by construction.
 */
export function saveRegistryFile(file: RegistryFileV2, nowMs: number = Date.now()): void {
  const filePath = handoffsPath()
  mkdirSync(dirname(filePath), { recursive: true })
  const pruned: RegistryFileV2 = {
    version: 2,
    handoffs: pruneClosed(file.handoffs, nowMs),
    chains: pruneClosedChains(file.chains, nowMs),
  }
  const tmpPath = filePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(pruned, null, 2) + '\n', 'utf8')
  renameSync(tmpPath, filePath)
}

/**
 * Persist handoff records (legacy API). Chains already on disk are preserved.
 */
export function saveRegistry(records: HandoffRecord[], nowMs: number = Date.now()): void {
  const file = loadRegistryFile()
  file.handoffs = records
  saveRegistryFile(file, nowMs)
}

/**
 * Create a pending handoff record, assign its id, and persist it.
 */
export function createHandoff(
  { from, to, task, chainId, chainStep }: {
    from: string
    to: HandoffTarget
    task: string
    chainId?: string
    chainStep?: number
  },
  nowMs: number = Date.now(),
): HandoffRecord {
  const record: HandoffRecord = {
    id: `h-${nowMs.toString(36)}-${randomBytes(2).toString('hex')}`,
    from,
    to,
    task,
    state: 'pending',
    createdAt: new Date(nowMs).toISOString(),
    ...(chainId !== undefined ? { chainId } : {}),
    ...(chainStep !== undefined ? { chainStep } : {}),
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
 * Inbound ack detection (FR4 fallback + FR6 exemption decision).
 * Matches pending handoff ids for `chatId` in `text` and closes each match
 * with the message text (≤500 chars) as outcome. Returns the closed ids —
 * a non-empty result means the message is a handoff ack and is exempt from
 * bot-peer gate counting. Loop safety: only pending ids match, and each id
 * closes on first match, so an id exempts at most one message.
 */
export function acknowledgeHandoffs(
  chatId: string,
  text: string,
  nowMs: number = Date.now(),
): string[] {
  const ids = matchPendingIds(chatId, text)
  for (const id of ids) completeHandoff(id, text.slice(0, 500), nowMs)
  return ids
}

/**
 * Sweep pending handoffs against the timeout policy:
 *   - age ≥ 2× timeout → escalate action; record becomes `expired` (closedAt set)
 *   - age ≥ timeout and not yet nagged → nag action; `naggedAt` persisted
 * Idempotent across repeated runs: nag fires once (naggedAt latch), escalate
 * fires once (record leaves `pending`). Persists only when something changed.
 */
// ---------------------------------------------------------------------------
// Chain lifecycle
// ---------------------------------------------------------------------------

/**
 * Shape-validate chain steps at creation time (fail fast, nothing persisted).
 * Targets resolve at FIRE time, not here — config may legitimately change
 * mid-chain. Returns an error string or null.
 */
export function validateChainSteps(steps: ChainStep[], hopBudget: number): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return 'chain requires at least one step'
  if (steps.length > hopBudget) {
    return `chain has ${steps.length} steps but the hop budget is ${hopBudget}`
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    const hasRole = typeof s.role === 'string' && s.role.trim() !== ''
    const hasTarget = typeof s.target === 'string' && s.target.trim() !== ''
    if (hasRole === hasTarget) return `chain step ${i + 1}: pass exactly one of role or target`
    if (typeof s.task !== 'string' || s.task.trim() === '') return `chain step ${i + 1}: task is required`
    if (s.gate !== undefined && s.gate !== 'approve') return `chain step ${i + 1}: gate must be "approve"`
  }
  return null
}

/**
 * Pure chain decision for a just-closed step:
 *   - gated step whose outcome doesn't start with "approve" → halt-gate
 *   - last step → complete
 *   - otherwise → advance to the next step
 * Empty/absent outcome fails an approve gate.
 */
export function nextChainAction(
  chain: ChainRecord,
  closedStepIndex: number,
  outcome: string | undefined,
): ChainAction {
  const step = chain.steps[closedStepIndex]
  if (step?.gate === 'approve') {
    const approved = (outcome ?? '').trim().toLowerCase().startsWith('approve')
    if (!approved) return { kind: 'halt-gate' }
  }
  const nextIndex = closedStepIndex + 1
  const nextStep = chain.steps[nextIndex]
  if (!nextStep) return { kind: 'complete' }
  return { kind: 'advance', nextStep, nextIndex }
}

/**
 * Create a chain plus its step-1 handoff in ONE atomic registry write.
 * Caller has already resolved step 1's target and validated the steps.
 */
export function createChain(
  { from, sourceChatId, steps, firstTo }: {
    from: string
    sourceChatId: string
    steps: ChainStep[]
    firstTo: HandoffTarget
  },
  nowMs: number = Date.now(),
): { chain: ChainRecord; record: HandoffRecord } {
  const chain: ChainRecord = {
    id: `c-${nowMs.toString(36)}-${randomBytes(2).toString('hex')}`,
    from,
    sourceChatId,
    steps,
    cursor: 0,
    stepHandoffIds: [],
    state: 'active',
    createdAt: new Date(nowMs).toISOString(),
  }
  const record: HandoffRecord = {
    id: `h-${nowMs.toString(36)}-${randomBytes(2).toString('hex')}`,
    from,
    to: firstTo,
    task: steps[0]!.task,
    state: 'pending',
    createdAt: new Date(nowMs).toISOString(),
    chainId: chain.id,
    chainStep: 0,
  }
  chain.stepHandoffIds.push(record.id)
  const file = loadRegistryFile()
  file.handoffs.push(record)
  file.chains.push(chain)
  saveRegistryFile(file, nowMs)
  return { chain, record }
}

export function findChain(chainId: string): ChainRecord | null {
  return loadRegistryFile().chains.find(c => c.id === chainId) ?? null
}

/**
 * Fire the next step of an active chain: create its handoff, move the
 * cursor — one atomic write. Caller resolved the target. Returns null when
 * the chain is missing, not active, or nextIndex doesn't match cursor + 1
 * (idempotency latch against double-advance).
 */
export function advanceChainStep(
  chainId: string,
  nextIndex: number,
  to: HandoffTarget,
  nowMs: number = Date.now(),
): { chain: ChainRecord; record: HandoffRecord } | null {
  const file = loadRegistryFile()
  const chain = file.chains.find(c => c.id === chainId)
  if (!chain || chain.state !== 'active') return null
  if (nextIndex !== chain.cursor + 1) return null
  const step = chain.steps[nextIndex]
  if (!step) return null
  const record: HandoffRecord = {
    id: `h-${nowMs.toString(36)}-${randomBytes(2).toString('hex')}`,
    from: chain.from,
    to,
    task: step.task,
    state: 'pending',
    createdAt: new Date(nowMs).toISOString(),
    chainId: chain.id,
    chainStep: nextIndex,
  }
  chain.cursor = nextIndex
  chain.stepHandoffIds.push(record.id)
  file.handoffs.push(record)
  saveRegistryFile(file, nowMs)
  return { chain, record }
}

/** Transition an active chain to a closed state. Idempotent (active-only). */
function closeChain(
  chainId: string,
  state: Exclude<ChainState, 'active'>,
  reason: string | undefined,
  nowMs: number,
): ChainRecord | null {
  const file = loadRegistryFile()
  const chain = file.chains.find(c => c.id === chainId)
  if (!chain) return null
  if (chain.state !== 'active') return chain
  chain.state = state
  chain.closedAt = new Date(nowMs).toISOString()
  if (reason !== undefined) chain.closeReason = reason
  saveRegistryFile(file, nowMs)
  return chain
}

export function completeChain(chainId: string, nowMs: number = Date.now()): ChainRecord | null {
  return closeChain(chainId, 'done', undefined, nowMs)
}

export function haltChain(chainId: string, reason: string, nowMs: number = Date.now()): ChainRecord | null {
  return closeChain(chainId, 'halted', reason, nowMs)
}

export function expireChain(chainId: string, reason: string, nowMs: number = Date.now()): ChainRecord | null {
  return closeChain(chainId, 'expired', reason, nowMs)
}

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
