import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'

export const dynamic = 'force-dynamic'

export interface SearchResult {
  source: 'memory' | 'transcript'
  slug: string
  snippet: string
  highlight: string
  timestamp?: string
  memoryId?: string
  memoryType?: string
}

export interface SearchResponse {
  results: SearchResult[]
  query: string
  counts: { memory: number; transcript: number }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractSnippet(text: string, term: string, radius = 80): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return text.slice(0, 160)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + term.length + radius)
  const snippet = text.slice(start, end)
  return (start > 0 ? '…' : '') + snippet + (end < text.length ? '…' : '')
}

function searchMemories(q: string, mcdDir: string): SearchResult[] {
  const dbPath = path.join(mcdDir, 'memory.db')
  if (!fs.existsSync(dbPath)) return []

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db.prepare(
      `SELECT id, channel_slug, type, content, last_accessed_at
       FROM memories
       WHERE content LIKE '%' || ? || '%'
       ORDER BY last_accessed_at DESC
       LIMIT 50`
    ).all(q) as Array<{
      id: string
      channel_slug: string
      type: string
      content: string
      last_accessed_at: string
    }>

    return rows.map((row) => ({
      source: 'memory' as const,
      slug: row.channel_slug,
      snippet: extractSnippet(row.content, q),
      highlight: q,
      timestamp: row.last_accessed_at,
      memoryId: row.id,
      memoryType: row.type,
    }))
  } catch {
    return []
  } finally {
    db?.close()
  }
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

function searchTranscript(slug: string, q: string, mcdDir: string): SearchResult[] {
  const latestFile = findLatestJsonl(slug, mcdDir)
  if (!latestFile) return []

  let content = ''
  try {
    content = fs.readFileSync(latestFile, 'utf-8')
  } catch {
    return []
  }

  const lines = content.trim().split('\n').filter(Boolean)
  // Read last 500 lines
  const recentLines = lines.slice(-500)

  const results: SearchResult[] = []
  const qLower = q.toLowerCase()

  for (const line of recentLines) {
    if (results.length >= 5) break
    try {
      const record = JSON.parse(line)
      if (record.type !== 'assistant' || !Array.isArray(record.message?.content)) continue

      for (const block of record.message.content) {
        if (block.type !== 'text' || typeof block.text !== 'string') continue
        if (!block.text.toLowerCase().includes(qLower)) continue

        const timestamp = record.timestamp ?? record.created_at ?? undefined
        results.push({
          source: 'transcript',
          slug,
          snippet: extractSnippet(block.text, q),
          highlight: q,
          timestamp,
        })
        if (results.length >= 5) break
      }
    } catch {}
  }

  return results
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()

  if (q.length < 2) {
    return Response.json({
      results: [],
      query: q,
      counts: { memory: 0, transcript: 0 },
    } satisfies SearchResponse)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR
    ?? path.join(process.env.HOME ?? os.homedir(), '.claude', 'channels', 'discord-multi')

  // Memory search
  const memoryResults = searchMemories(q, mcdDir)

  // Transcript search — read channels.json for slugs
  const transcriptResults: SearchResult[] = []
  try {
    const channelsRaw = fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')
    const channels = JSON.parse(channelsRaw) as { projects?: Record<string, { slug?: string }> }
    const slugs = Object.values(channels.projects ?? {})
      .map((p) => p.slug)
      .filter((s): s is string => Boolean(s))

    for (const slug of slugs) {
      if (transcriptResults.length >= 50) break
      const hits = searchTranscript(slug, q, mcdDir)
      transcriptResults.push(...hits)
    }
  } catch {}

  const results = [...memoryResults, ...transcriptResults]

  return Response.json({
    results,
    query: q,
    counts: {
      memory: memoryResults.length,
      transcript: transcriptResults.length,
    },
  } satisfies SearchResponse)
}
