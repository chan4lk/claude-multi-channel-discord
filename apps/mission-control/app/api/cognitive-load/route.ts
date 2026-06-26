import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CognitiveDimensions {
  thinkingAvg: number
  toolCallsPerTurn: number
  retryRate: number
  subagentDepth: number
  composite: number
}

export interface WorstTurn {
  ts: string
  value: number
  sessionId?: string
}

export interface ProjectCognitiveLoad extends CognitiveDimensions {
  slug: string
  worstTurns: {
    thinking: WorstTurn[]
    toolCalls: WorstTurn[]
    retries: WorstTurn[]
    subagents: WorstTurn[]
  }
}

export interface CognitiveLoadResponse {
  projects: ProjectCognitiveLoad[]
  windowDays: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

interface ContentBlock {
  type?: string
  thinking?: string
  name?: string
  is_error?: boolean
  content?: string | ContentBlock[]
}

interface JsonlLine {
  timestamp?: string
  sessionId?: string
  message?: {
    role?: string
    content?: ContentBlock[]
  }
}

interface TurnStats {
  ts: string
  sessionId?: string
  thinkingChars: number
  toolCalls: number
  toolErrors: number
  subagentDepth: number
}

function analyzeJsonlFile(filePath: string, cutoffMs: number): TurnStats[] {
  const turns: TurnStats[] = []
  let raw = ''
  try { raw = fs.readFileSync(filePath, 'utf-8') } catch { return [] }

  for (const line of raw.trim().split('\n').filter(Boolean)) {
    let rec: JsonlLine
    try { rec = JSON.parse(line) } catch { continue }
    if (!rec.timestamp) continue
    const ts = new Date(rec.timestamp).getTime()
    if (isNaN(ts) || ts < cutoffMs) continue

    const role = rec.message?.role
    const content = rec.message?.content ?? []

    if (role === 'assistant') {
      let thinkingChars = 0
      let toolCalls = 0
      let subagentDepth = 0

      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          thinkingChars += block.thinking.length
        }
        if (block.type === 'tool_use') {
          toolCalls++
          if (block.name === 'Agent') {
            subagentDepth = Math.max(subagentDepth, 1)
          }
        }
      }

      if (toolCalls > 0 || thinkingChars > 0) {
        turns.push({
          ts: rec.timestamp,
          sessionId: rec.sessionId,
          thinkingChars,
          toolCalls,
          toolErrors: 0,
          subagentDepth,
        })
      }
    }

    // Count tool errors from tool_result blocks
    if (role === 'user') {
      for (const block of content) {
        if (block.type === 'tool_result' && block.is_error) {
          // Associate with the latest assistant turn
          if (turns.length > 0) {
            turns[turns.length - 1]!.toolErrors++
          }
        }
      }
    }
  }

  return turns
}

function computePercentile(arr: number[], pct: number): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.floor((pct / 100) * (sorted.length - 1))
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0
}

function normalize(val: number, p50: number, p95: number): number {
  if (p95 <= p50) return 0
  return Math.min(1, Math.max(0, (val - p50) / (p95 - p50)))
}

function topN(turns: TurnStats[], key: keyof Pick<TurnStats, 'thinkingChars' | 'toolCalls' | 'toolErrors' | 'subagentDepth'>, n = 3): WorstTurn[] {
  return [...turns]
    .sort((a, b) => (b[key] as number) - (a[key] as number))
    .slice(0, n)
    .map((t) => ({ ts: t.ts, value: t[key] as number, sessionId: t.sessionId }))
}

function analyzeProject(slug: string, mcdDir: string, cutoffMs: number): ProjectCognitiveLoad | null {
  const allTurns: TurnStats[] = []
  for (const f of findJsonlFiles(slug, mcdDir)) {
    allTurns.push(...analyzeJsonlFile(f, cutoffMs))
  }

  if (allTurns.length === 0) return null

  const thinkingAvg = allTurns.reduce((s, t) => s + t.thinkingChars, 0) / allTurns.length
  const toolCallsPerTurn = allTurns.reduce((s, t) => s + t.toolCalls, 0) / allTurns.length
  const totalToolCalls = allTurns.reduce((s, t) => s + t.toolCalls, 0)
  const totalErrors = allTurns.reduce((s, t) => s + t.toolErrors, 0)
  const retryRate = totalToolCalls > 0 ? totalErrors / totalToolCalls : 0
  const subagentDepth = allTurns.reduce((s, t) => s + t.subagentDepth, 0) / allTurns.length

  // Composite: weighted sum of normalized dimensions
  const composite = Math.round(
    (Math.min(thinkingAvg / 5000, 1) * 25) +
    (Math.min(toolCallsPerTurn / 20, 1) * 25) +
    (Math.min(retryRate, 1) * 25) +
    (Math.min(subagentDepth / 3, 1) * 25)
  )

  return {
    slug,
    thinkingAvg: Math.round(thinkingAvg),
    toolCallsPerTurn: Math.round(toolCallsPerTurn * 10) / 10,
    retryRate: Math.round(retryRate * 1000) / 1000,
    subagentDepth: Math.round(subagentDepth * 10) / 10,
    composite,
    worstTurns: {
      thinking: topN(allTurns, 'thinkingChars'),
      toolCalls: topN(allTurns, 'toolCalls'),
      retries: topN(allTurns, 'toolErrors'),
      subagents: topN(allTurns, 'subagentDepth'),
    },
  }
}

// Silence unused import warning
void computePercentile
void normalize

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(30, parseInt(url.searchParams.get('window') ?? '7', 10)))

  const mcdDir =
    process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000
  const projects: ProjectCognitiveLoad[] = []

  for (const slug of slugs) {
    const result = analyzeProject(slug, mcdDir, cutoffMs)
    if (result) projects.push(result)
  }

  projects.sort((a, b) => b.composite - a.composite)

  return Response.json({
    projects,
    windowDays,
    generatedAt: new Date().toISOString(),
  } satisfies CognitiveLoadResponse)
}
