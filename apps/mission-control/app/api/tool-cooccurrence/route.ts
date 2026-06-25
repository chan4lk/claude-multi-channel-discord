import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CooccurrenceTurn {
  turnIdx: number
  ts: string
  tools: string[]
}

export interface ToolCooccurrenceResponse {
  tools: string[]              // sorted by total desc
  matrix: number[][]           // tools × tools, symmetric, diagonal = solo count
  turns: CooccurrenceTurn[]    // turns with ≥2 tools (for drawer)
  totalCounts: Record<string, number>
  windowDays: number
  selectedSlug: string | null
  includeMcd: boolean
  generatedAt: string
}

interface JsonlLine {
  message?: {
    role?: string
    content?: Array<{ type?: string; name?: string }>
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

function isGenuineUserMessage(line: JsonlLine): boolean {
  if (line.message?.role !== 'user') return false
  const c = line.message?.content
  if (!Array.isArray(c) || c.length === 0) return true
  return c[0]?.type !== 'tool_result'
}

function extractCooccurrenceData(
  jsonlPath: string,
  cutoffMs: number,
  includeMcd: boolean
): CooccurrenceTurn[] {
  let rawLines: string[]
  try {
    rawLines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean)
  } catch { return [] }

  const turns: CooccurrenceTurn[] = []
  let currentTurnTools: string[] = []
  let currentTurnTs = ''
  let turnIdx = 0

  function flushTurn() {
    if (currentTurnTools.length > 0) {
      const filtered = currentTurnTools.filter(
        (t) => includeMcd || !t.startsWith('mcp__mcd__')
      )
      if (filtered.length > 0) {
        turns.push({ turnIdx, ts: currentTurnTs, tools: filtered })
        turnIdx++
      }
    }
    currentTurnTools = []
  }

  for (const raw of rawLines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }

    if (!line.timestamp) continue
    const tsMs = Date.parse(line.timestamp)
    if (isNaN(tsMs) || tsMs < cutoffMs) continue

    if (isGenuineUserMessage(line)) {
      flushTurn()
      currentTurnTs = line.timestamp
      continue
    }

    if (line.message?.role === 'assistant') {
      const content = line.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'tool_use' && typeof block.name === 'string') {
          currentTurnTools.push(block.name)
        }
      }
    }
  }
  flushTurn()

  return turns
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const selectedSlug = url.searchParams.get('slug') ?? null
  const includeMcd = url.searchParams.get('include_mcd') === '1'

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
  if (selectedSlug && !slugs.includes(selectedSlug)) slugs.push(selectedSlug)

  const targetSlugs = selectedSlug ? [selectedSlug] : slugs
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  const allTurns: CooccurrenceTurn[] = []
  for (const slug of targetSlugs) {
    for (const f of findJsonlFiles(slug, mcdDir)) {
      allTurns.push(...extractCooccurrenceData(f, cutoffMs, includeMcd))
    }
  }

  // Build total counts
  const totalCounts: Record<string, number> = {}
  for (const turn of allTurns) {
    for (const tool of turn.tools) {
      totalCounts[tool] = (totalCounts[tool] ?? 0) + 1
    }
  }

  // Sort tools by total desc, cap at 20
  const tools = Object.keys(totalCounts)
    .sort((a, b) => (totalCounts[b] ?? 0) - (totalCounts[a] ?? 0))
    .slice(0, 20)

  const N = tools.length
  const toolIdx = Object.fromEntries(tools.map((t, i) => [t, i]))

  // Build N×N matrix
  const matrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  for (const turn of allTurns) {
    const idxs = [...new Set(turn.tools.map((t) => toolIdx[t]).filter((i) => i !== undefined))]
    for (let a = 0; a < idxs.length; a++) {
      matrix[idxs[a]][idxs[a]]++  // diagonal = solo appearances
      for (let b = a + 1; b < idxs.length; b++) {
        matrix[idxs[a]][idxs[b]]++
        matrix[idxs[b]][idxs[a]]++
      }
    }
  }

  // Only return turns with ≥2 distinct tools for the drawer
  const multiTurns = allTurns.filter((t) => new Set(t.tools).size >= 2).slice(0, 200)

  return Response.json({
    tools,
    matrix,
    turns: multiTurns,
    totalCounts,
    windowDays,
    selectedSlug,
    includeMcd,
    generatedAt: new Date().toISOString(),
  } satisfies ToolCooccurrenceResponse)
}
