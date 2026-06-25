import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface ProjectDigest {
  slug: string
  messageCount: number
  toolCallCount: number
  memoryWrites: number
  hadWatchdogKill: boolean
  hadCircuitTrip: boolean
  healthDelta: number | null
}

export interface ActivityDigestResponse {
  hours: number
  projects: ProjectDigest[]
  totalMessages: number
  totalToolCalls: number
  totalMemoryWrites: number
  watchdogKills: number
  circuitTrips: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

interface RawCircuitEvent {
  ts: string
  event: 'open' | 'close'
  slug: string
}

interface WatchdogEvent {
  ts: string
  event: 'kill'
  slug: string
}

function parseJsonlActivity(slug: string, mcdDir: string, cutoffMs: number): {
  messageCount: number
  toolCallCount: number
  earlyTokens: number
  lateTokens: number
} {
  const files = findJsonlFiles(slug, mcdDir)
  let messageCount = 0, toolCallCount = 0
  let earlyTokens = 0, lateTokens = 0
  const midMs = cutoffMs + (Date.now() - cutoffMs) / 2

  for (const file of files) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let rec: {
        timestamp?: string
        message?: {
          role?: string
          content?: Array<{ type?: string }>
          usage?: { input_tokens?: number; output_tokens?: number }
        }
      }
      try { rec = JSON.parse(raw) } catch { continue }

      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN
      if (isNaN(ts) || ts < cutoffMs) continue

      const role = rec.message?.role
      const content = rec.message?.content ?? []

      if (role === 'user' && content.length > 0 && content[0]?.type !== 'tool_result') {
        messageCount++
      }
      if (role === 'assistant') {
        if (content.some(c => c.type === 'tool_use')) toolCallCount++
        const u = rec.message?.usage
        const t = (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
        if (ts < midMs) earlyTokens += t
        else lateTokens += t
      }
    }
  }

  return { messageCount, toolCallCount, earlyTokens, lateTokens }
}

function countMemoryWrites(slug: string, mcdDir: string, cutoffMs: number): number {
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  let files: string[]
  try { files = fs.readdirSync(memDir) } catch { return 0 }
  let count = 0
  for (const f of files) {
    if (!f.endsWith('.md')) continue
    try {
      const stat = fs.statSync(path.join(memDir, f))
      if (stat.mtimeMs >= cutoffMs) count++
    } catch { /* ok */ }
  }
  return count
}

function parseCircuitEvents(slug: string, mcdDir: string, cutoffMs: number): { hadTrip: boolean } {
  const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return { hadTrip: false } }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as RawCircuitEvent
      if (e.event === 'open' && e.ts) {
        const t = Date.parse(e.ts)
        if (!isNaN(t) && t >= cutoffMs) return { hadTrip: true }
      }
    } catch { continue }
  }
  return { hadTrip: false }
}

function parseWatchdogEvents(slug: string, mcdDir: string, cutoffMs: number): { hadKill: boolean } {
  const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-events.jsonl')
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return { hadKill: false } }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as WatchdogEvent
      if (e.event === 'kill' && e.ts) {
        const t = Date.parse(e.ts)
        if (!isNaN(t) && t >= cutoffMs) return { hadKill: true }
      }
    } catch { continue }
  }
  return { hadKill: false }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const hours = Math.max(1, Math.min(168, Number(url.searchParams.get('hours') ?? '24')))
  const cutoffMs = Date.now() - hours * 3_600_000

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

  const projects: ProjectDigest[] = []

  for (const slug of slugs) {
    const { messageCount, toolCallCount, earlyTokens, lateTokens } = parseJsonlActivity(slug, mcdDir, cutoffMs)
    const memoryWrites = countMemoryWrites(slug, mcdDir, cutoffMs)
    const { hadTrip } = parseCircuitEvents(slug, mcdDir, cutoffMs)
    const { hadKill } = parseWatchdogEvents(slug, mcdDir, cutoffMs)

    // Health delta: compare late-half tokens vs early-half (higher token use = more active = positive delta)
    let healthDelta: number | null = null
    if (earlyTokens + lateTokens > 0) {
      if (earlyTokens === 0) healthDelta = 100
      else if (lateTokens === 0) healthDelta = -100
      else healthDelta = Math.round(((lateTokens - earlyTokens) / earlyTokens) * 100)
    }

    // Only include projects active in the window
    if (messageCount === 0 && toolCallCount === 0 && memoryWrites === 0 && !hadTrip && !hadKill) continue

    projects.push({
      slug,
      messageCount,
      toolCallCount,
      memoryWrites,
      hadWatchdogKill: hadKill,
      hadCircuitTrip: hadTrip,
      healthDelta,
    })
  }

  projects.sort((a, b) => b.messageCount + b.toolCallCount - (a.messageCount + a.toolCallCount))

  return Response.json({
    hours,
    projects,
    totalMessages: projects.reduce((s, p) => s + p.messageCount, 0),
    totalToolCalls: projects.reduce((s, p) => s + p.toolCallCount, 0),
    totalMemoryWrites: projects.reduce((s, p) => s + p.memoryWrites, 0),
    watchdogKills: projects.filter(p => p.hadWatchdogKill).length,
    circuitTrips: projects.filter(p => p.hadCircuitTrip).length,
    generatedAt: new Date().toISOString(),
  } satisfies ActivityDigestResponse)
}
