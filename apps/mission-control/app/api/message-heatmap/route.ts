import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

// grid[day][hour] = count  (day: 0=Mon…6=Sun, hour: 0–23)
export type HeatGrid = number[][]

export interface MessageHeatmapResponse {
  slugs: string[]
  grid: HeatGrid                          // fleet aggregate
  perSlug: Record<string, HeatGrid>       // per-project grids
  totalMessages: number
  peakDay: number                         // 0=Mon…6=Sun
  peakHour: number                        // 0–23
  windowDays: number
  selectedSlug: string | null
  generatedAt: string
}

interface JsonlLine {
  message?: {
    role?: string
    content?: Array<{ type?: string }>
  }
  timestamp?: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
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

function emptyGrid(): HeatGrid {
  return Array.from({ length: 7 }, () => Array(24).fill(0))
}

function isGenuineUserMessage(line: JsonlLine): boolean {
  if (line.message?.role !== 'user') return false
  const c = line.message?.content
  if (!Array.isArray(c) || c.length === 0) return true
  return c[0]?.type !== 'tool_result'
}

// JS getDay(): 0=Sun,1=Mon…6=Sat → convert to Mon=0…Sun=6
function jsDayToMon(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
}

function parseJsonlForHeatmap(jsonlPath: string, cutoffMs: number, grid: HeatGrid): number {
  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean) } catch { return 0 }

  let count = 0
  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    if (!isGenuineUserMessage(line) || !line.timestamp) continue
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
        maxVal = grid[d]![h]!
        day = d; hour = h
      }
    }
  }
  return { day, hour }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const selectedSlug = url.searchParams.get('slug') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  let slugs: string[] = []
  if (channels?.projects) {
    slugs = Object.values(channels.projects)
      .map((p) => p.slug)
      .filter((s): s is string => Boolean(s))
  }

  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000
  const targetSlugs = selectedSlug ? [selectedSlug] : slugs

  const perSlug: Record<string, HeatGrid> = {}
  let fleetGrid = emptyGrid()
  let totalMessages = 0

  for (const slug of targetSlugs) {
    const slugGrid = emptyGrid()
    for (const f of findJsonlFiles(slug, mcdDir)) {
      totalMessages += parseJsonlForHeatmap(f, cutoffMs, slugGrid)
    }
    const hasAny = slugGrid.some((row) => row.some((v) => v > 0))
    if (hasAny) {
      perSlug[slug] = slugGrid
      fleetGrid = addGrids(fleetGrid, slugGrid)
    }
  }

  const displayGrid = selectedSlug && perSlug[selectedSlug] ? perSlug[selectedSlug]! : fleetGrid
  const { day: peakDay, hour: peakHour } = findPeak(displayGrid)

  return Response.json({
    slugs: Object.keys(perSlug),
    grid: displayGrid,
    perSlug,
    totalMessages,
    peakDay,
    peakHour,
    windowDays,
    selectedSlug,
    generatedAt: new Date().toISOString(),
  } satisfies MessageHeatmapResponse)
}
