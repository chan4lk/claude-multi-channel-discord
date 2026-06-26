import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ToolHeatmapResponse {
  projects: string[]
  tools: string[]
  matrix: number[][]   // [projectIdx][toolIdx]
  rowTotals: number[]
  colTotals: number[]
  generatedAt: string
}

interface JsonlLine {
  type?: string
  message?: {
    role?: string
    content?: Array<{ type?: string; name?: string }>
  }
  timestamp?: string
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

function countToolCalls(jsonlPaths: string[], cutoffMs: number): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of jsonlPaths) {
    let lines: string[]
    try { lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (line.timestamp) {
        const tsMs = Date.parse(line.timestamp)
        if (isNaN(tsMs) || tsMs < cutoffMs) continue
      }
      const content = line.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'tool_use' && block.name) {
          counts[block.name] = (counts[block.name] ?? 0) + 1
        }
      }
    }
  }
  return counts
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const slugs = getProjectSlugs(mcdDir)
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  const perProject: { slug: string; counts: Record<string, number> }[] = []
  for (const slug of slugs) {
    const files = findJsonlFiles(slug, mcdDir)
    if (files.length === 0) continue
    const counts = countToolCalls(files, cutoffMs)
    if (Object.keys(counts).length === 0) continue
    perProject.push({ slug, counts })
  }

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
