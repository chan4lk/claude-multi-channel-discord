import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface VelocityProject {
  slug: string
  platform: 'discord' | 'teams' | 'whatsapp'
  daily: { date: string; count: number }[]
  sevenDayTotal: number
  trend: 'rising' | 'falling' | 'flat'
}

export interface VelocityWallResponse {
  projects: VelocityProject[]
  mostActive: string | null
  fleetDailyAvg: number
  generatedAt: string
}

interface JsonlLine {
  message?: { role?: string; content?: unknown[] }
  timestamp?: string
}

function getLast30Dates(): string[] {
  const dates: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

function getProjectSlugs(mcdDir: string): string[] {
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    return fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch { return [] }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function countTurnsByDay(jsonlPaths: string[], dates: string[]): Record<string, number> {
  const countMap: Record<string, number> = {}
  for (const d of dates) countMap[d] = 0
  const cutoffMs = Date.parse(dates[0]!) - 86_400_000

  for (const p of jsonlPaths) {
    let lines: string[]
    try { lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (line.message?.role !== 'user' || !line.timestamp) continue
      const content = line.message.content
      if (!Array.isArray(content) || content.length === 0) continue
      const first = content[0] as { type?: string }
      if (first?.type === 'tool_result') continue
      const tsMs = Date.parse(line.timestamp)
      if (isNaN(tsMs) || tsMs < cutoffMs) continue
      const d = new Date(tsMs).toISOString().slice(0, 10)
      if (d in countMap) countMap[d]++
    }
  }
  return countMap
}

function calcTrend(daily: { date: string; count: number }[]): 'rising' | 'falling' | 'flat' {
  const recent = daily.slice(-7).reduce((s, d) => s + d.count, 0) / 7
  const prior = daily.slice(-14, -7).reduce((s, d) => s + d.count, 0) / 7
  if (prior < 0.01) return recent > 0.1 ? 'rising' : 'flat'
  const ratio = recent / prior
  if (ratio > 1.15) return 'rising'
  if (ratio < 0.85) return 'falling'
  return 'flat'
}

function buildSlugPlatformMap(mcdDir: string): Record<string, 'discord' | 'teams' | 'whatsapp'> {
  const map: Record<string, 'discord' | 'teams' | 'whatsapp'> = {}
  try {
    const raw = fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')
    const cfg = JSON.parse(raw) as {
      projects?: Record<string, { slug?: string; platform?: string }>
    }
    for (const proj of Object.values(cfg.projects ?? {})) {
      if (!proj.slug) continue
      const p = proj.platform
      map[proj.slug] = (p === 'teams' || p === 'whatsapp') ? p : 'discord'
    }
  } catch {}
  return map
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const dates = getLast30Dates()
  const slugs = getProjectSlugs(mcdDir)
  const platformMap = buildSlugPlatformMap(mcdDir)

  const projects: VelocityProject[] = []
  for (const slug of slugs) {
    const files = findJsonlFiles(slug, mcdDir)
    const countMap = countTurnsByDay(files, dates)
    const daily = dates.map((date) => ({ date, count: countMap[date] ?? 0 }))
    const sevenDayTotal = daily.slice(-7).reduce((s, d) => s + d.count, 0)
    const trend = calcTrend(daily)
    const platform = platformMap[slug] ?? 'discord'
    projects.push({ slug, platform, daily, sevenDayTotal, trend })
  }

  projects.sort((a, b) => b.sevenDayTotal - a.sevenDayTotal)

  const mostActive = projects.length > 0 ? projects[0]!.slug : null
  const totalTurns = projects.reduce((s, p) => s + p.daily.reduce((a, d) => a + d.count, 0), 0)
  const fleetDailyAvg = projects.length > 0 ? totalTurns / 30 : 0

  return Response.json({
    projects,
    mostActive,
    fleetDailyAvg: Math.round(fleetDailyAvg * 10) / 10,
    generatedAt: new Date().toISOString(),
  } satisfies VelocityWallResponse)
}
