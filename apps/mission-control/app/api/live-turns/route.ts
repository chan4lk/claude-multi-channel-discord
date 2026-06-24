import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface LiveTurnProject {
  slug: string
  state: 'active' | 'idle'
  lastOutputAt: string | null
  lastToolName: string | null
  toolCountThisTurn: number
  currentTurnStart: string | null
}

export interface LiveTurnsResponse {
  projects: LiveTurnProject[]
  computedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findMostRecentJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return null }

  if (files.length === 0) return null

  let latestFile = ''
  let latestMtime = 0
  for (const file of files) {
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime > latestMtime) { latestMtime = mtime; latestFile = file }
    } catch {}
  }
  return latestFile || null
}

interface ContentBlock {
  type?: string
  name?: string
}

interface JournalRecord {
  type?: string
  timestamp?: string
  message?: {
    content?: ContentBlock[]
  }
}

function readTailLines(filePath: string, tailBytes = 4096): JournalRecord[] {
  let fd = -1
  try {
    fd = fs.openSync(filePath, 'r')
    const stat = fs.fstatSync(fd)
    const offset = Math.max(0, stat.size - tailBytes)
    const readLen = stat.size - offset
    if (readLen <= 0) return []
    const buf = Buffer.alloc(readLen)
    fs.readSync(fd, buf, 0, readLen, offset)
    const raw = buf.toString('utf-8')
    const lines = raw.split('\n')
    // First line may be partial — skip it if we didn't start at offset 0
    const startIdx = offset > 0 ? 1 : 0
    const records: JournalRecord[] = []
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      try { records.push(JSON.parse(line) as JournalRecord) } catch {}
    }
    return records
  } catch {
    return []
  } finally {
    if (fd >= 0) try { fs.closeSync(fd) } catch {}
  }
}

const ACTIVE_WINDOW_MS = 60_000

function computeLiveTurn(slug: string, mcdDir: string): LiveTurnProject {
  const jsonl = findMostRecentJsonl(slug, mcdDir)
  const base: LiveTurnProject = {
    slug,
    state: 'idle',
    lastOutputAt: null,
    lastToolName: null,
    toolCountThisTurn: 0,
    currentTurnStart: null,
  }
  if (!jsonl) return base

  const records = readTailLines(jsonl)
  if (records.length === 0) return base

  // Find index of last user record (turn boundary)
  let lastUserIdx = -1
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].type === 'user') { lastUserIdx = i; break }
  }

  const currentTurnStart = lastUserIdx >= 0 ? (records[lastUserIdx].timestamp ?? null) : null

  // Count tool_use and find last tool name in assistant records after the last user record
  let toolCountThisTurn = 0
  let lastToolName: string | null = null
  let lastOutputAt: string | null = null

  const assistantStart = lastUserIdx >= 0 ? lastUserIdx + 1 : 0
  for (let i = assistantStart; i < records.length; i++) {
    const rec = records[i]
    if (rec.type !== 'assistant') continue
    if (rec.timestamp) lastOutputAt = rec.timestamp
    const content = rec.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          toolCountThisTurn++
          if (block.name) lastToolName = block.name
        }
      }
    }
  }

  // Determine active: any assistant record within last 60s
  const now = Date.now()
  let isActive = false
  for (let i = records.length - 1; i >= 0; i--) {
    const rec = records[i]
    if (rec.type !== 'assistant' || !rec.timestamp) continue
    const ts = new Date(rec.timestamp).getTime()
    if (!isNaN(ts) && now - ts < ACTIVE_WINDOW_MS) { isActive = true; break }
    // timestamps are ordered; once we go beyond the window we can stop
    if (!isNaN(ts) && now - ts >= ACTIVE_WINDOW_MS) break
  }

  return {
    slug,
    state: isActive ? 'active' : 'idle',
    lastOutputAt,
    lastToolName,
    toolCountThisTurn,
    currentTurnStart,
  }
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], computedAt: new Date().toISOString() } satisfies LiveTurnsResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const slugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const projects: LiveTurnProject[] = slugs.map((slug) => computeLiveTurn(slug, mcdDir))

  // Sort by lastOutputAt desc (nulls last)
  projects.sort((a, b) => {
    if (!a.lastOutputAt && !b.lastOutputAt) return 0
    if (!a.lastOutputAt) return 1
    if (!b.lastOutputAt) return -1
    return new Date(b.lastOutputAt).getTime() - new Date(a.lastOutputAt).getTime()
  })

  return Response.json({ projects, computedAt: new Date().toISOString() } satisfies LiveTurnsResponse)
}
