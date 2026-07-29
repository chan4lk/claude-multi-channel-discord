import { requireSession } from '@/src/security'
import { toolCounts } from '@/src/fact-index'

export const dynamic = 'force-dynamic'

export interface ToolHeatmapResponse {
  projects: string[]
  tools: string[]
  matrix: number[][]   // [projectIdx][toolIdx]
  rowTotals: number[]
  colTotals: number[]
  generatedAt: string
}

export async function GET(request: Request): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  // Pivot the fact-index rows into per-project tool-count maps.
  const bySlug = new Map<string, Record<string, number>>()
  for (const row of toolCounts({ sinceMs: cutoffMs })) {
    const counts = bySlug.get(row.slug) ?? {}
    counts[row.tool_name] = (counts[row.tool_name] ?? 0) + row.count
    bySlug.set(row.slug, counts)
  }

  const perProject = [...bySlug.entries()].map(([slug, counts]) => ({ slug, counts }))

  // Sort projects by total tool calls desc, max 20
  perProject.sort((a, b) =>
    Object.values(b.counts).reduce((s, v) => s + v, 0) -
    Object.values(a.counts).reduce((s, v) => s + v, 0)
  )
  const topProjects = perProject.slice(0, 20)

  // Aggregate tool totals across all projects, pick top 30
  const fleetToolCounts: Record<string, number> = {}
  for (const { counts } of topProjects) {
    for (const [tool, cnt] of Object.entries(counts)) {
      fleetToolCounts[tool] = (fleetToolCounts[tool] ?? 0) + cnt
    }
  }
  const topTools = Object.entries(fleetToolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([t]) => t)

  const projects = topProjects.map((p) => p.slug)
  const matrix = topProjects.map((p) => topTools.map((t) => p.counts[t] ?? 0))
  const rowTotals = matrix.map((row) => row.reduce((s, v) => s + v, 0))
  const colTotals = topTools.map((_, ti) => matrix.reduce((s, row) => s + (row[ti] ?? 0), 0))

  return Response.json({
    projects,
    tools: topTools,
    matrix,
    rowTotals,
    colTotals,
    generatedAt: new Date().toISOString(),
  } satisfies ToolHeatmapResponse)
}
