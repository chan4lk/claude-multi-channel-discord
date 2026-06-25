import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface SparklineDay {
  date: string   // YYYY-MM-DD
  opens: number
}

export interface ProjectMttr {
  slug: string
  totalOpens: number
  totalCloses: number
  mttrMs: number | null        // avg ms open; null if no close events with durationMs
  longestOpenMs: number | null
  opensPerWeek: number
  lastEventTs: string | null
  lastEventType: 'open' | 'close' | null
  sparkline: SparklineDay[]    // last 30d, opens per day
}

export interface CircuitMttrResponse {
  projects: ProjectMttr[]
  generatedAt: string
}

interface RawEvent {
  ts: string
  slug: string
  event: 'open' | 'close'
  reason?: string
  stuckCount?: number
  durationMs?: number
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function isoToDate(ts: string): string {
  return ts.slice(0, 10)
}

function analyzeProject(logPath: string, slug: string, windowMs: number): ProjectMttr | null {
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return null }

  const cutoff = Date.now() - windowMs
  const events: RawEvent[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const e = JSON.parse(trimmed) as RawEvent
      if (e.ts && e.event) events.push(e)
    } catch { continue }
  }

  if (events.length === 0) return null

  // Compute stats over all time (not windowed) for totals
  let totalOpens = 0
  let totalCloses = 0
  let sumDurationMs = 0
  let closesWithDuration = 0
  let longestOpenMs: number | null = null

  for (const e of events) {
    if (e.event === 'open') totalOpens++
    if (e.event === 'close') {
      totalCloses++
      if (typeof e.durationMs === 'number') {
        sumDurationMs += e.durationMs
        closesWithDuration++
        if (longestOpenMs === null || e.durationMs > longestOpenMs) longestOpenMs = e.durationMs
      }
    }
  }

  const mttrMs = closesWithDuration > 0 ? Math.round(sumDurationMs / closesWithDuration) : null

  // Opens per week (last 30d)
  const cutoffDate = new Date(cutoff).toISOString()
  const recentOpens = events.filter((e) => e.event === 'open' && e.ts >= cutoffDate)
  const opensPerWeek = Math.round((recentOpens.length / 30) * 7 * 10) / 10

  // Last event
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts))
  const last = sorted[sorted.length - 1]
  const lastEventTs = last?.ts ?? null
  const lastEventType = (last?.event as 'open' | 'close') ?? null

  // Sparkline: opens per day last 30d
  const sparkMap: Record<string, number> = {}
  for (const e of recentOpens) {
    const d = isoToDate(e.ts)
    sparkMap[d] = (sparkMap[d] ?? 0) + 1
  }

  const sparkline: SparklineDay[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000)
    const dateStr = d.toISOString().slice(0, 10)
    sparkline.push({ date: dateStr, opens: sparkMap[dateStr] ?? 0 })
  }

  return {
    slug,
    totalOpens,
    totalCloses,
    mttrMs,
    longestOpenMs,
    opensPerWeek,
    lastEventTs,
    lastEventType,
    sparkline,
  }
}

export async function GET(): Promise<Response> {
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

  const WINDOW_MS = 30 * 24 * 3_600_000
  const projects: ProjectMttr[] = []

  for (const slug of slugs) {
    const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
    const result = analyzeProject(logPath, slug, WINDOW_MS)
    if (result) projects.push(result)
  }

  // Sort by totalOpens desc
  projects.sort((a, b) => b.totalOpens - a.totalOpens)

  return Response.json({
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies CircuitMttrResponse)
}
