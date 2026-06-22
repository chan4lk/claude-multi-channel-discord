import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface TurnEntry {
  index: number
  ts: string
  text: string
  toolCalls: string[]
  charCount: number
}

export interface TurnsDetailResponse {
  slug: string
  turns: TurnEntry[]
  checkedAt: string
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findLatestJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try {
    realPath = fs.realpathSync(projectPath)
  } catch {
    return null
  }

  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  if (jsonlFiles.length === 0) return null

  let latestFile = ''
  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(path.join(transcriptDir, file)).mtimeMs
      if (mtime > latestMtime) {
        latestMtime = mtime
        latestFile = path.join(transcriptDir, file)
      }
    } catch {}
  }
  return latestFile || null
}

function parseTurns(transcriptFile: string, limit: number): TurnEntry[] {
  const turns: TurnEntry[] = []
  let content = ''
  try {
    content = fs.readFileSync(transcriptFile, 'utf-8')
  } catch {
    return turns
  }

  const lines = content.trim().split('\n').filter(Boolean)
  let idx = 0

  for (const line of lines) {
    try {
      const record = JSON.parse(line)
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        const textParts: string[] = []
        const toolCalls: string[] = []

        for (const block of record.message.content) {
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            textParts.push(block.text)
          } else if (block.type === 'tool_use' && block.name) {
            toolCalls.push(block.name)
          }
        }

        const text = textParts.join('\n\n')
        if (text.trim() || toolCalls.length > 0) {
          turns.push({
            index: idx++,
            ts: record.timestamp ?? '',
            text,
            toolCalls,
            charCount: text.length,
          })
        }
      }
    } catch {}
  }

  // Return last N turns
  return turns.slice(-limit)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ slug, turns: [], checkedAt: new Date().toISOString() } satisfies TurnsDetailResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!slugs.includes(slug)) {
    return Response.json({ slug, turns: [], checkedAt: new Date().toISOString() } satisfies TurnsDetailResponse, { status: 404 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 100)

  const latestFile = findLatestJsonl(slug, mcdDir)
  const turns = latestFile ? parseTurns(latestFile, limit) : []

  return Response.json({ slug, turns, checkedAt: new Date().toISOString() } satisfies TurnsDetailResponse)
}
