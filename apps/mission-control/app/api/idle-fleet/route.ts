import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface IdleProject {
  slug: string
  lastTurnAt: string | null   // ISO timestamp or null
  daysSince: number | null    // null = never had a turn
  turnCount: number
  memoryFileCount: number
  idleBadge: 'active' | 'idle' | 'dormant' | 'never'
}

export interface IdleFleetResponse {
  projects: IdleProject[]
  generatedAt: string
}

let cache: { data: IdleFleetResponse; ts: number } | null = null
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 min

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function countMemoryFiles(slug: string, mcdDir: string): number {
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  try {
    return fs.readdirSync(memDir).filter((f) => f.endsWith('.md')).length
  } catch {
    // check for MEMORY.md as single-file fallback
    return fs.existsSync(path.join(mcdDir, 'projects', slug, 'MEMORY.md')) ? 1 : 0
  }
}

function scanLastTurn(slug: string, mcdDir: string): { lastTurnAt: string | null; turnCount: number } {
  const files = findJsonlFiles(slug, mcdDir)
  let lastTs: string | null = null
  let count = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: { role?: string; timestamp?: string } | null = null
      try { parsed = JSON.parse(line) } catch { continue }
      if (!parsed || parsed.role !== 'assistant' || !parsed.timestamp) continue
      count++
      if (!lastTs || parsed.timestamp > lastTs) lastTs = parsed.timestamp
    }
  }
  return { lastTurnAt: lastTs, turnCount: count }
}

function idleBadge(daysSince: number | null): IdleProject['idleBadge'] {
  if (daysSince === null) return 'never'
  if (daysSince < 7) return 'active'
  if (daysSince < 30) return 'idle'
  return 'dormant'
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const projects: IdleProject[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug || slug === 'master') continue
      const { lastTurnAt, turnCount } = scanLastTurn(slug, mcdDir)
      const daysSince = lastTurnAt
        ? Math.floor((Date.now() - new Date(lastTurnAt).getTime()) / (24 * 3_600_000))
        : null
      const memoryFileCount = countMemoryFiles(slug, mcdDir)
      projects.push({ slug, lastTurnAt, daysSince, turnCount, memoryFileCount, idleBadge: idleBadge(daysSince) })
    }
  }

  // Sort: never-used and dormant first, then by daysSince desc
  projects.sort((a, b) => {
    const da = a.daysSince ?? 9999
    const db = b.daysSince ?? 9999
    return db - da
  })

  const data: IdleFleetResponse = { projects, generatedAt: new Date().toISOString() }
  cache = { data, ts: Date.now() }
  return Response.json(data)
}
