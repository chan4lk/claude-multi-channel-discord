import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

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
  totalHits: number
  truncated: boolean
}

function extractSnippet(text: string, term: string, radius = 100): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return text.slice(0, 200)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + term.length + radius)
  const snippet = text.slice(start, end)
  return (start > 0 ? '…' : '') + snippet + (end < text.length ? '…' : '')
}

function inferMemoryType(fileName: string): string {
  const lower = path.basename(fileName).toLowerCase()
  if (lower.startsWith('user')) return 'user'
  if (lower.startsWith('feedback')) return 'feedback'
  if (lower.startsWith('project')) return 'project'
  if (lower.startsWith('reference')) return 'reference'
  return 'unknown'
}

function searchMemoryFiles(q: string, mcdDir: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []
  const qLower = q.toLowerCase()

  let slugs: string[] = []
  try {
    const projectsDir = path.join(mcdDir, 'projects')
    slugs = fs.readdirSync(projectsDir)
      .filter(d => !d.startsWith('.') && fs.statSync(path.join(projectsDir, d)).isDirectory())
  } catch { return results }

  for (const slug of slugs) {
    if (results.length >= limit) break
    const memDir = path.join(mcdDir, 'projects', slug, 'memory')
    let files: string[] = []
    try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md')) } catch { continue }

    for (const file of files) {
      if (results.length >= limit) break
      let content = ''
      try { content = fs.readFileSync(path.join(memDir, file), 'utf-8') } catch { continue }
      if (!content.toLowerCase().includes(qLower)) continue

      results.push({
        source: 'memory',
        slug,
        snippet: extractSnippet(content, q),
        highlight: q,
        memoryId: file,
        memoryType: inferMemoryType(file),
      })
    }
  }

  return results
}

function findAllJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

function searchTranscripts(q: string, mcdDir: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []
  const qLower = q.toLowerCase()

  let channels: { projects?: Record<string, { slug?: string }> } | null = null
  try {
    channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8'))
  } catch { return results }

  const slugs = Object.values(channels?.projects ?? {})
    .map(p => p.slug)
    .filter((s): s is string => Boolean(s))

  for (const slug of slugs) {
    if (results.length >= limit) break
    const files = findAllJsonlFiles(slug, mcdDir)

    for (const file of files) {
      if (results.length >= limit) break
      let lines: string[]
      try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }

      for (const raw of lines) {
        if (results.length >= limit) break
        let rec: { type?: string; timestamp?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } }
        try { rec = JSON.parse(raw) } catch { continue }

        const role = rec.message?.role
        const content = rec.message?.content ?? []
        if (!role || content.length === 0) continue

        // Search both user messages and assistant text blocks
        for (const block of content) {
          if (block.type !== 'text' || typeof block.text !== 'string') continue
          if (!block.text.toLowerCase().includes(qLower)) continue
          if (results.length >= limit) break

          results.push({
            source: 'transcript',
            slug,
            snippet: extractSnippet(block.text, q),
            highlight: q,
            timestamp: rec.timestamp,
          })
          break
        }
      }
    }
  }

  return results
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const scope = url.searchParams.get('scope') ?? 'all'
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') ?? '50', 10)))

  if (q.length < 2) {
    return Response.json({
      results: [],
      query: q,
      counts: { memory: 0, transcript: 0 },
      totalHits: 0,
      truncated: false,
    } satisfies SearchResponse)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR
    ?? path.join(process.env.HOME ?? os.homedir(), '.claude', 'channels', 'discord-multi')

  const memoryResults: SearchResult[] = scope !== 'messages'
    ? searchMemoryFiles(q, mcdDir, limit)
    : []

  const transcriptResults: SearchResult[] = scope !== 'memory'
    ? searchTranscripts(q, mcdDir, limit - memoryResults.length)
    : []

  const allResults = [...memoryResults, ...transcriptResults]
  const totalHits = allResults.length
  const truncated = totalHits >= limit

  return Response.json({
    results: allResults.slice(0, limit),
    query: q,
    counts: {
      memory: memoryResults.length,
      transcript: transcriptResults.length,
    },
    totalHits,
    truncated,
  } satisfies SearchResponse)
}
