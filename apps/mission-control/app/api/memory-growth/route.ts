import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

export const dynamic = 'force-dynamic'

export interface MemoryGrowthSeries {
  slug: string
  dailyNew: number[]   // new files added each day (index = dates index)
}

export interface MemoryGrowthResponse {
  dates: string[]                // length 30, ISO date strings
  series: MemoryGrowthSeries[]   // only projects with ≥1 new file in window
  generatedAt: string
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

function getProjectDir(mcdDir: string, slug: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  try { return fs.realpathSync(p) } catch { return null }
}

// Count memory files first introduced on each date (git --diff-filter=A = added)
function getNewFilesPerDay(projectDir: string, dates: string[]): number[] {
  const countMap: Record<string, number> = {}
  for (const d of dates) countMap[d] = 0
  const since = dates[0]
  try {
    const out = execSync(
      `git -C "${projectDir}" log --diff-filter=A --format="%aI" --name-only --since="${since}" -- memory/`,
      { encoding: 'utf-8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim()
    if (!out) return dates.map(() => 0)

    let currentDate: string | null = null
    for (const line of out.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // ISO timestamp lines: 2026-06-25T14:32:11+00:00
      if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
        currentDate = trimmed.slice(0, 10)
      } else if (currentDate && trimmed.startsWith('memory/') && trimmed.endsWith('.md')) {
        if (currentDate in countMap) countMap[currentDate]++
      }
    }
  } catch { /* no git history */ }
  return dates.map((d) => countMap[d] ?? 0)
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const dates = getLast30Dates()
  const slugs = getProjectSlugs(mcdDir)

  const series: MemoryGrowthSeries[] = []
  for (const slug of slugs) {
    const dir = getProjectDir(mcdDir, slug)
    if (!dir) continue
    const dailyNew = getNewFilesPerDay(dir, dates)
    const total = dailyNew.reduce((s, v) => s + v, 0)
    if (total === 0) continue
    series.push({ slug, dailyNew })
  }

  // Sort by total new files desc so biggest projects stack at bottom
  series.sort((a, b) =>
    b.dailyNew.reduce((s, v) => s + v, 0) - a.dailyNew.reduce((s, v) => s + v, 0)
  )

  return Response.json({
    dates,
    series,
    generatedAt: new Date().toISOString(),
  } satisfies MemoryGrowthResponse)
}
