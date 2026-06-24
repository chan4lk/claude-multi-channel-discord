import { getAlertSlaRows } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DAYS_BACK = 30

export interface AlertSlaType {
  alert_type: string
  count: number
  acked: number
  ackRate: number // 0–100
  medianSec: number | null // median time-to-ack over acknowledged alerts
  p90Sec: number | null
  openBacklog: number // currently unacknowledged
  oldestOpenSec: number | null // age of oldest open alert
}

export interface AlertSlaResponse {
  types: AlertSlaType[]
  fleetMedianSec: number | null
  totalOpen: number
  total: number
  windowDays: number
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export async function GET(): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)
  const sinceTs = now - DAYS_BACK * 86400
  const rows = getAlertSlaRows(sinceTs)

  const byType = new Map<string, { latencies: number[]; count: number; open: number; oldestOpen: number | null }>()
  const allLatencies: number[] = []
  let totalOpen = 0

  for (const r of rows) {
    let g = byType.get(r.alert_type)
    if (!g) { g = { latencies: [], count: 0, open: 0, oldestOpen: null }; byType.set(r.alert_type, g) }
    g.count++
    if (r.ack_ts != null) {
      const lat = Math.max(0, r.ack_ts - r.ts)
      g.latencies.push(lat)
      allLatencies.push(lat)
    } else {
      g.open++
      totalOpen++
      const age = Math.max(0, now - r.ts)
      if (g.oldestOpen == null || age > g.oldestOpen) g.oldestOpen = age
    }
  }

  const types: AlertSlaType[] = [...byType.entries()].map(([alert_type, g]) => {
    const sorted = g.latencies.slice().sort((a, b) => a - b)
    const acked = g.latencies.length
    return {
      alert_type,
      count: g.count,
      acked,
      ackRate: g.count === 0 ? 0 : Math.round((acked / g.count) * 1000) / 10,
      medianSec: percentile(sorted, 0.5),
      p90Sec: percentile(sorted, 0.9),
      openBacklog: g.open,
      oldestOpenSec: g.oldestOpen,
    }
  })

  // Worst-first: largest open backlog, then slowest median.
  types.sort((a, b) => b.openBacklog - a.openBacklog || (b.medianSec ?? 0) - (a.medianSec ?? 0))

  return Response.json({
    types,
    fleetMedianSec: percentile(allLatencies.slice().sort((a, b) => a - b), 0.5),
    totalOpen,
    total: rows.length,
    windowDays: DAYS_BACK,
  } satisfies AlertSlaResponse)
}
