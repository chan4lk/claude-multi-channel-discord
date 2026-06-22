import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ReplayToolCall {
  name: string
  input: string   // truncated JSON
  output: string  // truncated
  status: 'ok' | 'error'
  durationMs: number
  toolUseId: string
}

export interface ReplayTurn {
  turnIndex: number      // 0-based
  userText: string
  assistantText: string  // full reply text
  toolCalls: ReplayToolCall[]
  diffFromPrev: string   // line-level diff vs previous assistantText
  startEpoch: number
  durationMs: number
}

export interface ReplayResponse {
  slug: string
  turns: ReplayTurn[]   // oldest first
  total: number
  checkedAt: string
}

const MAX_INPUT_CHARS = 300
const MAX_OUTPUT_CHARS = 400
const MAX_TEXT_CHARS = 2000

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findLatestJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch { return null }
  if (files.length === 0) return null
  let latest = ''
  let latestMtime = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
      if (m > latestMtime) { latestMtime = m; latest = path.join(transcriptDir, f) }
    } catch {}
  }
  return latest || null
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

function jsonTrunc(v: unknown, max: number): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
    return truncate(s, max)
  } catch {
    return '…'
  }
}

// Simple line diff: highlight lines added/removed between two texts
function lineDiff(prev: string, curr: string): string {
  if (!prev) return curr.split('\n').slice(0, 20).map(l => `+ ${l}`).join('\n')
  const prevLines = new Set(prev.split('\n'))
  const currLines = new Set(curr.split('\n'))
  const lines: string[] = []
  for (const l of curr.split('\n')) {
    if (!prevLines.has(l)) lines.push(`+ ${l}`)
  }
  for (const l of prev.split('\n')) {
    if (!currLines.has(l)) lines.push(`- ${l}`)
  }
  return truncate(lines.slice(0, 40).join('\n'), 1500) || '(no text change)'
}

interface RawRecord {
  type: string
  isMeta?: boolean
  timestamp?: string
  message?: {
    role?: string
    content?: Array<{
      type: string
      id?: string
      name?: string
      input?: unknown
      text?: string
      tool_use_id?: string
      content?: unknown
      isError?: boolean
    }>
  }
  content?: Array<{
    type: string
    tool_use_id?: string
    content?: unknown
    isError?: boolean
  }>
  _ts: number
}

function parseReplay(file: string, maxTurns: number): ReplayTurn[] {
  let raw: string
  try { raw = fs.readFileSync(file, 'utf-8') } catch { return [] }

  const records: RawRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as RawRecord
      const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0
      records.push({ ...r, _ts: ts })
    } catch {}
  }

  // Build result ts / error map
  const toolResultTs = new Map<string, number>()
  const toolResultOutput = new Map<string, string>()
  const toolResultError = new Map<string, boolean>()
  for (const rec of records) {
    const contentArr = rec.type === 'tool' ? rec.content : rec.message?.content
    if (Array.isArray(contentArr)) {
      for (const block of contentArr) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          toolResultTs.set(block.tool_use_id, rec._ts)
          if (block.isError) toolResultError.set(block.tool_use_id, true)
          const out = block.content
          toolResultOutput.set(
            block.tool_use_id,
            jsonTrunc(out, MAX_OUTPUT_CHARS)
          )
        }
      }
    }
  }

  const turns: ReplayTurn[] = []
  let i = 0
  let prevAssistantText = ''

  while (i < records.length && turns.length < maxTurns * 3) {
    const rec = records[i]
    if (rec.type === 'user' && !rec.isMeta && rec._ts > 0) {
      let userText = ''
      if (Array.isArray(rec.message?.content)) {
        for (const block of rec.message!.content!) {
          if (block.type === 'text' && typeof block.text === 'string') {
            userText = truncate(block.text, MAX_TEXT_CHARS)
            break
          }
        }
      }
      const turnStart = rec._ts

      const toolCalls: ReplayToolCall[] = []
      let assistantText = ''
      let turnEnd = turnStart
      let j = i + 1

      while (j < records.length) {
        const next = records[j]
        if (next.type === 'user' && !next.isMeta) break
        if (next.type === 'assistant' && Array.isArray(next.message?.content)) {
          const assistTs = next._ts > 0 ? next._ts : turnStart
          if (assistTs > turnEnd) turnEnd = assistTs

          for (const block of next.message!.content!) {
            if (block.type === 'text' && typeof block.text === 'string') {
              // accumulate all assistant text blocks
              if (assistantText) assistantText += '\n'
              assistantText += block.text
            }
            if (block.type === 'tool_use' && block.id && block.name) {
              const resultTs = toolResultTs.get(block.id)
              const callDur = resultTs && resultTs > assistTs ? resultTs - assistTs : 500
              if (resultTs && resultTs > turnEnd) turnEnd = resultTs
              toolCalls.push({
                name: block.name,
                input: jsonTrunc(block.input, MAX_INPUT_CHARS),
                output: toolResultOutput.get(block.id) ?? '—',
                status: toolResultError.get(block.id) ? 'error' : 'ok',
                durationMs: Math.max(50, callDur),
                toolUseId: block.id,
              })
            }
          }
        }
        j++
      }

      const trimmedAssistant = truncate(assistantText.trim(), MAX_TEXT_CHARS)
      const diff = lineDiff(prevAssistantText, trimmedAssistant)
      prevAssistantText = trimmedAssistant

      turns.push({
        turnIndex: turns.length,
        userText,
        assistantText: trimmedAssistant,
        toolCalls,
        diffFromPrev: diff,
        startEpoch: turnStart,
        durationMs: Math.max(turnEnd - turnStart, 100),
      })
      i = j
    } else {
      i++
    }
  }

  return turns.slice(0, maxTurns)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({
      slug, turns: [], total: 0, checkedAt: new Date().toISOString()
    } satisfies ReplayResponse)
  }

  const url = new URL(req.url)
  const maxTurns = Math.min(parseInt(url.searchParams.get('turns') ?? '50', 10), 100)

  const file = findLatestJsonl(slug, mcdDir)
  const turns = file ? parseReplay(file, maxTurns) : []

  return Response.json({
    slug,
    turns,
    total: turns.length,
    checkedAt: new Date().toISOString(),
  } satisfies ReplayResponse)
}
