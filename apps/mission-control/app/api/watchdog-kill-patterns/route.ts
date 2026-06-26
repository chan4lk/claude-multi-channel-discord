import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface HeatmapCell {
  hour: number  // 0-23
  day: number   // 0=Sun, 6=Sat
  count: number
}

export interface PrecedingTool {
  tool: string
  count: number
}

export interface ContextPressurePoint {
  slug: string
  contextPct: number
  killCount: number
  ts: string
}

export interface WatchdogKillPatternsResponse {
  heatmap: HeatmapCell[]
  precedingTools: PrecedingTool[]
  contextPressure: ContextPressurePoint[]
  killRatePer7d: number
  totalKills: number
  slugOptions: string[]
  generatedAt: string
}

interface RawKillEvent {
  ts: string
  slug: string
  runtimeMs: number | null
  lastToolCall: string | null
  reason: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function readKillsForSlug(slug: string, mcdDir: string): RawKillEvent[] {
  const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return [] }
  const events: RawKillEvent[] = []
  for (const line of raw.trim().split('\n')) {
    if (!line) continue
    try {
      const obj = JSON.parse(line) as RawKillEvent
      if (obj.ts) events.push({ ...obj, slug })
    } catch { /* skip */ }
  }
  return events
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getContextPct(slug: string, mcdDir: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let latestFile = ''
  let latestMtime = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const st = fs.statSync(path.join(transcriptDir, file))
        if (st.mtimeMs > latestMtime) { latestMtime = st.mtimeMs; latestFile = path.join(transcriptDir, file) }
      } catch { /* skip */ }
    }
  } catch { return 0 }
  if (!latestFile) return 0
  try {
    const lines = fs.readFileSync(latestFile, 'utf-8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]) as { message?: { usage?: { cache_read_input_tokens?: number; input_tokens?: number } } }
        const usage = obj?.message?.usage
        if (usage) {
          const total = (usage.cache_read_input_tokens ?? 0) + (usage.input_tokens ?? 0)
          return Math.min(100, Math.round((total / 200000) * 100))
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return 0
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams
  const filterSlug = sp.get('slug') ?? ''
  const since = sp.get('since') ?? ''
  const until = sp.get('until') ?? ''

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const allSlugs = Object.values(channels?.projects ?? {})
    .map((p) => p.slug)
    .filter((s): s is string => !!s)

  const targetSlugs = filterSlug ? [filterSlug] : allSlugs

  const sinceMs = since ? new Date(since).getTime() : 0
  const untilMs = until ? new Date(until).getTime() : Infinity

  // Collect all kill events
  const allEvents: RawKillEvent[] = []
  for (const slug of targetSlugs) {
    const events = readKillsForSlug(slug, mcdDir)
    allEvents.push(...events)
  }

  // Filter by date range
  const filtered = allEvents.filter((e) => {
    const ms = new Date(e.ts).getTime()
    return ms >= sinceMs && ms <= untilMs
  })

  // Build 7×24 heatmap
  const heatmapMap = new Map<string, number>()
  for (const e of filtered) {
    const d = new Date(e.ts)
    const key = `${d.getUTCDay()}-${d.getUTCHours()}`
    heatmapMap.set(key, (heatmapMap.get(key) ?? 0) + 1)
  }
  const heatmap: HeatmapCell[] = []
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = heatmapMap.get(`${day}-${hour}`) ?? 0
      heatmap.push({ hour, day, count })
    }
  }

  // Top-10 preceding tools
  const toolCounts = new Map<string, number>()
  for (const e of filtered) {
    const tool = e.lastToolCall ?? '(none)'
    toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1)
  }
  const precedingTools: PrecedingTool[] = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }))

  // Context pressure per slug (current pressure + kill count)
  const contextPressure: ContextPressurePoint[] = targetSlugs
    .map((slug) => {
      const slugKills = filtered.filter((e) => e.slug === slug)
      if (slugKills.length === 0) return null
      const lastKill = slugKills[slugKills.length - 1]
      return {
        slug,
        contextPct: getContextPct(slug, mcdDir),
        killCount: slugKills.length,
        ts: lastKill.ts,
      }
    })
    .filter((x): x is ContextPressurePoint => x !== null)

  // Kill rate per 7d
  const sevenDaysAgo = Date.now() - 7 * 86_400_000
  const killsLast7d = allEvents.filter((e) => new Date(e.ts).getTime() >= sevenDaysAgo).length
  const killRatePer7d = Math.round((killsLast7d / 7) * 10) / 10

  return Response.json({
    heatmap,
    precedingTools,
    contextPressure,
    killRatePer7d,
    totalKills: filtered.length,
    slugOptions: allSlugs.sort(),
    generatedAt: new Date().toISOString(),
  } satisfies WatchdogKillPatternsResponse)
}
