import { getAttentionEvents } from '../../../src/db'
import { computeFindings } from '../../../lib/attention-findings'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30

// Severity rank for picking a node/edge dominant severity (higher = worse).
const SEV_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1, ok: 0 }

export interface CooccurrenceNode {
  signal: string
  count: number // total firings (project-days in history mode, projects in live mode)
  severity: string // dominant (worst) severity observed for this signal
  slugs: string[] // distinct projects that fired this signal in range
}

export interface CooccurrenceEdge {
  a: string // signalA (lexicographically first)
  b: string // signalB
  weight: number // times the two signals fired together on the same project
}

export interface CooccurrenceResponse {
  mode: 'history' | 'live'
  windowDays: number
  nodes: CooccurrenceNode[]
  edges: CooccurrenceEdge[]
  maxNodeCount: number
  maxEdgeWeight: number
  dominantSignal: string | null // signal with the most total firings
}

const isAttention = (signal: string, severity: string) => signal !== 'healthy' && severity !== 'ok'

interface NodeAcc {
  count: number
  severity: string
  slugs: Set<string>
}

/**
 * Build a co-occurrence graph from per-(group, signal, severity) observations.
 * Each `group` is one project-day (history) or one project (live). Node count
 * counts observations; an edge weight counts the project-groups in which both
 * of its signals fired.
 */
function buildGraph(groups: Map<string, Map<string, string>>): {
  nodes: CooccurrenceNode[]
  edges: CooccurrenceEdge[]
} {
  const nodeAcc = new Map<string, NodeAcc>()
  const edgeWeight = new Map<string, number>()

  for (const [groupKey, sigSeverity] of groups) {
    const slug = groupKey.includes('|') ? groupKey.split('|')[1]! : groupKey
    const signals = Array.from(sigSeverity.keys()).sort()
    for (const sig of signals) {
      const sev = sigSeverity.get(sig)!
      const acc = nodeAcc.get(sig) ?? { count: 0, severity: 'ok', slugs: new Set<string>() }
      acc.count++
      acc.slugs.add(slug)
      if ((SEV_RANK[sev] ?? 0) > (SEV_RANK[acc.severity] ?? 0)) acc.severity = sev
      nodeAcc.set(sig, acc)
    }
    // Unordered signal pairs that co-fired in this group.
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        const key = `${signals[i]}|${signals[j]}`
        edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1)
      }
    }
  }

  const nodes: CooccurrenceNode[] = Array.from(nodeAcc.entries())
    .map(([signal, a]) => ({ signal, count: a.count, severity: a.severity, slugs: Array.from(a.slugs).sort() }))
    .sort((x, y) => y.count - x.count || x.signal.localeCompare(y.signal))

  const edges: CooccurrenceEdge[] = Array.from(edgeWeight.entries())
    .map(([key, weight]) => { const [a, b] = key.split('|'); return { a: a!, b: b!, weight } })
    .sort((x, y) => y.weight - x.weight)

  return { nodes, edges }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || DEFAULT_DAYS, 1), 90)

  const events = getAttentionEvents(days)

  // Group key → (signal → worst severity for that signal in the group).
  const groups = new Map<string, Map<string, string>>()
  let mode: 'history' | 'live' = 'history'

  if (events.length > 0) {
    for (const e of events) {
      if (!isAttention(e.signal, e.severity)) continue
      const key = `${e.date}|${e.slug}` // one group per project-day
      const m = groups.get(key) ?? new Map<string, string>()
      const prev = m.get(e.signal)
      if (!prev || (SEV_RANK[e.severity] ?? 0) > (SEV_RANK[prev] ?? 0)) m.set(e.signal, e.severity)
      groups.set(key, m)
    }
  } else {
    // P211 AC4: degrade to the live finding set when no history exists.
    mode = 'live'
    const mcdDir = process.env.MCD_CHANNELS_DIR
    if (mcdDir) {
      const findings = await computeFindings(mcdDir)
      for (const f of findings) {
        if (!isAttention(f.signal, f.severity)) continue
        const key = f.slug // one group per project
        const m = groups.get(key) ?? new Map<string, string>()
        const prev = m.get(f.signal)
        if (!prev || (SEV_RANK[f.severity] ?? 0) > (SEV_RANK[prev] ?? 0)) m.set(f.signal, f.severity)
        groups.set(key, m)
      }
    }
  }

  const { nodes, edges } = buildGraph(groups)

  return Response.json({
    mode,
    windowDays: days,
    nodes,
    edges,
    maxNodeCount: nodes.reduce((m, n) => Math.max(m, n.count), 0),
    maxEdgeWeight: edges.reduce((m, e) => Math.max(m, e.weight), 0),
    dominantSignal: nodes[0]?.signal ?? null,
  } satisfies CooccurrenceResponse)
}
