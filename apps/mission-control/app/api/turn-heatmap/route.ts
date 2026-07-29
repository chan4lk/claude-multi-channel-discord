import { requireSession } from '@/src/security'
import { turnHourDowBuckets } from '@/src/fact-index'

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

function emptyGrid(): HeatGrid {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0))
}

function jsDayToMon(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
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

export async function GET(request: Request): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  // Group the fact-index (slug, UTC dow, hour) buckets into per-project grids.
  const grids = new Map<string, { grid: HeatGrid; total: number }>()
  for (const b of turnHourDowBuckets({ sinceMs: cutoffMs })) {
    let entry = grids.get(b.slug)
    if (!entry) {
      entry = { grid: emptyGrid(), total: 0 }
      grids.set(b.slug, entry)
    }
    const day = jsDayToMon(b.dow)
    entry.grid[day]![b.hour]! += b.count
    entry.total += b.count
  }

  const projects: TurnHeatmapProject[] = []
  let fleetGrid = emptyGrid()

  for (const [slug, { grid, total }] of grids) {
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
