import { getAttentionEvents } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30

// Severity rank for picking a cell's dominant severity (higher = worse).
const SEV_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1, ok: 0 }

export interface SignalCell {
  date: string
  signal: string
  count: number // distinct projects firing this signal that day
  severity: string // dominant (worst) severity in the cell
  slugs: string[] // projects firing this signal that day
}

export interface SignalTimelineResponse {
  windowDays: number
  days: string[] // sorted ascending, the column axis
  signals: string[] // row axis, ordered by total firings desc
  grid: Record<string, Record<string, SignalCell>> // grid[signal][date]
  max: number // max cell count, for intensity scaling
  total: number // total (date,slug,signal) events in range
  dominantSignal: string | null // signal with most total firings
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || DEFAULT_DAYS, 1), 90)

  const rows = getAttentionEvents(days)

  const daySet = new Set<string>()
  const signalTotals = new Map<string, number>()
  const grid: Record<string, Record<string, SignalCell>> = {}

  for (const r of rows) {
    daySet.add(r.date)
    if (!grid[r.signal]) grid[r.signal] = {}
    let cell = grid[r.signal][r.date]
    if (!cell) {
      cell = { date: r.date, signal: r.signal, count: 0, severity: r.severity, slugs: [] }
      grid[r.signal][r.date] = cell
    }
    if (!cell.slugs.includes(r.slug)) {
      cell.slugs.push(r.slug)
      cell.count++
    }
    if ((SEV_RANK[r.severity] ?? 0) > (SEV_RANK[cell.severity] ?? 0)) cell.severity = r.severity
    signalTotals.set(r.signal, (signalTotals.get(r.signal) ?? 0) + 1)
  }

  const dayList = Array.from(daySet).sort()
  const signals = Array.from(signalTotals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s]) => s)

  let max = 0
  for (const sig of signals) for (const d of dayList) {
    const c = grid[sig]?.[d]?.count ?? 0
    if (c > max) max = c
  }

  return Response.json({
    windowDays: days,
    days: dayList,
    signals,
    grid,
    max,
    total: rows.length,
    dominantSignal: signals[0] ?? null,
  } satisfies SignalTimelineResponse)
}
