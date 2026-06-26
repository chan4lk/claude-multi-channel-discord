import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface InactivityProject {
  slug: string
  dailyTurns: { date: string; count: number }[]
  inactiveDays: number
  totalTurns: number
}

export interface InactivityHeatmapResponse {
  projects: InactivityProject[]
  dates: string[]
  generatedAt: string
}

interface JsonlLine {
  message?: { role?: string }
  timestamp?: string
}

function getLast60Dates(): string[] {
  const dates: string[] = []
  for (let i = 59; i >= 0; i--) {
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
      if (line.message?.role !== 'assistant' || !line.timestamp) continue
      const tsMs = Date.parse(line.timestamp)
      if (isNaN(tsMs) || tsMs < cutoffMs) continue
      const d = new Date(tsMs).toISOString().slice(0, 10)
      if (d in countMap) countMap[d]++
    }
  }
  return countMap
}

export async function GET(): Promise<Response> {
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const dates = getLast60Dates()
  const slugs = getProjectSlugs(mcdDir)

  const projects: InactivityProject[] = []
  for (const slug of slugs) {
    const files = findJsonlFiles(slug, mcdDir)
    const countMap = countTurnsByDay(files, dates)
    const dailyTurns = dates.map((date) => ({ date, count: countMap[date] ?? 0 }))
    const totalTurns = dailyTurns.reduce((s, d) => s + d.count, 0)
    const inactiveDays = dailyTurns.filter((d) => d.count === 0).length
    projects.push({ slug, dailyTurns, inactiveDays, totalTurns })
  }

  // Sort by inactive days desc (most dormant first), max 25
  projects.sort((a, b) => b.inactiveDays - a.inactiveDays || b.totalTurns - a.totalTurns)
  const top25 = projects.slice(0, 25)

  return Response.json({
    projects: top25,
    dates,
    generatedAt: new Date().toISOString(),
  } satisfies InactivityHeatmapResponse)
}
