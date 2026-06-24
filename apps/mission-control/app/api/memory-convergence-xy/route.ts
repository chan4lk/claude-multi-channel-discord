import { getMemoryConvergenceXY } from '../../../src/db'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30

export interface MemoryConvergencePoint {
  slug: string
  churn: number // total added+removed memory-diff lines over the window
  diffCount: number // number of memory diffs
  convDelta: number // latest − earliest convergence score in the window
  direction: 'improving' | 'declining' | 'flat'
}

export interface MemoryConvergenceXYResponse {
  windowDays: number
  points: MemoryConvergencePoint[]
  correlation: number | null // Pearson r of churn vs convDelta, null when n < 3
  correlationSign: 'positive' | 'negative' | 'none' | 'n/a'
}

function pearson(pts: MemoryConvergencePoint[]): number | null {
  const n = pts.length
  if (n < 3) return null
  const mx = pts.reduce((s, p) => s + p.churn, 0) / n
  const my = pts.reduce((s, p) => s + p.convDelta, 0) / n
  let num = 0, dx = 0, dy = 0
  for (const p of pts) {
    num += (p.churn - mx) * (p.convDelta - my)
    dx += (p.churn - mx) ** 2
    dy += (p.convDelta - my) ** 2
  }
  if (dx === 0 || dy === 0) return null
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100
}

export async function GET(): Promise<Response> {
  const sinceTs = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10)

  // Exclude projects missing either series: require memory churn AND a
  // convergence delta (≥2 points so start/end differ meaningfully).
  const points: MemoryConvergencePoint[] = getMemoryConvergenceXY(sinceTs, sinceDate)
    .filter((r) => r.diffCount > 0 && r.convPoints >= 2 && r.convStart != null && r.convEnd != null)
    .map((r) => {
      const convDelta = Math.round((r.convEnd! - r.convStart!) * 1000) / 1000
      const direction: MemoryConvergencePoint['direction'] =
        convDelta > 0.001 ? 'improving' : convDelta < -0.001 ? 'declining' : 'flat'
      return { slug: r.slug, churn: r.churn, diffCount: r.diffCount, convDelta, direction }
    })
    .sort((a, b) => b.churn - a.churn)

  const correlation = pearson(points)
  const correlationSign =
    correlation == null ? 'n/a' : correlation > 0.3 ? 'positive' : correlation < -0.3 ? 'negative' : 'none'

  return Response.json({
    windowDays: WINDOW_DAYS,
    points,
    correlation,
    correlationSign,
  } satisfies MemoryConvergenceXYResponse)
}
