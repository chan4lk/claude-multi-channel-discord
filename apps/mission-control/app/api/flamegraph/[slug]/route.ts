import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export type ToolCategory = 'bash' | 'read' | 'write' | 'agent' | 'mcp' | 'other'

export interface ToolCallFlame {
  name: string
  category: ToolCategory
  startMs: number
  durationMs: number
  status: 'ok' | 'error'
  toolUseId: string
}

export interface TurnFlame {
  turnIndex: number
  startEpoch: number
  durationMs: number
  userSnippet: string
  toolCalls: ToolCallFlame[]
}

export interface FlamegraphResponse {
  slug: string
  turns: TurnFlame[]
  checkedAt: string
}

function categorize(name: string): ToolCategory {
  const n = name.toLowerCase()
  if (n === 'bash') return 'bash'
  if (n === 'read') return 'read'
  if (n === 'write' || n === 'edit') return 'write'
  if (n.startsWith('agent') || n === 'task') return 'agent'
  if (n.startsWith('mcp__')) return 'mcp'
  return 'other'
}

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

interface RawRecord {
  type: string
  timestamp?: string
  message?: {
    content?: Array<{
      type: string
      id?: string
      name?: string
      input?: unknown
    }>
    role?: string
  }
  content?: Array<{
    type: string
    tool_use_id?: string
    content?: unknown
    isError?: boolean
  }>
  isMeta?: boolean
  userType?: string
}

function parseFlame(file: string, maxTurns: number): TurnFlame[] {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf-8') } catch { return [] }
  const lines = raw.trim().split('\n').filter(Boolean)

  const records: (RawRecord & { _ts: number })[] = []
  for (const line of lines) {
    try {
      const r = JSON.parse(line) as RawRecord
      const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0
      records.push({ ...r, _ts: ts })
    } catch {}
  }

  // Build a map from tool_use_id → timestamp of the tool result record
  const toolResultTs = new Map<string, number>()
  const toolResultError = new Map<string, boolean>()
  for (const rec of records) {
    if (rec.type === 'tool' && Array.isArray(rec.content)) {
      for (const block of rec.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          toolResultTs.set(block.tool_use_id, rec._ts)
          if (block.isError) toolResultError.set(block.tool_use_id, true)
        }
      }
    }
  }

  const turns: TurnFlame[] = []
  let i = 0

  while (i < records.length && turns.length < maxTurns * 3) {
    const rec = records[i]
    if (rec.type === 'user' && !rec.isMeta && rec._ts > 0) {
      // Extract user text
      let userSnippet = ''
      const msgContent = rec.message?.content
      if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          const textBlock = block as { type: string; text?: string }
          if (block.type === 'text' && typeof textBlock.text === 'string') {
            userSnippet = textBlock.text.slice(0, 80)
            break
          }
        }
      }
      const turnStart = rec._ts

      // Find the next assistant record(s) that belong to this turn
      const toolCalls: ToolCallFlame[] = []
      let turnEnd = turnStart
      let j = i + 1

      while (j < records.length) {
        const next = records[j]
        if (next.type === 'user' && !next.isMeta) break
        if (next.type === 'assistant' && Array.isArray(next.message?.content)) {
          const assistTs = next._ts > 0 ? next._ts : turnStart
          if (assistTs > turnEnd) turnEnd = assistTs

          for (const block of next.message!.content!) {
            if (block.type === 'tool_use' && block.id && block.name) {
              const resultTs = toolResultTs.get(block.id)
              const callStart = assistTs - turnStart
              const callDur = resultTs && resultTs > assistTs ? resultTs - assistTs : 500
              if (resultTs && resultTs > turnEnd) turnEnd = resultTs
              toolCalls.push({
                name: block.name,
                category: categorize(block.name),
                startMs: Math.max(0, callStart),
                durationMs: Math.max(50, callDur),
                status: toolResultError.get(block.id) ? 'error' : 'ok',
                toolUseId: block.id,
              })
            }
          }
        }
        j++
      }

      const durationMs = Math.max(turnEnd - turnStart, 100)
      turns.push({ turnIndex: turns.length, startEpoch: turnStart, durationMs, userSnippet, toolCalls })
      i = j
    } else {
      i++
    }
  }

  // Return newest-first, capped at maxTurns
  return turns.reverse().slice(0, maxTurns)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ slug, turns: [], checkedAt: new Date().toISOString() } satisfies FlamegraphResponse)

  const url = new URL(req.url)
  const maxTurns = Math.min(parseInt(url.searchParams.get('turns') ?? '20', 10), 40)

  const file = findLatestJsonl(slug, mcdDir)
  const turns = file ? parseFlame(file, maxTurns) : []

  return Response.json({ slug, turns, checkedAt: new Date().toISOString() } satisfies FlamegraphResponse)
}
