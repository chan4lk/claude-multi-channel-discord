import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface TurnSegment {
  slug: string
  start: string  // ISO timestamp
  end: string
  durationMs: number
  toolCount: number
  tokenCount: number
}

export interface FleetTimelineResponse {
  segments: TurnSegment[]
  slugs: string[]
  windowHours: number
  windowStart: string
  windowEnd: string
}

const VALID_WINDOWS = [6, 24, 168] // 6h, 24h, 7d

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFilesInWindow(slug: string, mcdDir: string, since: Date): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .filter((fp) => {
        try { return fs.statSync(fp).mtimeMs >= since.getTime() - 3_600_000 } catch { return false }
      })
  } catch { return [] }
}

interface RawEntry {
  type: string
  timestamp?: string
  message?: {
    content?: unknown
    usage?: {
      output_tokens?: number
      input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

function countTools(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return (content as Array<{ type?: string }>).filter((c) => c.type === 'tool_use').length
}

function parseTurns(jsonlPath: string, since: Date, now: Date): Array<Omit<TurnSegment, 'slug'>> {
  let raw = ''
  try { raw = fs.readFileSync(jsonlPath, 'utf-8') } catch { return [] }

  const entries: RawEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as RawEntry
      if ((e.type === 'user' || e.type === 'assistant') && e.timestamp) {
        entries.push(e)
      }
    } catch { /* skip */ }
  }

  // Group into turns: user → [assistant*] until next user
  const turns: Array<Omit<TurnSegment, 'slug'>> = []
  let turnStart: string | null = null
  let lastAssistantTs: string | null = null
  let toolCount = 0
  let tokenCount = 0

  function flush() {
    if (turnStart && lastAssistantTs) {
      const start = new Date(turnStart)
      const end = new Date(lastAssistantTs)
      // Only include if any part overlaps the window
      if (end >= since && start <= now) {
        turns.push({
          start: turnStart,
          end: lastAssistantTs,
          durationMs: Math.max(0, end.getTime() - start.getTime()),
          toolCount,
          tokenCount,
        })
      }
    }
    turnStart = null
    lastAssistantTs = null
    toolCount = 0
    tokenCount = 0
  }

  for (const e of entries) {
    if (e.type === 'user') {
      flush()
      turnStart = e.timestamp!
    } else if (e.type === 'assistant' && turnStart) {
      lastAssistantTs = e.timestamp!
      toolCount += countTools(e.message?.content)
      const u = e.message?.usage ?? {}
      tokenCount += (u.output_tokens ?? 0)
    }
  }
  flush()

  return turns
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const rawHours = Number(url.searchParams.get('hours')) || 24
  const windowHours = VALID_WINDOWS.includes(rawHours) ? rawHours : 24

  const now = new Date()
  const since = new Date(now.getTime() - windowHours * 3_600_000)

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ segments: [], slugs: [], windowHours, windowStart: since.toISOString(), windowEnd: now.toISOString() })
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const st = fs.statSync(path.join(projectsDir, s))
        return st.isDirectory() || st.isSymbolicLink()
      } catch { return false }
    })
  } catch { /* ok */ }

  const allSegments: TurnSegment[] = []
  const activeSlugs = new Set<string>()

  for (const slug of slugs) {
    const files = findJsonlFilesInWindow(slug, mcdDir, since)
    for (const f of files) {
      const turns = parseTurns(f, since, now)
      for (const t of turns) {
        allSegments.push({ slug, ...t })
        activeSlugs.add(slug)
      }
    }
  }

  allSegments.sort((a, b) => a.start.localeCompare(b.start))

  // Sort slugs by last-activity desc
  const lastActivity = new Map<string, string>()
  for (const s of allSegments) {
    const prev = lastActivity.get(s.slug) ?? ''
    if (s.end > prev) lastActivity.set(s.slug, s.end)
  }
  const sortedSlugs = [...activeSlugs].sort((a, b) =>
    (lastActivity.get(b) ?? '').localeCompare(lastActivity.get(a) ?? '')
  )

  return Response.json({
    segments: allSegments,
    slugs: sortedSlugs,
    windowHours,
    windowStart: since.toISOString(),
    windowEnd: now.toISOString(),
  } satisfies FleetTimelineResponse)
}
