import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface DailyPoint {
  date: string
  count: number
}

export interface ProjectGrowth {
  slug: string
  total: number
  daily: DailyPoint[]
}

export interface MemoryGrowthResponse {
  days: string[]
  projects: ProjectGrowth[]
  generatedAt: string
}

const WINDOW_DAYS = 30

function dayString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function windowDays(): string[] {
  const out: string[] = []
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1))
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    out.push(dayString(d))
  }
  return out
}

// Per-entry creation date approximated by file mtime (memory files are append-once mostly).
function entryDates(memDir: string): string[] {
  let files: string[] = []
  try {
    files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch {
    return []
  }
  const dates: string[] = []
  for (const f of files) {
    try {
      const stat = fs.statSync(path.join(memDir, f))
      dates.push(dayString(new Date(stat.mtimeMs)))
    } catch { /* skip */ }
  }
  return dates
}

export async function GET(): Promise<Response> {
  const days = windowDays()
  const mcdDir = process.env.MCD_CHANNELS_DIR

  const empty: MemoryGrowthResponse = { days, projects: [], generatedAt: new Date().toISOString() }
  if (!mcdDir) return Response.json(empty)

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const stat = fs.statSync(path.join(projectsDir, s))
        return stat.isDirectory() || stat.isSymbolicLink()
      } catch { return false }
    })
  } catch {
    return Response.json(empty)
  }

  const firstDay = days[0]
  const projects: ProjectGrowth[] = []

  for (const slug of slugs) {
    const memDir = path.join(projectsDir, slug, 'memory')
    const dates = entryDates(memDir)
    if (dates.length === 0) continue

    // Count entries created on or before each day in the window (cumulative).
    // Entries predating the window are folded into the first day's baseline.
    const baseline = dates.filter((d) => d < firstDay).length
    const daily: DailyPoint[] = days.map((day) => {
      const created = dates.filter((d) => d >= firstDay && d <= day).length
      return { date: day, count: baseline + created }
    })
    projects.push({ slug, total: dates.length, daily })
  }

  // Sort by current memory total desc so the legend and stacking are stable.
  projects.sort((a, b) => b.total - a.total)

  return Response.json({ days, projects, generatedAt: new Date().toISOString() } satisfies MemoryGrowthResponse)
}
