import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface TurnUsage {
  ts: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalTokens: number
}

export interface ProjectTokenStats {
  slug: string
  turns: TurnUsage[]
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  avgTokensPerTurn: number
  burnRatePerHour: number   // tokens/hour based on last 6h
  maxContextTokens: number  // 200_000 assumed
  contextPressurePct: number // cumulative session tokens / maxContext * 100
}

export interface TokenUsageResponse {
  projects: ProjectTokenStats[]
  windowDays: number
  selectedSlug: string | null
  generatedAt: string
}

const MODEL_CONTEXT = 200_000

interface JsonlLine {
  timestamp?: string
  message?: {
    role?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
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
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return [] }
}

function parseUsageFromJsonl(jsonlPath: string, cutoffMs: number): TurnUsage[] {
  const turns: TurnUsage[] = []
  let lines: string[]
  try { lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean) } catch { return [] }

  for (const raw of lines) {
    let line: JsonlLine
    try { line = JSON.parse(raw) } catch { continue }
    if (!line.timestamp || line.message?.role !== 'assistant') continue
    const ts = Date.parse(line.timestamp)
    if (isNaN(ts) || ts < cutoffMs) continue
    const u = line.message?.usage
    if (!u) continue
    const inputTokens = u.input_tokens ?? 0
    const outputTokens = u.output_tokens ?? 0
    const cacheReadTokens = u.cache_read_input_tokens ?? 0
    const cacheCreationTokens = u.cache_creation_input_tokens ?? 0
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
    if (totalTokens === 0) continue
    turns.push({
      ts: line.timestamp,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens,
    })
  }

  return turns
}

function computeBurnRate(turns: TurnUsage[], windowMs = 6 * 3_600_000): number {
  const cutoff = Date.now() - windowMs
  const recent = turns.filter((t) => Date.parse(t.ts) >= cutoff)
  if (recent.length < 2) return 0
  const totalRecent = recent.reduce((s, t) => s + t.totalTokens, 0)
  const spanMs = Date.parse(recent[recent.length - 1]!.ts) - Date.parse(recent[0]!.ts)
  if (spanMs <= 0) return 0
  return Math.round((totalRecent / spanMs) * 3_600_000)
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const windowDays = Math.max(1, Math.min(30, parseInt(url.searchParams.get('window') ?? '7', 10)))
  const selectedSlug = url.searchParams.get('slug') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  const targetSlugs = selectedSlug ? [selectedSlug] : allSlugs
  const cutoffMs = Date.now() - windowDays * 24 * 3_600_000

  const projects: ProjectTokenStats[] = []

  for (const slug of targetSlugs) {
    const allTurns: TurnUsage[] = []
    for (const f of findJsonlFiles(slug, mcdDir)) {
      allTurns.push(...parseUsageFromJsonl(f, cutoffMs))
    }
    if (allTurns.length === 0) continue

    allTurns.sort((a, b) => a.ts.localeCompare(b.ts))

    const totalInputTokens = allTurns.reduce((s, t) => s + t.inputTokens, 0)
    const totalOutputTokens = allTurns.reduce((s, t) => s + t.outputTokens, 0)
    const totalTokens = allTurns.reduce((s, t) => s + t.totalTokens, 0)
    const avgTokensPerTurn = allTurns.length > 0 ? Math.round(totalTokens / allTurns.length) : 0
    const burnRatePerHour = computeBurnRate(allTurns)

    // Context pressure = cumulative tokens of most recent session / model context
    const latestSessionCumulative = (() => {
      if (allTurns.length === 0) return 0
      // Estimate: sum tokens from last "session start" (gap > 30min resets)
      let cumulative = 0
      let sessionStart = Date.parse(allTurns[allTurns.length - 1]!.ts)
      for (let i = allTurns.length - 1; i >= 0; i--) {
        const t = allTurns[i]!
        const next = allTurns[i + 1]
        if (next && Date.parse(next.ts) - Date.parse(t.ts) > 30 * 60_000) break
        cumulative += t.totalTokens
        sessionStart = Date.parse(t.ts)
        void sessionStart
      }
      return cumulative
    })()

    const contextPressurePct = Math.min(100, Math.round((latestSessionCumulative / MODEL_CONTEXT) * 100))

    projects.push({
      slug,
      turns: allTurns,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      avgTokensPerTurn,
      burnRatePerHour,
      maxContextTokens: MODEL_CONTEXT,
      contextPressurePct,
    })
  }

  // Sort by burn rate desc (top burners first)
  projects.sort((a, b) => b.burnRatePerHour - a.burnRatePerHour || b.totalTokens - a.totalTokens)

  return Response.json({
    projects,
    windowDays,
    selectedSlug,
    generatedAt: new Date().toISOString(),
  } satisfies TokenUsageResponse)
}
