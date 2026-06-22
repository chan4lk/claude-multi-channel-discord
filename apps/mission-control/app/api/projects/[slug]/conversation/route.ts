import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ToolCallBlock {
  id: string
  name: string
  input: string // JSON-serialized, truncated
}

export interface ConversationTurn {
  id: string
  role: 'human' | 'assistant'
  text: string
  toolCalls?: ToolCallBlock[]
  timestamp: string | null
  date: string // YYYY-MM-DD
}

export interface ConversationResponse {
  slug: string
  turns: ConversationTurn[]
  total: number
  cursor: string | null // opaque: base64 of {fileIndex, lineIndex}
  checkedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }
}

interface RawLine {
  type: string
  timestamp?: string
  message?: {
    role?: string
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }>
  }
}

function parseAllTurns(files: string[]): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let idx = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: RawLine
      try { rec = JSON.parse(line) as RawLine } catch { continue }

      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      const date = ts ? ts.slice(0, 10) : ''
      const content = rec.message?.content ?? []

      if (rec.type === 'human') {
        const text = content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('\n')
          .trim()
        if (text) {
          turns.push({ id: `h-${idx++}`, role: 'human', text: text.slice(0, 2000), timestamp: ts, date })
        }
      } else if (rec.type === 'assistant') {
        const textBlocks = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
        const toolCalls: ToolCallBlock[] = content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({
            id: String(b.id ?? ''),
            name: String(b.name ?? ''),
            input: typeof b.input === 'string' ? b.input.slice(0, 200) : JSON.stringify(b.input ?? {}).slice(0, 200),
          }))
        if (textBlocks || toolCalls.length > 0) {
          turns.push({ id: `a-${idx++}`, role: 'assistant', text: textBlocks.slice(0, 2000), toolCalls, timestamp: ts, date })
        }
      }
    }
  }

  return turns
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))
  const known = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!known.includes(slug)) {
    return Response.json({ error: 'Unknown slug' }, { status: 404 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '40', 10), 100)
  const before = url.searchParams.get('before') // cursor: turn id to paginate before

  const files = findAllJsonl(slug, mcdDir)
  const allTurns = parseAllTurns(files)

  // Newest first
  const reversed = [...allTurns].reverse()
  const total = reversed.length

  let startIdx = 0
  if (before) {
    const idx = reversed.findIndex((t) => t.id === before)
    if (idx >= 0) startIdx = idx + 1
  }

  const page = reversed.slice(startIdx, startIdx + limit)
  const nextCursor = startIdx + limit < total ? page[page.length - 1]?.id ?? null : null

  return Response.json({
    slug, turns: page, total, cursor: nextCursor, checkedAt: new Date().toISOString(),
  } satisfies ConversationResponse)
}
