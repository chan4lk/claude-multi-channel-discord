import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { upsertTurnQuality, getTurnQuality } from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface TurnQualityCell {
  slug: string
  hour: string  // "2026-06-22T14"
  score: number // 0-100
  turnCount: number
}

export interface TurnQualityResponse {
  rows: TurnQualityCell[]
  slugs: string[]
  hours: string[]
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
  } catch { return [] }
}

const ERROR_PATTERNS = /\b(error|failed|exception|undefined|null is not|cannot read|traceback)\b/i

interface JsonlLine {
  role?: string
  content?: unknown
  timestamp?: string
}

interface TurnData {
  hour: string
  replyLen: number
  toolCallCount: number
  hasError: boolean
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ')
  }
  return ''
}

function countToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return (content as Array<{ type?: string }>).filter((c) => c.type === 'tool_use').length
}

function computeTurns(slug: string, mcdDir: string): TurnData[] {
  const cutoff = Date.now() - 24 * 3_600_000
  const files = findJsonlFiles(slug, mcdDir)
  const turns: TurnData[] = []

  for (const file of files) {
    // Skip files not modified in last 24h
    try { if (fs.statSync(file).mtimeMs < cutoff) continue } catch { continue }
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: JsonlLine | null = null
      try { parsed = JSON.parse(line) as JsonlLine } catch { continue }
      if (!parsed || parsed.role !== 'assistant') continue

      const ts = parsed.timestamp
      if (!ts) continue
      const msTs = new Date(ts).getTime()
      if (msTs < cutoff) continue

      const hour = ts.slice(0, 13) // "2026-06-22T14"
      const text = extractText(parsed.content)
      const toolCalls = countToolCalls(parsed.content)

      turns.push({
        hour,
        replyLen: text.length,
        toolCallCount: toolCalls,
        hasError: ERROR_PATTERNS.test(text),
      })
    }
  }
  return turns
}

function scoreGroup(turns: TurnData[]): number {
  if (turns.length === 0) return 0

  const maxLen = Math.max(...turns.map((t) => t.replyLen), 1)
  const maxTools = Math.max(...turns.map((t) => t.toolCallCount), 1)

  let sum = 0
  for (const t of turns) {
    const lenScore = Math.min(t.replyLen / 500, 1) // saturates at 500 chars
    const toolScore = Math.min(t.toolCallCount / 3, 1) // saturates at 3 tool calls
    const errorPenalty = t.hasError ? 0 : 1
    sum += 0.4 * lenScore + 0.3 * toolScore + 0.3 * errorPenalty
    void maxLen; void maxTools
  }
  return Math.round((sum / turns.length) * 100)
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  const slugs: string[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  for (const slug of slugs) {
    const turns = computeTurns(slug, mcdDir)
    const byHour = new Map<string, TurnData[]>()
    for (const t of turns) {
      const arr = byHour.get(t.hour) ?? []
      arr.push(t)
      byHour.set(t.hour, arr)
    }
    for (const [hour, group] of byHour) {
      upsertTurnQuality(slug, hour, scoreGroup(group), group.length)
    }
  }

  const rows = getTurnQuality(24)
  const allHours = [...new Set(rows.map((r) => r.hour))].sort()
  const allSlugs = [...new Set(rows.map((r) => r.slug))].sort()

  const cells: TurnQualityCell[] = rows.map((r) => ({
    slug: r.slug,
    hour: r.hour,
    score: r.score,
    turnCount: r.turn_count,
  }))

  return Response.json({
    rows: cells,
    slugs: allSlugs,
    hours: allHours,
    computedAt: new Date().toISOString(),
  } satisfies TurnQualityResponse)
}
