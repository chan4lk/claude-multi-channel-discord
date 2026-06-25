import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type StateLabel = 'idle' | 'active' | 'stuck' | 'circuit-open'

export interface Transition {
  from: StateLabel
  to: StateLabel
  count: number
  avgDurationMs: number | null   // avg time spent in `from` before transitioning
}

export interface StateTotal {
  state: StateLabel
  totalMs: number
  pct: number                    // 0–100, share of total tracked time
  entries: number                // times entered this state
}

export interface StateTransitionsResponse {
  transitions: Transition[]
  stateTotals: StateTotal[]
  generatedAt: string
}

interface RawCircuitEvent {
  ts: string
  event: 'open' | 'close'
  slug: string
}

interface JsonlLine {
  message?: {
    role?: string
    content?: Array<{ type?: string }>
  }
  timestamp?: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function isGenuineUserMessage(line: JsonlLine): boolean {
  if (line.message?.role !== 'user') return false
  const c = line.message?.content
  if (!Array.isArray(c) || c.length === 0) return true
  return c[0]?.type !== 'tool_result'
}

// Extract message timestamps per slug from JSONL files
function extractMessageTimestamps(slug: string, mcdDir: string, cutoffMs: number): number[] {
  const ts: number[] = []
  for (const f of findJsonlFiles(slug, mcdDir)) {
    let lines: string[]
    try { lines = fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (!isGenuineUserMessage(line) || !line.timestamp) continue
      const t = Date.parse(line.timestamp)
      if (!isNaN(t) && t >= cutoffMs) ts.push(t)
    }
  }
  return ts.sort((a, b) => a - b)
}

// Extract circuit events per slug
function extractCircuitEvents(slug: string, mcdDir: string, cutoffMs: number): RawCircuitEvent[] {
  const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return [] }

  const events: RawCircuitEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as RawCircuitEvent
      if (e.ts && e.event) {
        const t = Date.parse(e.ts)
        if (!isNaN(t) && t >= cutoffMs) events.push(e)
      }
    } catch { continue }
  }
  return events.sort((a, b) => a.ts.localeCompare(b.ts))
}

const IDLE_GAP_MS = 30 * 60 * 1000  // 30 min gap = idle

interface StateInterval {
  state: StateLabel
  startMs: number
  endMs: number
}

function buildStateIntervals(
  msgTimestamps: number[],
  circuitEvents: RawCircuitEvent[],
  windowEndMs: number
): StateInterval[] {
  // Merge all events into a unified timeline
  type Event =
    | { kind: 'msg'; ts: number }
    | { kind: 'circuit-open'; ts: number }
    | { kind: 'circuit-close'; ts: number }

  const events: Event[] = [
    ...msgTimestamps.map((ts) => ({ kind: 'msg' as const, ts })),
    ...circuitEvents.map((e) => ({
      kind: (e.event === 'open' ? 'circuit-open' : 'circuit-close') as Event['kind'],
      ts: Date.parse(e.ts),
    })),
  ].sort((a, b) => a.ts - b.ts)

  if (events.length === 0) return []

  const intervals: StateInterval[] = []
  let state: StateLabel = 'idle'
  let stateStart = events[0]!.ts
  let lastMsgTs = 0

  function recordTransition(newState: StateLabel, ts: number) {
    if (ts > stateStart) {
      intervals.push({ state, startMs: stateStart, endMs: ts })
    }
    state = newState
    stateStart = ts
  }

  for (const e of events) {
    if (e.kind === 'circuit-open') {
      recordTransition('circuit-open', e.ts)
    } else if (e.kind === 'circuit-close') {
      if (state === 'circuit-open') recordTransition('idle', e.ts)
    } else if (e.kind === 'msg') {
      if (state === 'circuit-open') {
        // ignore messages while circuit open
      } else if (lastMsgTs > 0 && e.ts - lastMsgTs > IDLE_GAP_MS) {
        // gap → idle between lastMsg and now
        if (state === 'active' || state === 'stuck') {
          recordTransition('idle', lastMsgTs + IDLE_GAP_MS)
        }
        recordTransition('active', e.ts)
      } else {
        if (state === 'idle') recordTransition('active', e.ts)
      }
      lastMsgTs = e.ts
    }
  }

  // Close final interval
  if (stateStart < windowEndMs) {
    // If last msg was long ago, we may have drifted to idle
    if (state === 'active' && lastMsgTs > 0 && windowEndMs - lastMsgTs > IDLE_GAP_MS) {
      intervals.push({ state: 'active', startMs: stateStart, endMs: lastMsgTs + IDLE_GAP_MS })
      intervals.push({ state: 'idle', startMs: lastMsgTs + IDLE_GAP_MS, endMs: windowEndMs })
    } else {
      intervals.push({ state, startMs: stateStart, endMs: windowEndMs })
    }
  }

  return intervals
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const windowMs = 30 * 24 * 3_600_000
  const cutoffMs = Date.now() - windowMs
  const windowEndMs = Date.now()

  // transition count matrix
  const transCount: Record<string, Record<string, number>> = {}
  const transTotal: Record<string, Record<string, number>> = {}  // sum of durationMs in from-state

  // state total time
  const stateTotalMs: Record<StateLabel, number> = { idle: 0, active: 0, stuck: 0, 'circuit-open': 0 }
  const stateEntries: Record<StateLabel, number> = { idle: 0, active: 0, stuck: 0, 'circuit-open': 0 }

  const STATES: StateLabel[] = ['idle', 'active', 'stuck', 'circuit-open']
  for (const s of STATES) {
    transCount[s] = {}
    transTotal[s] = {}
    for (const t of STATES) {
      transCount[s]![t] = 0
      transTotal[s]![t] = 0
    }
  }

  for (const slug of slugs) {
    const msgTs = extractMessageTimestamps(slug, mcdDir, cutoffMs)
    const circuitEvts = extractCircuitEvents(slug, mcdDir, cutoffMs)
    const intervals = buildStateIntervals(msgTs, circuitEvts, windowEndMs)

    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i]!
      stateTotalMs[iv.state] += iv.endMs - iv.startMs
      stateEntries[iv.state]++

      if (i + 1 < intervals.length) {
        const next = intervals[i + 1]!
        transCount[iv.state]![next.state] = (transCount[iv.state]![next.state] ?? 0) + 1
        transTotal[iv.state]![next.state] = (transTotal[iv.state]![next.state] ?? 0) + (iv.endMs - iv.startMs)
      }
    }
  }

  const transitions: Transition[] = []
  for (const from of STATES) {
    for (const to of STATES) {
      if (from === to) continue
      const count = transCount[from]?.[to] ?? 0
      if (count === 0) continue
      const totalDur = transTotal[from]?.[to] ?? 0
      transitions.push({
        from,
        to,
        count,
        avgDurationMs: count > 0 ? Math.round(totalDur / count) : null,
      })
    }
  }
  transitions.sort((a, b) => b.count - a.count)

  const grandTotal = Object.values(stateTotalMs).reduce((s, v) => s + v, 0)
  const stateTotals: StateTotal[] = STATES.map((s) => ({
    state: s,
    totalMs: stateTotalMs[s],
    pct: grandTotal > 0 ? Math.round((stateTotalMs[s] / grandTotal) * 100) : 0,
    entries: stateEntries[s],
  })).filter((s) => s.entries > 0)

  return Response.json({
    transitions,
    stateTotals,
    generatedAt: new Date().toISOString(),
  } satisfies StateTransitionsResponse)
}
