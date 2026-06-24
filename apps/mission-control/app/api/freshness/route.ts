import { getFeedFreshness } from '../../../src/db'

export const dynamic = 'force-dynamic'

export type FeedStatus = 'healthy' | 'late' | 'silent'

export interface FeedRow {
  feed: string
  label: string
  lastTs: number | null
  ageSec: number | null
  count24h: number
  cadenceSec: number // expected max gap between updates
  status: FeedStatus
}

export interface FreshnessResponse {
  feeds: FeedRow[]
  healthy: number
  late: number
  silent: number
  checkedAt: number
}

// Expected cadence per feed (seconds). A feed older than its cadence is `late`;
// never-populated feeds are `silent`. Daily-rolled tables get a 36h grace.
const FEEDS: Record<string, { label: string; cadenceSec: number }> = {
  fleet_snapshots: { label: 'Fleet Snapshots', cadenceSec: 2 * 3600 },
  context_pressure: { label: 'Context Pressure', cadenceSec: 6 * 3600 },
  alert_events: { label: 'Alert Events', cadenceSec: 7 * 86400 }, // event-driven; quiet ≠ broken
  memory_diff_log: { label: 'Memory Diffs', cadenceSec: 2 * 86400 },
  digest_log: { label: 'Digest Log', cadenceSec: 36 * 3600 },
  convergence_history: { label: 'Convergence History', cadenceSec: 36 * 3600 },
  goal_advancement: { label: 'Goal Advancement', cadenceSec: 36 * 3600 },
  turn_quality: { label: 'Turn Quality', cadenceSec: 6 * 3600 },
}

export async function GET(): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)
  const raw = getFeedFreshness()

  const feeds: FeedRow[] = raw.map((r) => {
    const cfg = FEEDS[r.feed] ?? { label: r.feed, cadenceSec: 86400 }
    const ageSec = r.lastTs != null ? Math.max(0, now - r.lastTs) : null
    let status: FeedStatus
    if (r.lastTs == null) status = 'silent'
    else if (ageSec! > cfg.cadenceSec) status = 'late'
    else status = 'healthy'
    return {
      feed: r.feed,
      label: cfg.label,
      lastTs: r.lastTs,
      ageSec,
      count24h: r.count24h,
      cadenceSec: cfg.cadenceSec,
      status,
    }
  })

  // Most-stale first: silent, then late, then by age desc.
  const rank = { silent: 0, late: 1, healthy: 2 } as const
  feeds.sort((a, b) => rank[a.status] - rank[b.status] || (b.ageSec ?? Infinity) - (a.ageSec ?? Infinity))

  return Response.json({
    feeds,
    healthy: feeds.filter((f) => f.status === 'healthy').length,
    late: feeds.filter((f) => f.status === 'late').length,
    silent: feeds.filter((f) => f.status === 'silent').length,
    checkedAt: now,
  } satisfies FreshnessResponse)
}
