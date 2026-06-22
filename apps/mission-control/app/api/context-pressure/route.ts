import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { upsertContextPressure, getContextPressureHistory, type ContextPressureBreakdown } from '../../../src/db'

export const dynamic = 'force-dynamic'

// Tokens per byte rough proxy (UTF-8, mixed code+prose)
const BYTES_PER_TOKEN = 4
// Model context limits (tokens)
const MODEL_CONTEXT: Record<string, number> = {
  'claude-opus-4': 200_000,
  'claude-sonnet-4': 200_000,
  'claude-haiku-4': 200_000,
  default: 200_000,
}

export interface ContextPressureProject {
  slug: string
  score: number // 0-100
  breakdown: ContextPressureBreakdown
  contextLimit: number
  usedTokens: number
  trend: Array<{ ts: number; score: number }>
}

export interface ContextPressureResponse {
  projects: ContextPressureProject[]
  computedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  } catch { return [] }
}

interface JsonlLine {
  type?: string
  role?: string
  content?: unknown
}

function estimateTokens(slug: string, mcdDir: string, claudeMdPath: string): {
  systemTokens: number
  historyTokens: number
  toolTokens: number
} {
  // System prompt = CLAUDE.md size
  let systemBytes = 0
  try { systemBytes = fs.statSync(claudeMdPath).size } catch { /* ok */ }

  const files = findJsonlFiles(slug, mcdDir)
  let historyBytes = 0
  let toolBytes = 0

  for (const f of files) {
    let content = ''
    try { content = fs.readFileSync(f, 'utf-8') } catch { continue }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      let parsed: JsonlLine | null = null
      try { parsed = JSON.parse(line) as JsonlLine } catch { continue }
      if (!parsed) continue
      const isToolResult = parsed.role === 'tool' ||
        (parsed.type === 'message' && Array.isArray(parsed.content) &&
          (parsed.content as Array<{ type?: string }>).some((c) => c.type === 'tool_result'))
      if (isToolResult) {
        toolBytes += line.length
      } else {
        historyBytes += line.length
      }
    }
  }

  return {
    systemTokens: Math.round(systemBytes / BYTES_PER_TOKEN),
    historyTokens: Math.round(historyBytes / BYTES_PER_TOKEN),
    toolTokens: Math.round(toolBytes / BYTES_PER_TOKEN),
  }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string; model?: string }> }>(channelsPath)
  const slugs: string[] = []
  const modelMap: Record<string, string> = {}

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') {
        slugs.push(proj.slug)
        modelMap[proj.slug] = proj.model ?? 'default'
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const projects: ContextPressureProject[] = []

  for (const slug of slugs) {
    const claudeMdPath = path.join(mcdDir, 'projects', slug, 'CLAUDE.md')
    const breakdown = estimateTokens(slug, mcdDir, claudeMdPath)
    const modelKey = Object.keys(MODEL_CONTEXT).find((k) => modelMap[slug]?.includes(k)) ?? 'default'
    const contextLimit = MODEL_CONTEXT[modelKey] ?? MODEL_CONTEXT.default
    const usedTokens = breakdown.systemTokens + breakdown.historyTokens + breakdown.toolTokens
    const score = Math.min(100, Math.round((usedTokens / contextLimit) * 100))

    upsertContextPressure(slug, score, breakdown)
    const trend = getContextPressureHistory(slug, 14)

    projects.push({ slug, score, breakdown, contextLimit, usedTokens, trend })
  }

  projects.sort((a, b) => b.score - a.score)

  return Response.json({
    projects,
    computedAt: new Date().toISOString(),
  } satisfies ContextPressureResponse)
}
