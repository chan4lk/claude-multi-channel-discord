import { getAttentionEventsByHour } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30

// Severity rank for picking a wedge's dominant severity (higher = worse).
const SEV_RANK: Record<string, number> = { critical: 3, warn: 2, info: 1, ok: 0 }

export interface ClockCell {
  signal: string
  count: number // distinct projects firing this signal in this hour
  severity: string // dominant (worst) severity in the cell
  slugs: string[]
}

export interface ClockBucket {
  hour: number // 0-23
  total: number // total firings across signals in this hour
  dominantSeverity: string // worst severity seen in the hour
  slugCount: number // distinct projects active in this hour
  cells: Record<string, ClockCell> // by signal
}

export interface AttentionClockResponse {
  windowDays: number
  hours: ClockBucket[] // always 24 entries, hour 0..23
  signals: string[] // ordered by total firings desc
  max: number // max cell count, for intensity scaling
  total: number // total (hour,slug,signal) events in range
  peakHour: number | null // hour with most firings
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || DEFAULT_DAYS, 1), 90)

  const rows = getAttentionEventsByHour(days)

  // Seed 24 empty buckets so the clock always renders a full dial.
  const hours: ClockBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: 0,
    dominantSeverity: 'ok',
    slugCount: 0,
    cells: {},
  }))

  const signalTotals = new Map<string, number>()
  const hourSlugs: Array<Set<string>> = Array.from({ length: 24 }, () => new Set())

  for (const r of rows) {
    const h = Math.min(23, Math.max(0, r.hour | 0))
    const bucket = hours[h]!
    let cell = bucket.cells[r.signal]
    if (!cell) {
      cell = { signal: r.signal, count: 0, severity: r.severity, slugs: [] }
      bucket.cells[r.signal] = cell
    }
    if (!cell.slugs.includes(r.slug)) {
      cell.slugs.push(r.slug)
      cell.count++
      bucket.total++
    }
    if ((SEV_RANK[r.severity] ?? 0) > (SEV_RANK[cell.severity] ?? 0)) cell.severity = r.severity
    if ((SEV_RANK[r.severity] ?? 0) > (SEV_RANK[bucket.dominantSeverity] ?? 0)) bucket.dominantSeverity = r.severity
    hourSlugs[h]!.add(r.slug)
    signalTotals.set(r.signal, (signalTotals.get(r.signal) ?? 0) + 1)
  }

  for (let h = 0; h < 24; h++) hours[h]!.slugCount = hourSlugs[h]!.size

  const signals = Array.from(signalTotals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s]) => s)

  let max = 0
  let peakHour: number | null = null
  let peakTotal = -1
  for (const b of hours) {
    for (const sig of signals) {
      const c = b.cells[sig]?.count ?? 0
      if (c > max) max = c
    }
    if (b.total > peakTotal) { peakTotal = b.total; peakHour = b.hour }
  }
  if (rows.length === 0) peakHour = null

  return Response.json({
    windowDays: days,
    hours,
    signals,
    max,
    total: rows.length,
    peakHour,
  } satisfies AttentionClockResponse)
}
