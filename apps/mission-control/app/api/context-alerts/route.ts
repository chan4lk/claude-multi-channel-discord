import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ContextAlert {
  slug: string
  pressurePct: number  // 0-100
  burnRatePerHour: number  // tokens/hour
  eta: number  // seconds until limit (Infinity-like: 999999 if burn=0)
}

export interface ContextAlertsResponse {
  alerts: ContextAlert[]
  threshold: number
  computedAt: string
}

const CONTEXT_LIMIT = 200_000

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const threshold = parseInt(url.searchParams.get('threshold') ?? '80', 10)

  let pressureData: { projects?: Array<{ slug: string; score: number; usedTokens: number; trend?: Array<{ ts: number; score: number }> }> }
  try {
    const origin = url.origin
    const resp = await fetch(`${origin}/api/context-pressure`, { cache: 'no-store' })
    pressureData = await resp.json()
  } catch {
    return Response.json({ alerts: [], threshold, computedAt: new Date().toISOString() } satisfies ContextAlertsResponse)
  }

  const alerts: ContextAlert[] = []

  for (const proj of pressureData.projects ?? []) {
    if (proj.score < threshold) continue

    // Compute burn rate from trend (tokens/hour over last window)
    let burnRatePerHour = 0
    const trend = proj.trend ?? []
    if (trend.length >= 2) {
      const oldest = trend[0]
      const newest = trend[trend.length - 1]
      const dtMs = newest.ts - oldest.ts
      const dtHours = dtMs / 3_600_000
      if (dtHours > 0) {
        const usedOldest = (oldest.score / 100) * CONTEXT_LIMIT
        const usedNewest = (newest.score / 100) * CONTEXT_LIMIT
        burnRatePerHour = Math.max(0, (usedNewest - usedOldest) / dtHours)
      }
    }

    const usedTokens = proj.usedTokens ?? (proj.score / 100) * CONTEXT_LIMIT
    const remainingTokens = CONTEXT_LIMIT - usedTokens
    const eta = burnRatePerHour > 0
      ? Math.round((remainingTokens / burnRatePerHour) * 3600)
      : 999_999

    alerts.push({
      slug: proj.slug,
      pressurePct: proj.score,
      burnRatePerHour: Math.round(burnRatePerHour),
      eta,
    })
  }

  alerts.sort((a, b) => b.pressurePct - a.pressurePct)

  return Response.json({ alerts, threshold, computedAt: new Date().toISOString() } satisfies ContextAlertsResponse)
}
