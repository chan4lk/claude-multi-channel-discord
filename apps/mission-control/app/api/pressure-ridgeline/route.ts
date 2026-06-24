import { getContextPressureRidgeline } from '../../../src/db'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 30

export interface RidgelineRow {
  slug: string
  points: { ts: number; score: number }[]
  latest: number
}

export interface PressureRidgelineResponse {
  rows: RidgelineRow[]
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : DEFAULT_LIMIT

  const series = getContextPressureRidgeline(limit)
  const rows: RidgelineRow[] = series.map((s) => ({
    slug: s.slug,
    points: s.points,
    latest: s.points.at(-1)?.score ?? 0,
  }))

  return Response.json({ rows } satisfies PressureRidgelineResponse)
}
