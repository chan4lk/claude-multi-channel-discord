import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'

export interface GraphNode {
  id: string
  slug: string
  state: ProjectState
  turnCount24h: number
  color: string
}

export interface GraphLink {
  source: string
  target: string
  sharedKeywords: number
}

export interface Graph3DResponse {
  nodes: GraphNode[]
  links: GraphLink[]
  generatedAt: string
}

const STATE_COLORS: Record<ProjectState, string> = {
  idle: '#00F5FF',
  active: '#4ADE80',
  stalled: '#EF4444',
  autonomous: '#A855F7',
}

const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'will', 'your', 'they',
  'were', 'when', 'what', 'which', 'also', 'into', 'than', 'more', 'some',
  'make', 'most', 'time', 'only', 'very', 'just', 'like', 'each', 'both',
  'over', 'such', 'then', 'them', 'does', 'about', 'other', 'after',
  'these', 'those', 'their', 'there', 'where', 'being', 'should', 'could',
  'would', 'user', 'file', 'code', 'note', 'task', 'item', 'type', 'name',
])

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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

function getProjectState(slug: string, mcdDir: string): ProjectState {
  const sessionIdPath = path.join(mcdDir, 'projects', slug, '.session-id')
  const circuitPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')

  // Check circuit open
  try {
    const raw = fs.readFileSync(circuitPath, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]) as { event?: string }
      if (last.event === 'open') return 'stalled'
    }
  } catch {}

  // Check session activity
  try {
    fs.readFileSync(sessionIdPath, 'utf-8')
  } catch {
    return 'idle'
  }

  const files = findJsonlFiles(slug, mcdDir)
  if (files.length === 0) return 'idle'

  let latestMtime = 0
  for (const f of files) {
    try { const m = fs.statSync(f).mtimeMs; if (m > latestMtime) latestMtime = m } catch {}
  }
  const agoMs = Date.now() - latestMtime
  if (agoMs < 5 * 60_000) return 'active'
  if (agoMs < 60 * 60_000) return 'autonomous'
  return 'idle'
}

function getTurnCount24h(slug: string, mcdDir: string): number {
  const files = findJsonlFiles(slug, mcdDir)
  const cutoff = new Date(Date.now() - 86_400_000).toISOString()
  let count = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as {
          type?: string
          timestamp?: string
          message?: { role?: string; content?: Array<{ type?: string }> }
        }
        if (rec.type !== 'user') continue
        if (rec.timestamp && rec.timestamp < cutoff) continue
        const content = rec.message?.content ?? []
        if (content.length > 0 && content[0].type === 'tool_result') continue
        count++
      } catch {}
    }
  }
  return count
}

function getMemoryKeywords(slug: string, mcdDir: string): Set<string> {
  const memoryDir = path.join(mcdDir, 'projects', slug, 'memory')
  const keywords = new Set<string>()
  let files: string[] = []
  try { files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md')) } catch { return keywords }

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(path.join(memoryDir, file), 'utf-8') } catch { continue }
    const words = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    for (const w of words) keywords.add(w)
  }
  return keywords
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const k of a) { if (b.has(k)) count++ }
  return count
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  // Build nodes
  const nodes: GraphNode[] = slugs.map((slug) => {
    const state = getProjectState(slug, mcdDir)
    return {
      id: slug,
      slug,
      state,
      turnCount24h: getTurnCount24h(slug, mcdDir),
      color: STATE_COLORS[state],
    }
  })

  // Build edges via memory keyword overlap
  const keywordMap = new Map<string, Set<string>>()
  for (const slug of slugs) {
    keywordMap.set(slug, getMemoryKeywords(slug, mcdDir))
  }

  const links: GraphLink[] = []
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = keywordMap.get(slugs[i])!
      const b = keywordMap.get(slugs[j])!
      const overlap = countOverlap(a, b)
      if (overlap > 2) {
        links.push({ source: slugs[i], target: slugs[j], sharedKeywords: overlap })
      }
    }
  }

  return Response.json({ nodes, links, generatedAt: new Date().toISOString() } satisfies Graph3DResponse)
}
