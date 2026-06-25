import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface KGNode {
  id: string
  type: 'project' | 'keyword'
  label: string
  projectCount?: number
  state?: string
}

export interface KGEdge {
  source: string
  target: string
  weight: number
}

export interface KnowledgeGraphResponse {
  nodes: KGNode[]
  edges: KGEdge[]
  generatedAt: string
}

const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'been', 'will', 'your', 'they',
  'were', 'when', 'what', 'which', 'also', 'into', 'than', 'more', 'some',
  'make', 'most', 'time', 'only', 'very', 'just', 'like', 'each', 'both',
  'over', 'such', 'then', 'them', 'does', 'about', 'other', 'after',
  'these', 'those', 'their', 'there', 'where', 'being', 'should', 'could',
  'would', 'user', 'file', 'code', 'note', 'task', 'item', 'type', 'name',
  'true', 'false', 'null', 'undefined', 'string', 'number', 'object',
  'return', 'function', 'class', 'import', 'export', 'const', 'save',
  'apply', 'when', 'used', 'uses', 'write', 'written', 'using', 'below',
  'above', 'never', 'always', 'every', 'show', 'here', 'current', 'status',
])

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function getProjectState(slug: string, mcdDir: string): string {
  const circuitPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  try {
    const raw = fs.readFileSync(circuitPath, 'utf-8')
    const lines = raw.trim().split('\n').filter(Boolean)
    if (lines.length > 0) {
      const last = JSON.parse(lines[lines.length - 1]) as { event?: string }
      if (last.event === 'open') return 'stalled'
    }
  } catch {}
  const sessionIdPath = path.join(mcdDir, 'projects', slug, '.session-id')
  try {
    fs.readFileSync(sessionIdPath, 'utf-8')
    return 'active'
  } catch {
    return 'idle'
  }
}

function extractKeywordFreq(slug: string, mcdDir: string): Map<string, number> {
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  const freq = new Map<string, number>()
  let files: string[] = []
  try { files = fs.readdirSync(memDir).filter(f => f.endsWith('.md')) } catch { return freq }
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(path.join(memDir, file), 'utf-8') } catch { continue }
    const words = raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w))
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1)
    }
  }
  return freq
}

function top50(freq: Map<string, number>): Map<string, number> {
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)
  return new Map(sorted)
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  // Per-project top-50 keyword frequencies
  const projectKeywords = new Map<string, Map<string, number>>()
  for (const slug of slugs) {
    const freq = extractKeywordFreq(slug, mcdDir)
    if (freq.size > 0) {
      projectKeywords.set(slug, top50(freq))
    }
  }

  // Count how many projects each keyword appears in
  const keywordProjectCount = new Map<string, number>()
  for (const [, kw] of projectKeywords) {
    for (const [word] of kw) {
      keywordProjectCount.set(word, (keywordProjectCount.get(word) ?? 0) + 1)
    }
  }

  // Only keep keywords that appear in >= 1 project (for edges)
  // But flag shared ones (>= 2)
  const nodes: KGNode[] = []
  const edges: KGEdge[] = []

  // Project nodes
  for (const slug of projectKeywords.keys()) {
    nodes.push({
      id: `proj:${slug}`,
      type: 'project',
      label: slug,
      state: getProjectState(slug, mcdDir),
    })
  }

  // Keyword nodes (shared keywords only — appearing in >= 2 projects)
  const keywordNodeIds = new Set<string>()
  for (const [word, count] of keywordProjectCount) {
    if (count >= 2) {
      const nodeId = `kw:${word}`
      if (!keywordNodeIds.has(nodeId)) {
        keywordNodeIds.add(nodeId)
        nodes.push({
          id: nodeId,
          type: 'keyword',
          label: word,
          projectCount: count,
        })
      }
    }
  }

  // Edges: project → shared keyword
  for (const [slug, kw] of projectKeywords) {
    for (const [word, weight] of kw) {
      const nodeId = `kw:${word}`
      if (keywordNodeIds.has(nodeId)) {
        edges.push({
          source: `proj:${slug}`,
          target: nodeId,
          weight,
        })
      }
    }
  }

  return Response.json({
    nodes,
    edges,
    generatedAt: new Date().toISOString(),
  } satisfies KnowledgeGraphResponse)
}
