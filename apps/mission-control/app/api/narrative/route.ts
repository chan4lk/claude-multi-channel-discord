import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface NarrativeTurn {
  id: string
  slug: string
  role: 'user' | 'assistant'
  text: string
  ts: string
  sessionFile: string
  turnIndex: number
}

export interface NarrativeResponse {
  turns: NarrativeTurn[]
  total: number
  nextCursor: string | null
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): Array<{ file: string; mtime: number }> {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(transcriptDir, f)
        return { file: full, mtime: fs.statSync(full).mtimeMs }
      })
  } catch { return [] }
}

interface JsonlLine {
  type?: string
  role?: string
  content?: unknown
  timestamp?: string
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text ?? '')
      .join(' ')
  }
  return ''
}

function parseJsonlTurns(slug: string, mcdDir: string): NarrativeTurn[] {
  const files = findJsonlFiles(slug, mcdDir)
  const turns: NarrativeTurn[] = []

  for (const { file } of files) {
    const sessionFile = path.basename(file)
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.split('\n').filter((l) => l.trim())
    let turnIndex = 0

    for (const line of lines) {
      let parsed: JsonlLine | null = null
      try { parsed = JSON.parse(line) as JsonlLine } catch { continue }
      if (!parsed) continue

      const role = parsed.role
      if (role !== 'user' && role !== 'assistant') continue

      const text = extractText(parsed.content).trim()
      if (!text) continue

      const ts = parsed.timestamp ?? new Date(0).toISOString()
      const id = `${slug}:${sessionFile}:${turnIndex}`

      turns.push({
        id,
        slug,
        role: role as 'user' | 'assistant',
        text: text.slice(0, 500),
        ts,
        sessionFile,
        turnIndex: turnIndex++,
      })
    }
  }

  return turns
}

export async function GET(req: NextRequest): Promise<Response> {
  const params = req.nextUrl.searchParams
  const slugFilter = params.get('slugs')?.split(',').filter(Boolean) ?? []
  const roleFilter = params.get('role') ?? ''
  const keyword = (params.get('q') ?? '').toLowerCase()
  const since = params.get('since') ?? ''
  const until = params.get('until') ?? ''
  const cursorStr = params.get('cursor') ?? ''
  const pageSize = 100

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  let slugs: string[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  if (slugFilter.length > 0) {
    slugs = slugs.filter((s) => slugFilter.includes(s))
  }

  let all: NarrativeTurn[] = []
  for (const slug of slugs) {
    all.push(...parseJsonlTurns(slug, mcdDir))
  }

  // Sort by ts ascending
  all.sort((a, b) => a.ts.localeCompare(b.ts))

  // Filters
  if (roleFilter === 'user' || roleFilter === 'assistant') {
    all = all.filter((t) => t.role === roleFilter)
  }
  if (keyword) {
    all = all.filter((t) => t.text.toLowerCase().includes(keyword))
  }
  if (since) {
    all = all.filter((t) => t.ts >= since)
  }
  if (until) {
    all = all.filter((t) => t.ts <= until)
  }

  const total = all.length
  const cursor = cursorStr ? parseInt(cursorStr, 10) : 0
  const page = all.slice(cursor, cursor + pageSize)
  const nextCursor = cursor + pageSize < total ? String(cursor + pageSize) : null

  return Response.json({ turns: page, total, nextCursor } satisfies NarrativeResponse)
}
