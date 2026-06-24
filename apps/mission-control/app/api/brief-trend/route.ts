import { getBriefTrend } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 30

export interface BriefTrendPoint {
  date: string
  critical: number
  warn: number
  info: number
}

export interface RecurringSlug {
  slug: string
  streak: number // length of the current run of consecutive days appearing in the brief
  days: number // total days appearing within the window
}

export interface BriefTrendResponse {
  windowDays: number
  points: BriefTrendPoint[]
  recurring: RecurringSlug[] // slugs flagged chronic (streak ≥ 2), worst first
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || DEFAULT_DAYS, 1), 365)

  const rows = getBriefTrend(days)
  const points: BriefTrendPoint[] = rows.map((r) => ({
    date: r.date,
    critical: r.critical,
    warn: r.warn,
    info: r.info,
  }))

  // Per-slug presence sequence across the snapshot dates (chronological).
  const slugDays = new Map<string, Set<string>>()
  for (const r of rows) {
    let parsed: Array<{ slug?: string }> = []
    try { parsed = JSON.parse(r.findings) } catch { parsed = [] }
    for (const f of parsed) {
      if (!f.slug) continue
      if (!slugDays.has(f.slug)) slugDays.set(f.slug, new Set())
      slugDays.get(f.slug)!.add(r.date)
    }
  }

  const orderedDates = rows.map((r) => r.date)
  const recurring: RecurringSlug[] = []
  for (const [slug, dates] of slugDays) {
    // Current streak = trailing run of consecutive snapshot dates ending at the latest.
    let streak = 0
    for (let i = orderedDates.length - 1; i >= 0; i--) {
      if (dates.has(orderedDates[i])) streak++
      else break
    }
    if (streak >= 2) recurring.push({ slug, streak, days: dates.size })
  }
  recurring.sort((a, b) => b.streak - a.streak || b.days - a.days || a.slug.localeCompare(b.slug))

  return Response.json({ windowDays: days, points, recurring } satisfies BriefTrendResponse)
}
