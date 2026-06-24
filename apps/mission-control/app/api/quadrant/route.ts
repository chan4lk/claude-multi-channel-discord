import { getQuadrantPoints } from '../../../src/db'

export const dynamic = 'force-dynamic'

export type Quadrant = 'thriving' | 'drifting' | 'grinding' | 'stalled'

export interface QuadrantPoint {
  slug: string
  convergence: number
  goal: number
  quadrant: Quadrant
}

export interface QuadrantResponse {
  points: QuadrantPoint[]
  counts: Record<Quadrant, number>
  total: number
}

const MID = 50

function classify(convergence: number, goal: number): Quadrant {
  const hiC = convergence >= MID
  const hiG = goal >= MID
  if (hiC && hiG) return 'thriving'
  if (hiC && !hiG) return 'drifting'
  if (!hiC && hiG) return 'grinding'
  return 'stalled'
}

export async function GET(): Promise<Response> {
  const rows = getQuadrantPoints()
  const counts: Record<Quadrant, number> = { thriving: 0, drifting: 0, grinding: 0, stalled: 0 }
  const points: QuadrantPoint[] = rows.map((r) => {
    const quadrant = classify(r.convergence, r.goal)
    counts[quadrant]++
    return { slug: r.slug, convergence: r.convergence, goal: r.goal, quadrant }
  })
  return Response.json({ points, counts, total: points.length } satisfies QuadrantResponse)
}
