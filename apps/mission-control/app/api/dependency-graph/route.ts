import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findAllJsonl(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .sort()
  } catch { return [] }
}

export interface InjectEdge {
  source: string
  target: string
  count: number
  lastDate: string
  lastMessage: string
}

export interface DependencyNode {
  slug: string
  state: 'idle' | 'active' | 'stalled' | 'autonomous'
  ageMins: number
}

export interface DependencyGraphResponse {
  nodes: DependencyNode[]
  edges: InjectEdge[]
  generatedAt: string
}

function getProjectState(slug: string, mcdDir: string): { state: DependencyNode['state']; ageMins: number } {
  const files = findAllJsonl(slug, mcdDir)
  if (files.length === 0) return { state: 'idle', ageMins: 9999 }

  let lastReplyMs = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: { type?: string; timestamp?: string }
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      const ts = rec.timestamp ? new Date(rec.timestamp).getTime() : NaN
      if (!isNaN(ts) && ts > lastReplyMs) lastReplyMs = ts
    }
  }

  const ageMins = lastReplyMs > 0 ? (Date.now() - lastReplyMs) / 60000 : 9999
  let state: DependencyNode['state'] = 'idle'
  if (ageMins < 5) state = 'active'
  else if (ageMins < 30) state = 'idle'
  else if (ageMins < 120) state = 'stalled'
  else state = 'idle'

  return { state, ageMins }
}

function extractInjectFlows(slug: string, mcdDir: string): Array<{ target: string; tsMs: number; message: string }> {
  const files = findAllJsonl(slug, mcdDir)
  const flows: Array<{ target: string; tsMs: number; message: string }> = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: {
        type?: string
        timestamp?: string
        message?: {
          content?: Array<{
            type?: string
            name?: string
            input?: { slug?: string; target?: string; message?: string; text?: string }
          }>
        }
      }
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      const tsMs = rec.timestamp ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs)) continue

      for (const block of rec.message?.content ?? []) {
        if (block.type !== 'tool_use') continue
        if (!block.name?.includes('inject')) continue
        const target = block.input?.slug ?? block.input?.target
        const message = block.input?.message ?? block.input?.text ?? ''
        if (target) flows.push({ target, tsMs, message: String(message).slice(0, 120) })
      }
    }
  }

  return flows
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ nodes: [], edges: [], generatedAt: new Date().toISOString() } satisfies DependencyGraphResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))
  const slugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const nodes: DependencyNode[] = []
  const edgeMap = new Map<string, { count: number; lastDate: string; lastMessage: string; lastTs: number }>()

  for (const slug of slugs) {
    const { state, ageMins } = getProjectState(slug, mcdDir)
    nodes.push({ slug, state, ageMins })

    const flows = extractInjectFlows(slug, mcdDir)
    for (const { target, tsMs, message } of flows) {
      if (!slugs.includes(target)) continue
      const key = `${slug}→${target}`
      const existing = edgeMap.get(key)
      if (!existing || tsMs > existing.lastTs) {
        edgeMap.set(key, {
          count: (existing?.count ?? 0) + 1,
          lastDate: new Date(tsMs).toISOString(),
          lastMessage: message,
          lastTs: tsMs,
        })
      } else {
        edgeMap.set(key, { ...existing, count: existing.count + 1 })
      }
    }
  }

  const edges: InjectEdge[] = []
  for (const [key, val] of edgeMap) {
    const [source, target] = key.split('→')
    edges.push({ source, target, count: val.count, lastDate: val.lastDate, lastMessage: val.lastMessage })
  }
  edges.sort((a, b) => b.count - a.count)

  return Response.json({ nodes, edges, generatedAt: new Date().toISOString() } satisfies DependencyGraphResponse)
}
