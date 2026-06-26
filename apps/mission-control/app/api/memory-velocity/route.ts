import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface DailyCount {
  date: string
  count: number
}

export interface MemoryVelocityProject {
  slug: string
  dailyCounts: DailyCount[]
  total: number
  trend: 'up' | 'down' | 'stable'
}

export interface MemoryVelocityResponse {
  projects: MemoryVelocityProject[]
  fleet: DailyCount[]
  topSlug: string | null
  dates: string[]
  generatedAt: string
}

function getLast14Dates(): string[] {
  const dates: string[] = []
  for (let i = 13; i >= 0; i--) {
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

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

function computeTrend(dailyCounts: DailyCount[]): 'up' | 'down' | 'stable' {
  if (dailyCounts.length < 6) return 'stable'
  const n = dailyCounts.length
  const recent = dailyCounts.slice(n - 3).reduce((s, d) => s + d.count, 0)
  const prior = dailyCounts.slice(n - 6, n - 3).reduce((s, d) => s + d.count, 0)
  if (recent > prior + 1) return 'up'
  if (recent < prior - 1) return 'down'
  return 'stable'
}

function getDailyCounts(projectDir: string, dates: string[]): DailyCount[] {
  const countMap: Record<string, number> = {}
  for (const d of dates) countMap[d] = 0
  const since = dates[0]
  try {
    const out = execSync(
      `git -C "${projectDir}" log --format="%aI" --since="${since}" -- memory/`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!out) return dates.map((date) => ({ date, count: 0 }))
    for (const line of out.split('\n')) {
      const ts = line.trim()
      if (!ts) continue
      const d = ts.slice(0, 10)
      if (d in countMap) countMap[d]++
    }
  } catch { /* no git history or no memory dir */ }
  return dates.map((date) => ({ date, count: countMap[date] ?? 0 }))
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const dates = getLast14Dates()
  const slugs = getProjectSlugs(mcdDir)

  const projects: MemoryVelocityProject[] = []
  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const dc = getDailyCounts(dir, dates)
    const total = dc.reduce((s, d) => s + d.count, 0)
    const trend = computeTrend(dc)
    projects.push({ slug, dailyCounts: dc, total, trend })
  }

  // Sort by 3-day velocity desc, then total desc
  projects.sort((a, b) => {
    const aRecent = a.dailyCounts.slice(-3).reduce((s, d) => s + d.count, 0)
    const bRecent = b.dailyCounts.slice(-3).reduce((s, d) => s + d.count, 0)
    return bRecent - aRecent || b.total - a.total
  })

  const top20 = projects.slice(0, 20)

  const fleet: DailyCount[] = dates.map((date, i) => ({
    date,
    count: projects.reduce((s, p) => s + (p.dailyCounts[i]?.count ?? 0), 0),
  }))

  const topSlug =
    projects.length > 0
      ? projects.reduce((best, p) => {
          const pScore = p.dailyCounts.slice(-3).reduce((s, d) => s + d.count, 0)
          const bScore = best.dailyCounts.slice(-3).reduce((s, d) => s + d.count, 0)
          return pScore > bScore ? p : best
        }).slug
      : null

  return Response.json({
    projects: top20,
    fleet,
    topSlug,
    dates,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryVelocityResponse)
}
