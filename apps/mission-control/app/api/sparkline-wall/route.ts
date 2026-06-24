import { getConvergenceSparklines } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 14

export interface SparklineCard {
  slug: string
  points: { date: string; score: number }[]
  latest: number
  first: number
  delta: number
  direction: 'up' | 'down' | 'flat'
}

export interface SparklineWallResponse {
  days: number
  cards: SparklineCard[]
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const daysParam = Number(url.searchParams.get('days'))
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : DEFAULT_DAYS

  const series = getConvergenceSparklines(days)
  const cards: SparklineCard[] = series.map((s) => {
    const latest = s.points.at(-1)?.score ?? 0
    const first = s.points[0]?.score ?? latest
    const delta = latest - first
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    return { slug: s.slug, points: s.points, latest, first, delta, direction }
  })
  // Steepest decline first (most negative delta), then weakest, then climbers.
  cards.sort((a, b) => a.delta - b.delta)

  return Response.json({ days, cards } satisfies SparklineWallResponse)
}
