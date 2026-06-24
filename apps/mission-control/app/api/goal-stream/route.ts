import { getGoalAdvancementStream } from '../../../src/db'

export const dynamic = 'force-dynamic'

export type GoalStatus = 'advancing' | 'on-track' | 'behind'

export interface GoalStreamEntry {
  slug: string
  date: string
  score: number
  prevScore: number | null
  from: GoalStatus | null
  to: GoalStatus
  changed: boolean
}

export interface GoalStreamResponse {
  entries: GoalStreamEntry[]
  total: number
  computedAt: string
}

// Score → status bands. Mirrors scoreColor() in the goal views:
// ≥60 advancing (#10B981), ≥30 on-track (#F59E0B), else behind (#EF4444).
function statusOf(score: number): GoalStatus {
  if (score >= 60) return 'advancing'
  if (score >= 30) return 'on-track'
  return 'behind'
}

const LIMIT = 200

export async function GET(): Promise<Response> {
  const rows = getGoalAdvancementStream(LIMIT)

  const entries: GoalStreamEntry[] = rows.map((r) => {
    const to = statusOf(r.score)
    const from = r.prevScore == null ? null : statusOf(r.prevScore)
    return {
      slug: r.slug,
      date: r.date,
      score: Math.round(r.score),
      prevScore: r.prevScore == null ? null : Math.round(r.prevScore),
      from,
      to,
      changed: from !== null && from !== to,
    }
  })

  return Response.json({
    entries,
    total: entries.length,
    computedAt: new Date().toISOString(),
  } satisfies GoalStreamResponse)
}
