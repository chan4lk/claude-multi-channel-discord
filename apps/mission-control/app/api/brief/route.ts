import { computeBrief, BRIEF_WINDOW_DAYS, type BriefFinding } from '../../../lib/brief'
import { upsertBriefSnapshot } from '../../../src/db'

export const dynamic = 'force-dynamic'

// Re-exported for existing consumers of the route's types.
export type { BriefSeverity, BriefFinding } from '../../../lib/brief'

export interface BriefResponse {
  findings: BriefFinding[]
  fleetStatus: 'attention' | 'nominal' | 'empty'
  windowDays: number
  generatedAt: string
}

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString()
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ findings: [], fleetStatus: 'empty', windowDays: BRIEF_WINDOW_DAYS, generatedAt } satisfies BriefResponse)
  }

  const { findings, fleetStatus } = computeBrief(mcdDir)

  // P206: persist today's brief as an idempotent daily snapshot for trending.
  try {
    const date = generatedAt.slice(0, 10)
    const counts = { critical: 0, warn: 0, info: 0 }
    for (const f of findings) {
      if (f.severity === 'critical') counts.critical++
      else if (f.severity === 'warn') counts.warn++
      else if (f.severity === 'info') counts.info++
    }
    const compact = findings.filter((f) => f.slug).map((f) => ({ slug: f.slug, severity: f.severity }))
    upsertBriefSnapshot(date, counts.critical, counts.warn, counts.info, JSON.stringify(compact))
  } catch {
    // Snapshot persistence is best-effort; never fail the read on a write error.
  }

  return Response.json({ findings, fleetStatus, windowDays: BRIEF_WINDOW_DAYS, generatedAt } satisfies BriefResponse)
}
