import { getConvergenceMovers } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface ConvergenceMover {
  slug: string
  prev: number | null
  curr: number
  delta: number | null
}

export interface ConvergenceMoversResponse {
  movers: ConvergenceMover[]
  netDelta: number
}

export async function GET(): Promise<Response> {
  const rows = getConvergenceMovers()
  const movers: ConvergenceMover[] = rows.map((r) => ({
    slug: r.slug,
    prev: r.prev,
    curr: r.curr,
    delta: r.delta,
  }))
  const netDelta = movers.reduce((sum, m) => sum + (m.delta ?? 0), 0)
  return Response.json({ movers, netDelta } satisfies ConvergenceMoversResponse)
}
