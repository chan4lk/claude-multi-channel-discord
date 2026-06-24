import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ToolDayCount {
  tool: string
  day: string    // YYYY-MM-DD
  count: number
}

export interface ToolFrequencyResponse {
  slugs: string[]
  tools: string[]                          // sorted by total desc
  days: string[]                           // YYYY-MM-DD sorted asc, last N days
  counts: Record<string, Record<string, number>>  // counts[tool][day] = n
  top5: Array<{ tool: string; total: number }>
  windowDays: number
  selectedSlug: string | null
  includeMcd: boolean
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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

interface JsonlLine {
  role?: string
  content?: unknown
  timestamp?: string
}

interface ToolUseBlock {
  type: string
  name?: string
}

function extractToolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return (content as ToolUseBlock[])
    .filter((c) => c.type === 'tool_use' && typeof c.name === 'string')
    .map((c) => c.name as string)
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(90, parseInt(url.searchParams.get('days') ?? '30', 10)))
  const selectedSlug = url.searchParams.get('slug') ?? null
  const includeMcd = url.searchParams.get('include_mcd') === '1'

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  const cutoff = Date.now() - windowDays * 24 * 3_600_000

  // Build day list (YYYY-MM-DD) for the window
  const days: string[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3_600_000)
    days.push(d.toISOString().slice(0, 10))
  }

  const slugsToProcess = selectedSlug ? [selectedSlug] : allSlugs

  // counts[tool][day] = n
  const counts: Record<string, Record<string, number>> = {}
  const toolTotals: Record<string, number> = {}

  for (const slug of slugsToProcess) {
    const files = findJsonlFiles(slug, mcdDir)
    for (const file of files) {
      let raw = ''
      try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let msg: JsonlLine
        try { msg = JSON.parse(line) as JsonlLine } catch { continue }

        if (msg.role !== 'assistant' || !msg.timestamp) continue
        const ts = new Date(msg.timestamp).getTime()
        if (ts < cutoff) continue

        const day = msg.timestamp.slice(0, 10)
        const toolCalls = extractToolCalls(msg.content)

        for (const toolName of toolCalls) {
          if (!includeMcd && toolName.startsWith('mcp__mcd__')) continue

          if (!counts[toolName]) counts[toolName] = {}
          counts[toolName][day] = (counts[toolName][day] ?? 0) + 1
          toolTotals[toolName] = (toolTotals[toolName] ?? 0) + 1
        }
      }
    }
  }

  // Sort tools by total desc
  const tools = Object.keys(toolTotals).sort((a, b) => toolTotals[b] - toolTotals[a])
  const top5 = tools.slice(0, 5).map((t) => ({ tool: t, total: toolTotals[t] }))

  return Response.json({
    slugs: allSlugs,
    tools,
    days,
    counts,
    top5,
    windowDays,
    selectedSlug,
    includeMcd,
    generatedAt: new Date().toISOString(),
  } satisfies ToolFrequencyResponse)
}
