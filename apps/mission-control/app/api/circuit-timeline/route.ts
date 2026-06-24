import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CircuitEvent {
  ts: string           // ISO timestamp
  slug: string
  event: 'open' | 'close'
  reason: string
  stuckCount?: number
  durationMs?: number  // duration open (only on close events)
}

export interface CircuitTimelineResponse {
  events: CircuitEvent[]
  slugs: string[]       // all slugs that have any events
  windowDays: number
  total: number
  page: number
  pageSize: number
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const filterSlug = url.searchParams.get('slug') ?? null
  const filterEvent = url.searchParams.get('event') ?? null   // 'open' | 'close'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const pageSize = 50

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  const cutoff = new Date(Date.now() - windowDays * 24 * 3_600_000).toISOString()
  const allEvents: CircuitEvent[] = []
  const slugsWithEvents = new Set<string>()

  const slugsToScan = filterSlug ? [filterSlug] : allSlugs

  for (const slug of slugsToScan) {
    const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
    let raw = ''
    try { raw = fs.readFileSync(logPath, 'utf-8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let entry: CircuitEvent
      try { entry = JSON.parse(line) as CircuitEvent } catch { continue }

      if (!entry.ts || entry.ts < cutoff) continue
      if (filterEvent && entry.event !== filterEvent) continue

      allEvents.push(entry)
      slugsWithEvents.add(slug)
    }
  }

  // Sort newest first
  allEvents.sort((a, b) => b.ts.localeCompare(a.ts))

  const total = allEvents.length
  const paged = allEvents.slice((page - 1) * pageSize, page * pageSize)

  return Response.json({
    events: paged,
    slugs: [...slugsWithEvents].sort(),
    windowDays,
    total,
    page,
    pageSize,
    generatedAt: new Date().toISOString(),
  } satisfies CircuitTimelineResponse)
}
