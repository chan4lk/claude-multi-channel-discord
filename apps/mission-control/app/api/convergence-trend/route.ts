import { getFleetConvergenceTrend } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface ConvergenceTrendEntry {
  date: string
  meanScore: number
  topBinCount: number
  projectCount: number
}

export interface ConvergenceTrendResponse {
  days: ConvergenceTrendEntry[]
}

export async function GET(): Promise<Response> {
  const rows = getFleetConvergenceTrend(14)
  const days: ConvergenceTrendEntry[] = rows.map((r) => ({
    date: r.date,
    meanScore: Math.round(r.meanScore),
    topBinCount: r.topBinCount,
    projectCount: r.projectCount,
  }))
  return Response.json({ days } satisfies ConvergenceTrendResponse)
}
