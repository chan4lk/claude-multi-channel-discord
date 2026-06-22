import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface TopologyNode {
  id: string
  slug: string
  state: 'active' | 'idle' | 'stuck'
  turnsPerHour: number
  lastReplyAge: number // seconds since last reply, -1 if never
  convergenceScore?: number
}

export interface EdgeBreakdown {
  transcript: number   // 0-1 based on slug reference count
  memory: number       // 0-1 Jaccard of MEMORY.md keywords
  goal: number         // 0-1 Jaccard of GOAL.md keywords
  sharedRemote: boolean
}

export interface TopologyEdge {
  source: string
  target: string
  weight: number
  edgeType: 'shared-remote' | 'inferred' | 'transcript'
  breakdown: EdgeBreakdown
  sharedKeywords: string[]
}

export interface TopologyEvent {
  ts: string
  slug: string
  action: string
}

export interface TopologyResponse {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  events: TopologyEvent[]
  computedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','was','are','were','be','been','have','has','had','do','does',
  'did','will','would','could','should','that','this','it','its','they','we',
  'you','i','me','my','not','no','so','all','any','use','when','which','what',
  'project','claude','file','code','there','here','now','just','also','some',
])

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  return new Set(words.filter((w) => w.length >= 4 && !STOP_WORDS.has(w)))
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (a.size === 0 && b.size === 0) return { score: 0, shared: [] }
  const shared: string[] = []
  for (const w of a) { if (b.has(w)) shared.push(w) }
  const union = new Set([...a, ...b]).size
  return { score: union === 0 ? 0 : shared.length / union, shared: shared.slice(0, 5) }
}

function readFileKeywords(filePath: string): Set<string> {
  try { return extractKeywords(fs.readFileSync(filePath, 'utf-8')) } catch { return new Set() }
}

function getGitRemote(projectDir: string): string | null {
  try {
    const config = fs.readFileSync(path.join(projectDir, '.git', 'config'), 'utf-8')
    const match = config.match(/url\s*=\s*(.+)/)
    return match?.[1]?.trim() ?? null
  } catch { return null }
}

function findLatestJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    const files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    return files[0] ?? null
  } catch { return null }
}

interface JsonlEntry {
  type?: string
  role?: string
  message?: { role?: string; content?: unknown }
  timestamp?: string
  ts?: string
}

