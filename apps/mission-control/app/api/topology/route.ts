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

export interface TopologyEdge {
  source: string
  target: string
  weight: number // message references in last 15 min
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
  const edgeMap = new Map<string, number>() // "src|tgt" -> count
  const events: TopologyEvent[] = []

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

    // Detect cross-project references
    const allSlugs = slugs
    for (const turn of turns15m) {
      if (turn.role !== 'assistant') continue
      for (const otherSlug of allSlugs) {
        if (otherSlug === slug) continue
        const count = (turn.text.match(new RegExp(otherSlug, 'gi')) ?? []).length
        if (count > 0) {
          const key = `${slug}|${otherSlug}`
          edgeMap.set(key, (edgeMap.get(key) ?? 0) + count)
        }
      }
      // Emit event
      if (now - turn.ts < 60_000) {
        events.push({ ts: new Date(turn.ts).toISOString(), slug, action: 'reply' })
      }
    }

    // Tool calls as events
    for (const turn of turns15m) {
      if (turn.role === 'tool') {
        events.push({ ts: new Date(turn.ts).toISOString(), slug, action: 'tool_call' })
      }
    }
  }

  const edges: TopologyEdge[] = []
  for (const [key, weight] of edgeMap.entries()) {
    const [source, target] = key.split('|')
    edges.push({ source, target, weight })
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts))

  return Response.json({
    nodes,
    edges,
    events: events.slice(0, 50),
    computedAt: new Date().toISOString(),
  } satisfies TopologyResponse)
}
