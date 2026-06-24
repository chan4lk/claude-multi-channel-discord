import { computeFindings, toAdvisorCards, type AdvisorCard } from '../../../lib/attention-findings'

export const dynamic = 'force-dynamic'

export type AdvisorSeverity = 'critical' | 'warn' | 'info'
export type AdvisorActionType = 'inject' | 'distill' | 'command'
export type { AdvisorCard }

export interface AdvisorResponse {
  recommendations: AdvisorCard[]
  generatedAt: string
}

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString()
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ recommendations: [], generatedAt } satisfies AdvisorResponse)
  }

  const recommendations = toAdvisorCards(await computeFindings(mcdDir), 5)
  return Response.json({ recommendations, generatedAt } satisfies AdvisorResponse)
}
