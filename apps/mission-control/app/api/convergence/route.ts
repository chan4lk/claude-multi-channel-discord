import { getConvergenceHistory } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface ConvergenceEntry {
  date: string
  score: number
}

export interface ConvergenceResponse {
  slug: string
  history: ConvergenceEntry[]
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })

  const rows = getConvergenceHistory(slug, 7)
  const history: ConvergenceEntry[] = rows
    .map((r) => ({ date: r.date, score: r.score }))
    .reverse()

  return Response.json({ slug, history } satisfies ConvergenceResponse)
}
