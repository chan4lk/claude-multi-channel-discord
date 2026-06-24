import { getConvergenceSparklines } from '../../../src/db'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30
const TARGET = 90 // convergence score (0-100) considered "healthy"
const MIN_POINTS = 3

export type ForecastStatus = 'reached' | 'rising' | 'stalled' | 'declining'

export interface ForecastPoint {
  date: string
  score: number
}

export interface ForecastProject {
  slug: string
  current: number // latest convergence score (0-100)
  slope: number // score change per day from least-squares fit
  etaDays: number | null // days to reach TARGET; null when slope ≤ 0 or already ≥ TARGET
  status: ForecastStatus
  points: ForecastPoint[] // historical series within the window
}

export interface ConvergenceForecastResponse {
  windowDays: number
  target: number
  projects: ForecastProject[]
  reachingWithinWindow: number // count forecast to reach TARGET within WINDOW_DAYS
}

// Least-squares slope/intercept of score over day-index (0..n-1).
function linearFit(scores: number[]): { slope: number; intercept: number } {
  const n = scores.length
  const mx = (n - 1) / 2
  const my = scores.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (scores[i] - my)
    den += (i - mx) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: my - slope * mx }
}

export async function GET(): Promise<Response> {
  const series = getConvergenceSparklines(WINDOW_DAYS)

  const projects: ForecastProject[] = series
    .filter((s) => s.points.length >= MIN_POINTS)
    .map((s) => {
      const scores = s.points.map((p) => p.score)
      const { slope } = linearFit(scores)
      const current = scores[scores.length - 1]
      const slopeR = Math.round(slope * 100) / 100

      let status: ForecastStatus
      let etaDays: number | null = null
      if (current >= TARGET) {
        status = 'reached'
      } else if (slopeR > 0.05) {
        status = 'rising'
        // days from the latest point to cross TARGET at the fitted slope
        etaDays = Math.ceil((TARGET - current) / slope)
      } else if (slopeR < -0.05) {
        status = 'declining'
      } else {
        status = 'stalled'
      }

      return {
        slug: s.slug,
        current: Math.round(current),
        slope: slopeR,
        etaDays,
        status,
        points: s.points.map((p) => ({ date: p.date, score: p.score })),
      }
    })

  // Sort: soonest ETA first, then rising-without-eta, stalled, declining, reached last.
  const rank: Record<ForecastStatus, number> = { rising: 0, stalled: 1, declining: 2, reached: 3 }
  projects.sort((a, b) => {
    if (a.etaDays != null && b.etaDays != null) return a.etaDays - b.etaDays
    if (a.etaDays != null) return -1
    if (b.etaDays != null) return 1
    return rank[a.status] - rank[b.status]
  })

  const reachingWithinWindow = projects.filter((p) => p.etaDays != null && p.etaDays <= WINDOW_DAYS).length

  return Response.json({
    windowDays: WINDOW_DAYS,
    target: TARGET,
    projects,
    reachingWithinWindow,
  } satisfies ConvergenceForecastResponse)
}
