import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type HeatGrid = number[][] // [7][24]

export interface TurnHeatmapProject {
  slug: string
  grid: HeatGrid
  total: number
  peakDay: number
  peakHour: number
}

export interface TurnHeatmapResponse {
  projects: TurnHeatmapProject[]
  fleet: HeatGrid
  fleetTotal: number
  fleetPeakDay: number
  fleetPeakHour: number
  windowDays: number
  generatedAt: string
}

interface JsonlLine {
  message?: { role?: string }
  timestamp?: string
}

function emptyGrid(): HeatGrid {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0))
}

function jsDayToMon(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
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

function parseJsonlForTurns(jsonlPath: string, cutoffMs: number, grid: HeatGrid): number {
  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean) } catch { return 0 }
  let count = 0
  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    if (line.message?.role !== 'assistant' || !line.timestamp) continue
    const tsMs = Date.parse(line.timestamp)
    if (isNaN(tsMs) || tsMs < cutoffMs) continue
    const d = new Date(tsMs)
    const day = jsDayToMon(d.getUTCDay())
    const hour = d.getUTCHours()
    grid[day]![hour]!++
    count++
  }
  return count
}

function addGrids(a: HeatGrid, b: HeatGrid): HeatGrid {
  return a.map((row, d) => row.map((v, h) => v + (b[d]?.[h] ?? 0)))
}

function findPeak(grid: HeatGrid): { day: number; hour: number } {
  let maxVal = 0, day = 0, hour = 0
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if ((grid[d]?.[h] ?? 0) > maxVal) {
        maxVal = grid[d]![h]!; day = d; hour = h
      }
    }
  }
  return { day, hour }
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  const projects: TurnHeatmapProject[] = []
  let fleetGrid = emptyGrid()

  for (const slug of slugs) {
    const grid = emptyGrid()
    let total = 0
    for (const f of findJsonlFiles(slug, mcdDir)) {
      total += parseJsonlForTurns(f, cutoffMs, grid)
    }
    if (total === 0) continue
    const { day: peakDay, hour: peakHour } = findPeak(grid)
    projects.push({ slug, grid, total, peakDay, peakHour })
    fleetGrid = addGrids(fleetGrid, grid)
  }

  projects.sort((a, b) => b.total - a.total)

  const fleetTotal = projects.reduce((s, p) => s + p.total, 0)
  const { day: fleetPeakDay, hour: fleetPeakHour } = findPeak(fleetGrid)

  return Response.json({
    projects,
    fleet: fleetGrid,
    fleetTotal,
    fleetPeakDay,
    fleetPeakHour,
    windowDays,
    generatedAt: new Date().toISOString(),
  } satisfies TurnHeatmapResponse)
}
