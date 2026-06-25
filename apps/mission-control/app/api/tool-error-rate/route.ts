import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ToolErrorDay {
  date: string   // YYYY-MM-DD
  errors: number
}

export interface ToolErrorStat {
  tool: string
  calls: number
  errors: number
  errorRate: number        // 0–100
  lastErrorTs: string | null
  commonErrorPrefix: string | null
  sparkline: ToolErrorDay[]   // last 14d
}

export interface ToolErrorRateResponse {
  tools: ToolErrorStat[]
  totalCalls: number
  totalErrors: number
  windowDays: number
  selectedSlug: string | null
  includeMcd: boolean
  generatedAt: string
}

interface ContentBlock {
  type?: string
  name?: string
  tool_use_id?: string
  is_error?: boolean
  content?: string | Array<{ type?: string; text?: string }>
}

interface JsonlLine {
  message?: {
    role?: string
    content?: ContentBlock[]
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

function extractErrorPrefix(block: ContentBlock): string | null {
  if (typeof block.content === 'string') return block.content.slice(0, 80)
  if (Array.isArray(block.content)) {
    for (const c of block.content) {
      if (typeof c.text === 'string' && c.text.trim()) return c.text.slice(0, 80)
    }
  }
  return null
}

interface ToolStats {
  calls: number
  errors: number
  lastErrorTs: string | null
  errorPrefixes: string[]
  dayErrors: Record<string, number>   // YYYY-MM-DD → error count
}

function parseJsonl(
  jsonlPath: string,
  cutoffMs: number,
  includeMcd: boolean,
  // toolUseId → tool name mapping (built from assistant messages)
  stats: Record<string, ToolStats>
): void {
  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean) } catch { return }

  // First pass: build toolUseId → toolName map from assistant tool_use blocks
  const toolNameMap: Record<string, string> = {}
  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    if (line.message?.role !== 'assistant') continue
    for (const block of (line.message.content ?? [])) {
      if (block.type === 'tool_use' && block.name && block.tool_use_id) {
        toolNameMap[block.tool_use_id] = block.name
      }
    }
  }

  // Second pass: parse tool_result blocks
  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    if (!line.timestamp || line.message?.role !== 'user') continue
    const tsMs = Date.parse(line.timestamp)
    if (isNaN(tsMs) || tsMs < cutoffMs) continue

    for (const block of (line.message.content ?? [])) {
      if (block.type !== 'tool_result') continue
      const toolId = block.tool_use_id ?? ''
      const toolName = toolNameMap[toolId] ?? 'unknown'
      if (!includeMcd && toolName.startsWith('mcp__mcd__')) continue

      if (!stats[toolName]) {
        stats[toolName] = { calls: 0, errors: 0, lastErrorTs: null, errorPrefixes: [], dayErrors: {} }
      }
      const s = stats[toolName]!
      s.calls++

      const isErr = block.is_error === true || (() => {
        if (Array.isArray(block.content)) {
          return block.content.some((c) => c.type === 'error')
        }
        return false
      })()

      if (isErr) {
        s.errors++
        if (!s.lastErrorTs || line.timestamp > s.lastErrorTs) s.lastErrorTs = line.timestamp
        const prefix = extractErrorPrefix(block)
        if (prefix) s.errorPrefixes.push(prefix)
        const day = line.timestamp.slice(0, 10)
        s.dayErrors[day] = (s.dayErrors[day] ?? 0) + 1
      }
    }
  }
}

function buildSparkline(dayErrors: Record<string, number>): ToolErrorDay[] {
  const result: ToolErrorDay[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    result.push({ date: d, errors: dayErrors[d] ?? 0 })
  }
  return result
}

function mostCommonPrefix(prefixes: string[]): string | null {
  if (prefixes.length === 0) return null
  const freq: Record<string, number> = {}
  for (const p of prefixes) freq[p] = (freq[p] ?? 0) + 1
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
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

  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000
  const targetSlugs = selectedSlug ? [selectedSlug] : slugs

  const stats: Record<string, ToolStats> = {}
  for (const slug of targetSlugs) {
    for (const f of findJsonlFiles(slug, mcdDir)) {
      parseJsonl(f, cutoffMs, includeMcd, stats)
    }
  }

  let totalCalls = 0, totalErrors = 0
  const tools: ToolErrorStat[] = Object.entries(stats)
    .map(([tool, s]) => {
      totalCalls += s.calls
      totalErrors += s.errors
      return {
        tool,
        calls: s.calls,
        errors: s.errors,
        errorRate: s.calls > 0 ? Math.round((s.errors / s.calls) * 100 * 10) / 10 : 0,
        lastErrorTs: s.lastErrorTs,
        commonErrorPrefix: mostCommonPrefix(s.errorPrefixes),
        sparkline: buildSparkline(s.dayErrors),
      }
    })
    .filter((t) => t.calls > 0)
    .sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors)

  return Response.json({
    tools,
    totalCalls,
    totalErrors,
    windowDays,
    selectedSlug,
    includeMcd,
    generatedAt: new Date().toISOString(),
  } satisfies ToolErrorRateResponse)
}