function parseRecentTurns(
  jsonlPath: string,
  windowMs: number
): { turns: Array<{ role: string; text: string; ts: number }>; lastReplyTs: number | null } {
  let raw = ''
  try { raw = fs.readFileSync(jsonlPath, 'utf-8') } catch { return { turns: [], lastReplyTs: null } }

  const now = Date.now()
  const turns: Array<{ role: string; text: string; ts: number }> = []
  let lastReplyTs: number | null = null

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: JsonlEntry
    try { entry = JSON.parse(line) } catch { continue }

    const tsStr = entry.timestamp ?? entry.ts
    if (!tsStr) continue
    const ts = new Date(tsStr).getTime()
    if (isNaN(ts)) continue

    const role = entry.role ?? entry.message?.role ?? ''
    let text = ''
    const content = entry.message?.content ?? (entry as Record<string, unknown>).content
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
      text = content
        .map((c: unknown) => (typeof c === 'object' && c !== null && 'text' in c ? (c as { text: string }).text : ''))
        .join(' ')
    }

    if (role === 'assistant' && text) {
      if (lastReplyTs === null || ts > lastReplyTs) lastReplyTs = ts
    }

    if (now - ts <= windowMs) {
      turns.push({ role, text, ts })
    }
  }

  return { turns, lastReplyTs }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  const slugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  // Also check projects dir directly
  const projectsDir = path.join(mcdDir, 'projects')
  try {
    for (const entry of fs.readdirSync(projectsDir)) {
      if (entry === 'master' || entry.startsWith('.')) continue
      if (!slugs.includes(entry)) slugs.push(entry)
    }
  } catch { /* ignore */ }

  const now = Date.now()
  const WINDOW_15M = 15 * 60 * 1000
  const WINDOW_1H = 60 * 60 * 1000

  const nodes: TopologyNode[] = []
  const transcriptEdgeMap = new Map<string, number>() // "src|tgt" -> ref count
  const events: TopologyEvent[] = []

  // Pre-compute memory/goal keywords and git remotes per slug
  const memoryKw = new Map<string, Set<string>>()
  const goalKw = new Map<string, Set<string>>()
  const gitRemote = new Map<string, string | null>()

  for (const slug of slugs) {
    const projectDir = path.join(mcdDir, 'projects', slug)
    memoryKw.set(slug, readFileKeywords(path.join(projectDir, 'MEMORY.md')))
    goalKw.set(slug, readFileKeywords(path.join(projectDir, 'GOAL.md')))
    gitRemote.set(slug, getGitRemote(projectDir))
  }

  for (const slug of slugs) {
    const jsonlPath = findLatestJsonl(slug, mcdDir)
    if (!jsonlPath) {
      nodes.push({ id: slug, slug, state: 'idle', turnsPerHour: 0, lastReplyAge: -1 })
      continue
    }

    const { turns: turns15m, lastReplyTs } = parseRecentTurns(jsonlPath, WINDOW_15M)
    const { turns: turns1h } = parseRecentTurns(jsonlPath, WINDOW_1H)

    const lastReplyAge = lastReplyTs ? Math.floor((now - lastReplyTs) / 1000) : -1
    const turnsPerHour = turns1h.filter((t) => t.role === 'assistant').length
    const state: 'active' | 'idle' | 'stuck' =
      lastReplyAge >= 0 && lastReplyAge < 30 ? 'active' :
      lastReplyAge >= 0 && lastReplyAge < 300 ? 'idle' :
      'stuck'

    nodes.push({ id: slug, slug, state, turnsPerHour, lastReplyAge })

    for (const turn of turns15m) {
      if (turn.role !== 'assistant') continue
      for (const otherSlug of slugs) {
        if (otherSlug === slug) continue
        const count = (turn.text.match(new RegExp(otherSlug, 'gi')) ?? []).length
        if (count > 0) {
          const key = `${slug}|${otherSlug}`
          transcriptEdgeMap.set(key, (transcriptEdgeMap.get(key) ?? 0) + count)
        }
      }
      if (now - turn.ts < 60_000) {
        events.push({ ts: new Date(turn.ts).toISOString(), slug, action: 'reply' })
      }
    }
    for (const turn of turns15m) {
      if (turn.role === 'tool') {
        events.push({ ts: new Date(turn.ts).toISOString(), slug, action: 'tool_call' })
      }
    }
  }

  // Build enhanced edges combining transcript refs + memory/goal overlap + shared remote
  const edgePairs = new Set<string>()
  // Seed from transcript refs
  for (const key of transcriptEdgeMap.keys()) {
    const [a, b] = key.split('|')
    const canonical = [a, b].sort().join('|')
    edgePairs.add(canonical)
  }
  // Add pairs with significant memory or goal overlap
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i], b = slugs[j]
      const memSim = jaccardSimilarity(memoryKw.get(a) ?? new Set(), memoryKw.get(b) ?? new Set())
      const goalSim = jaccardSimilarity(goalKw.get(a) ?? new Set(), goalKw.get(b) ?? new Set())
      const sameRemote = gitRemote.get(a) && gitRemote.get(a) === gitRemote.get(b)
      if (memSim.score >= 0.05 || goalSim.score >= 0.05 || sameRemote) {
        edgePairs.add([a, b].sort().join('|'))
      }
    }
  }

  const edges: TopologyEdge[] = []
  const MAX_TRANSCRIPT_REFS = 10

  for (const pair of edgePairs) {
    const [a, b] = pair.split('|')
    const fwdRefs = transcriptEdgeMap.get(`${a}|${b}`) ?? 0
    const bwdRefs = transcriptEdgeMap.get(`${b}|${a}`) ?? 0
    const totalRefs = fwdRefs + bwdRefs
    const transcriptScore = Math.min(totalRefs / MAX_TRANSCRIPT_REFS, 1)

    const memSim = jaccardSimilarity(memoryKw.get(a) ?? new Set(), memoryKw.get(b) ?? new Set())
    const goalSim = jaccardSimilarity(goalKw.get(a) ?? new Set(), goalKw.get(b) ?? new Set())
    const sameRemote = !!(gitRemote.get(a) && gitRemote.get(a) === gitRemote.get(b))

    const weight = sameRemote ? 1.0 :
      0.5 * transcriptScore + 0.3 * memSim.score + 0.2 * goalSim.score

    if (weight < 0.05 && !sameRemote) continue

    const edgeType: TopologyEdge['edgeType'] = sameRemote ? 'shared-remote' :
      totalRefs > 0 ? 'transcript' : 'inferred'

    const sharedKeywords = [...new Set([...memSim.shared, ...goalSim.shared])].slice(0, 3)

    edges.push({
      source: a,
      target: b,
      weight,
      edgeType,
      breakdown: { transcript: transcriptScore, memory: memSim.score, goal: goalSim.score, sharedRemote: sameRemote },
      sharedKeywords,
    })
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts))

  return Response.json({
    nodes,
    edges,
    events: events.slice(0, 50),
    computedAt: new Date().toISOString(),
  } satisfies TopologyResponse)
}
