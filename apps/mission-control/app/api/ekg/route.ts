import { getEkgTimestamps } from '../../../src/db'

export const dynamic = 'force-dynamic'

const WINDOW_HOURS = 48
const HOUR = 3600

export type EkgSourceKey = 'alerts' | 'injects' | 'memory' | 'digests' | 'broadcasts'

export interface EkgSource {
  key: EkgSourceKey
  label: string
  total: number
}

export interface EkgBin {
  hourStart: number // unix seconds, start of the hour
  counts: Record<EkgSourceKey, number>
  total: number
}

export interface EkgResponse {
  sources: EkgSource[]
  bins: EkgBin[] // oldest → newest, length WINDOW_HOURS
  total: number
  busiestHour: { hourStart: number; total: number } | null
  windowHours: number
}

const SOURCE_LABELS: Record<EkgSourceKey, string> = {
  alerts: 'Alerts',
  injects: 'Injects',
  memory: 'Memory',
  digests: 'Digests',
  broadcasts: 'Broadcasts',
}

const SOURCE_ORDER: EkgSourceKey[] = ['alerts', 'injects', 'memory', 'digests', 'broadcasts']

export async function GET(): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)
  const nowHour = now - (now % HOUR)
  const startHour = nowHour - (WINDOW_HOURS - 1) * HOUR // inclusive start of oldest bin
  const ts = getEkgTimestamps(startHour)

  // Pre-build empty bins, oldest → newest.
  const bins: EkgBin[] = Array.from({ length: WINDOW_HOURS }, (_, i) => ({
    hourStart: startHour + i * HOUR,
    counts: { alerts: 0, injects: 0, memory: 0, digests: 0, broadcasts: 0 },
    total: 0,
  }))

  const totals: Record<EkgSourceKey, number> = { alerts: 0, injects: 0, memory: 0, digests: 0, broadcasts: 0 }

  for (const key of SOURCE_ORDER) {
    for (const t of ts[key]) {
      const idx = Math.floor((t - startHour) / HOUR)
      if (idx < 0 || idx >= WINDOW_HOURS) continue
      bins[idx].counts[key]++
      bins[idx].total++
      totals[key]++
    }
  }

  const sources: EkgSource[] = SOURCE_ORDER.map((key) => ({
    key,
    label: SOURCE_LABELS[key],
    total: totals[key],
  }))

  const total = Object.values(totals).reduce((a, b) => a + b, 0)

  let busiestHour: EkgResponse['busiestHour'] = null
  for (const b of bins) {
    if (b.total > 0 && (busiestHour === null || b.total > busiestHour.total)) {
      busiestHour = { hourStart: b.hourStart, total: b.total }
    }
  }

  return Response.json({
    sources,
    bins,
    total,
    busiestHour,
    windowHours: WINDOW_HOURS,
  } satisfies EkgResponse)
}
