import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { requireSession } from '@/src/security'
import { turnDurations } from '@/src/fact-index'

export const dynamic = 'force-dynamic'

export interface TurnDurationStats {
  slug: string
  p50: number   // seconds
  p90: number
  p99: number
  max: number
  count: number
  stuckThresholdSeconds: number
  exceedsThresholdCount: number
}

export interface HistogramBucket {
  minSec: number
  maxSec: number
  counts: Record<string, number>  // slug → count in this bucket
}

export interface TurnDurationResponse {
  slugs: string[]
  stats: TurnDurationStats[]
  histogram: HistogramBucket[]
  windowDays: number
  selectedSlug: string | null
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return Math.round(sorted[idx])
}

function buildHistogram(allDurations: Record<string, number[]>): HistogramBucket[] {
  // Buckets: 0-30s, 30-60s, 60-120s, 120-300s, 300-600s, 600s+
  const buckets: Array<[number, number]> = [
    [0, 30], [30, 60], [60, 120], [120, 300], [300, 600], [600, Infinity],
  ]

  return buckets.map(([minSec, maxSec]) => {
    const counts: Record<string, number> = {}
    for (const [slug, durs] of Object.entries(allDurations)) {
      const n = durs.filter((d) => d >= minSec && d < maxSec).length
      if (n > 0) counts[slug] = n
    }
    return { minSec, maxSec: isFinite(maxSec) ? maxSec : 9999, counts }
  })
}

export async function GET(request: Request): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const selectedSlug = url.searchParams.get('slug') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
    defaults?: { stuckThresholdMinutes?: number }
  }>(path.join(mcdDir, 'channels.json'))

  let slugs: string[] = []
  if (channels?.projects) {
    slugs = Object.values(channels.projects)
      .map((p) => p.slug)
      .filter((s): s is string => Boolean(s))
  }

  if (selectedSlug && !slugs.includes(selectedSlug)) slugs.push(selectedSlug)

  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000
  const defaultThresholdSec = (channels?.defaults?.stuckThresholdMinutes ?? 5) * 60

  // Per-slug turn durations from the fact index (recorded turn_duration
  // events), same sanity bounds as the previous transcript-gap scan.
  const durationsBySlug = new Map<string, number[]>()
  for (const row of turnDurations({ sinceMs: cutoffMs })) {
    const durSec = row.duration_ms / 1000
    if (!(durSec > 0 && durSec < 3600)) continue
    const durs = durationsBySlug.get(row.slug) ?? []
    durs.push(durSec)
    durationsBySlug.set(row.slug, durs)
  }

  const allDurations: Record<string, number[]> = {}
  const stats: TurnDurationStats[] = []

  for (const slug of slugs) {
    const durs = durationsBySlug.get(slug) ?? []
    if (durs.length === 0) continue

    durs.sort((a, b) => a - b)
    allDurations[slug] = durs

    stats.push({
      slug,
      p50: percentile(durs, 50),
      p90: percentile(durs, 90),
      p99: percentile(durs, 99),
      max: Math.round(durs[durs.length - 1]),
      count: durs.length,
      stuckThresholdSeconds: defaultThresholdSec,
      exceedsThresholdCount: durs.filter((d) => d >= defaultThresholdSec).length,
    })
  }

  stats.sort((a, b) => b.p90 - a.p90)

  const histogram = buildHistogram(
    selectedSlug && allDurations[selectedSlug]
      ? { [selectedSlug]: allDurations[selectedSlug] }
      : allDurations
  )

  return Response.json({
    slugs: Object.keys(allDurations),
    stats,
    histogram,
    windowDays,
    selectedSlug,
    generatedAt: new Date().toISOString(),
  } satisfies TurnDurationResponse)
}
