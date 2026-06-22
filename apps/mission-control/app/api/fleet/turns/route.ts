import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface TurnProject {
  slug: string
  turnCount: number
  avgToolCalls: number
  lastActiveMins: number
  state: 'idle' | 'active' | 'stalled' | 'autonomous'
}

export interface TurnsResponse {
  projects: TurnProject[]
  window: string
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
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
  } catch { return [] }
}

function parseWindowMs(win: string): number {
  switch (win) {
    case '1h': return 1 * 60 * 60 * 1000
    case '6h': return 6 * 60 * 60 * 1000
    case '7d': return 7 * 24 * 60 * 60 * 1000
    default: return 24 * 60 * 60 * 1000 // 24h
  }
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: {
    content?: Array<{ type: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
}

function computeTurnStats(
  slug: string,
  mcdDir: string,
  windowMs: number
): { turnCount: number; avgToolCalls: number; lastActiveMins: number } {
  const files = findAllJsonl(slug, mcdDir)
  const cutoff = Date.now() - windowMs

  let turnCount = 0
  let totalToolCalls = 0
  let lastActiveMs = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue

      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      if (!ts) continue
      const tsMs = new Date(ts).getTime()
      if (isNaN(tsMs)) continue

      // Track the most recent assistant turn regardless of window (for lastActiveMins)
      if (tsMs > lastActiveMs) lastActiveMs = tsMs

      if (tsMs < cutoff) continue

      turnCount++
      const toolUseCount = (rec.message?.content ?? []).filter((c) => c.type === 'tool_use').length
      totalToolCalls += toolUseCount
    }
  }

  const avgToolCalls = turnCount > 0 ? Math.round((totalToolCalls / turnCount) * 10) / 10 : 0
  const lastActiveMins = lastActiveMs > 0
    ? Math.floor((Date.now() - lastActiveMs) / 60_000)
    : 9999

  return { turnCount, avgToolCalls, lastActiveMins }
}

function classifyState(lastActiveMins: number): TurnProject['state'] {
  if (lastActiveMins < 5) return 'active'
  if (lastActiveMins >= 15 && lastActiveMins < 60) return 'stalled'
  return 'idle'
}

export async function GET(request: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], window: '24h', generatedAt: new Date().toISOString() } satisfies TurnsResponse)
  }

  const url = new URL(request.url)
  const windowParam = url.searchParams.get('window') ?? '24h'
  const validWindows = ['1h', '6h', '24h', '7d']
  const win = validWindows.includes(windowParam) ? windowParam : '24h'
  const windowMs = parseWindowMs(win)

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const projects: TurnProject[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue

      const { turnCount, avgToolCalls, lastActiveMins } = computeTurnStats(slug, mcdDir, windowMs)
      const state = classifyState(lastActiveMins)

      projects.push({ slug, turnCount, avgToolCalls, lastActiveMins, state })
    }
  }

  return Response.json({
    projects,
    window: win,
    generatedAt: new Date().toISOString(),
  } satisfies TurnsResponse)
}
