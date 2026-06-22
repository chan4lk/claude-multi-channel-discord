import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface NarrativeProject {
  slug: string
  memoryHeadline: string
  goalSnippet: string
  ageMins: number
  state: string
}

export interface FleetNarrativeResponse {
  projects: NarrativeProject[]
  backlogCounts: { pending: number; done: number; total: number }
  computedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getMemoryHeadline(slug: string, mcdDir: string): string {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')

  // Try memory files for a heading
  try {
    const files = fs.readdirSync(memoryDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(memoryDir, file), 'utf-8')
        const heading = text.match(/^#+\s+(.+)$/m)
        if (heading) return heading[1].trim().slice(0, 60)
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }

  // Fallback: project MEMORY.md heading
  try {
    const text = fs.readFileSync(path.join(mcdDir, 'projects', slug, 'MEMORY.md'), 'utf-8')
    const heading = text.match(/^#+\s+(.+)$/m)
    if (heading) return heading[1].trim().slice(0, 60)
  } catch { /* skip */ }

  return ''
}

function getLastTurnAge(slug: string, mcdDir: string): { ageMins: number; state: string } {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { /* no symlink */ }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let latestMtime = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of files) {
      try {
        const st = fs.statSync(path.join(transcriptDir, file))
        if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const ageMins = latestMtime > 0 ? (Date.now() - latestMtime) / 60000 : 99999
  const state = ageMins < 2 ? 'active' : ageMins < 30 ? 'idle' : 'idle'
  return { ageMins: Math.round(ageMins), state }
}

function parseBacklogCounts(mcdDir: string): { pending: number; done: number; total: number } {
  // Find BACKLOG.md in the mcd project directory
  const candidates = [
    path.join(mcdDir, '..', 'claude-mcd', 'BACKLOG.md'),
    path.join(mcdDir, '..', '..', 'BACKLOG.md'),
  ]
  for (const candidate of candidates) {
    try {
      const text = fs.readFileSync(candidate, 'utf-8')
      const pendingMatches = (text.match(/\*\*Status:\*\* `\[ \] pending`/g) ?? []).length
      const doneMatches = (text.match(/\*\*Status:\*\* `\[x\] done`/g) ?? []).length
      return { pending: pendingMatches, done: doneMatches, total: pendingMatches + doneMatches }
    } catch { /* try next */ }
  }
  return { pending: 0, done: 0, total: 0 }
}

// 2-min cache
let cache: { result: FleetNarrativeResponse; ts: number } | null = null
const CACHE_TTL_MS = 2 * 60 * 1000

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.result)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  const channels = readJson<{
    projects?: Record<string, { slug?: string; claude?: { extraArgs?: string[] } }>
  }>(path.join(mcdDir, 'channels.json'))

  const entries = Object.values(channels?.projects ?? {})
    .filter((p): p is { slug: string; claude?: { extraArgs?: string[] } } => typeof p.slug === 'string')

  const projects: NarrativeProject[] = entries.map((entry) => {
    const slug = entry.slug
    const headline = getMemoryHeadline(slug, mcdDir)
    const { ageMins, state } = getLastTurnAge(slug, mcdDir)

    // Goal snippet from extraArgs --goal flag (if present)
    const goalArg = entry.claude?.extraArgs?.find((a) => a.startsWith('--goal='))
    const goalSnippet = goalArg ? goalArg.replace('--goal=', '').slice(0, 60) : ''

    return { slug, memoryHeadline: headline, goalSnippet, ageMins, state }
  })

  const backlogCounts = parseBacklogCounts(mcdDir)
  const result: FleetNarrativeResponse = { projects, backlogCounts, computedAt: new Date().toISOString() }
  cache = { result, ts: Date.now() }
  return Response.json(result)
}
