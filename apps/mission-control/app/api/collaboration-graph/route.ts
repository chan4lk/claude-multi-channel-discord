import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type ConnectionType = 'memory' | 'goal' | 'proposal'

export interface CollabNode {
  id: string
  slug: string
  state: string
  turnCount: number
}

export interface CollabEdge {
  source: string
  target: string
  score: number
  types: ConnectionType[]
  sharedKeywords: string[]
}

export interface CollabGraphResponse {
  nodes: CollabNode[]
  edges: CollabEdge[]
  computedAt: string
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'not', 'no', 'nor',
  'so', 'yet', 'both', 'either', 'neither', 'as', 'if', 'than', 'then',
  'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'we', 'our', 'you', 'your', 'he', 'she', 'him', 'her', 'his', 'my', 'me',
  'i', 'up', 'out', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'each', 'more', 'most', 'other', 'some',
  'such', 'only', 'own', 'same', 'also', 'all', 'any', 'new', 'use', 'used',
  'when', 'which', 'who', 'how', 'what', 'where', 'why', 'there', 'here',
  'now', 'just', 'very', 'well', 'back', 'because', 'come', 'people',
  'first', 'time', 'way', 'day', 'year', 'project', 'claude', 'file',
])

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !STOP_WORDS.has(w))
  )
}

function readSourceText(slug: string, mcdDir: string, source: ConnectionType): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* ok */ }

  if (source === 'memory') {
    const encoded = encodeProjectCwd(realPath)
    const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')
    let combined = ''
    try {
      const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'))
      for (const f of files) {
        try { combined += ' ' + fs.readFileSync(path.join(memoryDir, f), 'utf-8') } catch { /* skip */ }
      }
    } catch { /* no memory dir */ }
    try { combined += ' ' + fs.readFileSync(path.join(projectPath, 'MEMORY.md'), 'utf-8') } catch { /* skip */ }
    return combined
  }

  if (source === 'goal') {
    try { return fs.readFileSync(path.join(projectPath, 'GOAL.md'), 'utf-8') } catch { return '' }
  }

  if (source === 'proposal') {
    const specclaw = path.join(realPath, '.specclaw', 'changes')
    let combined = ''
    try {
      const changes = fs.readdirSync(specclaw)
      for (const dir of changes) {
        try {
          combined += ' ' + fs.readFileSync(path.join(specclaw, dir, 'proposal.md'), 'utf-8')
        } catch { /* skip */ }
      }
    } catch { /* no specclaw */ }
    return combined
  }

  return ''
}

function countRecentTurns(slug: string, mcdDir: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let count = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const f of files) {
      try {
        const lines = fs.readFileSync(path.join(transcriptDir, f), 'utf-8').split('\n').filter(Boolean)
        count += lines.length
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return Math.min(count, 9999)
}

function sharedKeywords(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = []
  for (const w of a) { if (b.has(w)) shared.push(w) }
  return shared.slice(0, 10)
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const w of a) { if (b.has(w)) inter++ }
  return inter / (a.size + b.size - inter)
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const minScore = parseFloat(url.searchParams.get('minScore') ?? '0.05')
  const types = (url.searchParams.get('types') ?? 'memory,goal,proposal').split(',') as ConnectionType[]

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs = Object.values(channels?.projects ?? {})
    .map((p) => p.slug)
    .filter((s): s is string => !!s)

  // Build keyword sets per source per slug
  const kwSets: Record<string, Record<ConnectionType, Set<string>>> = {}
  for (const slug of slugs) {
    kwSets[slug] = {
      memory: extractKeywords(readSourceText(slug, mcdDir, 'memory')),
      goal: extractKeywords(readSourceText(slug, mcdDir, 'goal')),
      proposal: extractKeywords(readSourceText(slug, mcdDir, 'proposal')),
    }
  }

  const nodes: CollabNode[] = slugs.map((slug) => ({
    id: slug,
    slug,
    state: 'idle',
    turnCount: countRecentTurns(slug, mcdDir),
  }))

  const edges: CollabEdge[] = []
  const seen = new Set<string>()

  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i]
      const b = slugs[j]
      const key = `${a}--${b}`
      if (seen.has(key)) continue
      seen.add(key)

      const connectionTypes: ConnectionType[] = []
      const allShared = new Set<string>()
      let totalScore = 0
      let scoreCount = 0

      for (const type of types as ConnectionType[]) {
        const setA = kwSets[a][type]
        const setB = kwSets[b][type]
        const score = jaccardScore(setA, setB)
        if (score >= minScore) {
          connectionTypes.push(type)
          const shared = sharedKeywords(setA, setB)
          shared.forEach((w) => allShared.add(w))
          totalScore += score
          scoreCount++
        }
      }

      if (connectionTypes.length === 0) continue

      edges.push({
        source: a,
        target: b,
        score: scoreCount > 0 ? totalScore / scoreCount : 0,
        types: connectionTypes,
        sharedKeywords: [...allShared].slice(0, 10),
      })
    }
  }

  return Response.json({
    nodes,
    edges,
    computedAt: new Date().toISOString(),
  } satisfies CollabGraphResponse)
}
