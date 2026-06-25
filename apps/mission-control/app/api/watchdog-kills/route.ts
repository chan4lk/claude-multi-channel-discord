import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface WatchdogKillEvent {
  ts: string
  slug: string
  runtimeMs: number | null
  lastToolCall: string | null
  reason: string
}

export interface WatchdogKillSummary {
  totalKills: number
  killsThisWeek: number
  worstSlug: string | null
  worstSlugCount: number
}

export interface WatchdogKillsResponse {
  events: WatchdogKillEvent[]
  summary: WatchdogKillSummary
  page: number
  pageSize: number
  total: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') ?? '50', 10)))
  const filterSlug = url.searchParams.get('slug') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const allEvents: WatchdogKillEvent[] = []
  const targetSlugs = filterSlug ? [filterSlug] : slugs

  for (const slug of targetSlugs) {
    const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
    let raw = ''
    try { raw = fs.readFileSync(logPath, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as WatchdogKillEvent
        if (e.ts && e.slug) allEvents.push(e)
      } catch { continue }
    }
  }

  allEvents.sort((a, b) => b.ts.localeCompare(a.ts))

  const weekAgo = Date.now() - 7 * 24 * 3_600_000
  const killsThisWeek = allEvents.filter((e) => Date.parse(e.ts) >= weekAgo).length

  const slugCounts: Record<string, number> = {}
  for (const e of allEvents) slugCounts[e.slug] = (slugCounts[e.slug] ?? 0) + 1
  const worstEntry = Object.entries(slugCounts).sort((a, b) => b[1] - a[1])[0]

  const summary: WatchdogKillSummary = {
    totalKills: allEvents.length,
    killsThisWeek,
    worstSlug: worstEntry?.[0] ?? null,
    worstSlugCount: worstEntry?.[1] ?? 0,
  }

  const total = allEvents.length
  const events = allEvents.slice((page - 1) * pageSize, page * pageSize)

  return Response.json({
    events,
    summary,
    page,
    pageSize,
    total,
    generatedAt: new Date().toISOString(),
  } satisfies WatchdogKillsResponse)
}
