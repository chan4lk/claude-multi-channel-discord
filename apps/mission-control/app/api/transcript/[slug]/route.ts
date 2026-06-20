import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface TranscriptEntry {
  kind: 'text' | 'tool_call' | 'tool_result'
  content: string
  toolName?: string
  role?: string
}

export interface TranscriptResponse {
  slug: string
  entries: TranscriptEntry[]
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

function parseEntries(transcriptFile: string, limit: number): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  let content = ''
  try {
    content = fs.readFileSync(transcriptFile, 'utf-8')
  } catch {
    return entries
  }

  const lines = content.trim().split('\n').filter(Boolean).reverse()

  for (const line of lines) {
    if (entries.length >= limit) break
    try {
      const record = JSON.parse(line)
      if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
        for (const block of record.message.content) {
          if (entries.length >= limit) break
          if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            entries.push({ kind: 'text', content: block.text.slice(0, 400), role: 'assistant' })
          } else if (block.type === 'tool_use') {
            const inputStr = typeof block.input === 'object'
              ? JSON.stringify(block.input).slice(0, 120)
              : String(block.input ?? '').slice(0, 120)
            entries.push({ kind: 'tool_call', content: inputStr, toolName: block.name })
          }
        }
      } else if (record.type === 'tool' && record.content) {
        const c = Array.isArray(record.content) ? record.content : []
        for (const block of c) {
          if (entries.length >= limit) break
          if (block.type === 'tool_result') {
            const resultStr = (typeof block.content === 'string' ? block.content : JSON.stringify(block.content)).slice(0, 200)
            entries.push({ kind: 'tool_result', content: resultStr, toolName: block.tool_use_id })
          }
        }
      }
    } catch {}
  }

  return entries.reverse()
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ slug, entries: [], checkedAt: new Date().toISOString() } satisfies TranscriptResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)
  if (!slugs.includes(slug)) {
    return Response.json({ slug, entries: [], checkedAt: new Date().toISOString() } satisfies TranscriptResponse, { status: 404 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 50)

  const latestFile = findLatestJsonl(slug, mcdDir)
  const entries = latestFile ? parseEntries(latestFile, limit) : []

  return Response.json({ slug, entries, checkedAt: new Date().toISOString() } satisfies TranscriptResponse)
}
