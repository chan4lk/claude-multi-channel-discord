import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const MODEL_CONTEXT_LIMIT = 200_000

export interface ContextHorizonProject {
  slug: string
  tokensUsed: number
  contextLimit: number
  pctUsed: number
  avgGrowthPerTurn: number | null
  turnsRemaining: number | null
  avgInterTurnMs: number | null
  estimatedHoursRemaining: number | null
  lastTurnAt: string | null
  turnCount: number
  status: 'critical' | 'warning' | 'ok' | 'unknown'
}

export interface ContextHorizonResponse {
  projects: ContextHorizonProject[]
  criticalCount: number
  warningCount: number
  computedAt: string
}

interface UsageLine {
  timestamp: string
  totalInputTokens: number
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findMostRecentJsonl(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    const files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const fp = path.join(transcriptDir, f)
        return { fp, mtime: fs.statSync(fp).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    return files[0]?.fp ?? null
  } catch { return null }
}

function extractUsageLines(jsonlPath: string): UsageLine[] {
  const lines: UsageLine[] = []
  let content = ''
  try { content = fs.readFileSync(jsonlPath, 'utf-8') } catch { return lines }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line)
      if (d.type !== 'assistant' || !d.message?.usage || !d.timestamp) continue
      const u = d.message.usage
      const total =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)
      if (total > 0) {
        lines.push({ timestamp: d.timestamp as string, totalInputTokens: total })
      }
    } catch { /* skip */ }
  }

  return lines.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function computeHorizon(slug: string, mcdDir: string): ContextHorizonProject {
  const base: ContextHorizonProject = {
    slug,
    tokensUsed: 0,
    contextLimit: MODEL_CONTEXT_LIMIT,
    pctUsed: 0,
    avgGrowthPerTurn: null,
    turnsRemaining: null,
    avgInterTurnMs: null,
    estimatedHoursRemaining: null,
    lastTurnAt: null,
    turnCount: 0,
    status: 'unknown',
  }

  const jsonl = findMostRecentJsonl(slug, mcdDir)
  if (!jsonl) return base

  const turns = extractUsageLines(jsonl)
  if (turns.length === 0) return base

  const latest = turns[turns.length - 1]!
  base.tokensUsed = latest.totalInputTokens
  base.pctUsed = Math.min(100, Math.round((latest.totalInputTokens / MODEL_CONTEXT_LIMIT) * 100))
  base.lastTurnAt = latest.timestamp
  base.turnCount = turns.length

  // Rolling 5-turn average of context growth
  if (turns.length >= 2) {
    const window = turns.slice(-6)
    const deltas: number[] = []
    for (let i = 1; i < window.length; i++) {
      const delta = window[i]!.totalInputTokens - window[i - 1]!.totalInputTokens
      if (delta > 0) deltas.push(delta)
    }
    if (deltas.length > 0) {
      base.avgGrowthPerTurn = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
      const remaining = MODEL_CONTEXT_LIMIT - latest.totalInputTokens
      base.turnsRemaining = remaining > 0 ? Math.floor(remaining / base.avgGrowthPerTurn) : 0
    }
  }

  // Average inter-turn interval
  if (turns.length >= 2) {
    const window = turns.slice(-6)
    const intervals: number[] = []
    for (let i = 1; i < window.length; i++) {
      const dt = new Date(window[i]!.timestamp).getTime() - new Date(window[i - 1]!.timestamp).getTime()
      if (dt > 0 && dt < 3_600_000) intervals.push(dt) // ignore gaps > 1h (idle)
    }
    if (intervals.length > 0) {
      base.avgInterTurnMs = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
      if (base.turnsRemaining !== null && base.turnsRemaining > 0) {
        base.estimatedHoursRemaining = Math.round((base.turnsRemaining * base.avgInterTurnMs) / 3_600_000 * 10) / 10
      }
    }
  }

  const tr = base.turnsRemaining
  if (tr === null) base.status = 'unknown'
  else if (tr < 5) base.status = 'critical'
  else if (tr < 10) base.status = 'warning'
  else base.status = 'ok'

  return base
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], criticalCount: 0, warningCount: 0, computedAt: new Date().toISOString() })
  }

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir).filter((s) => {
      if (s.startsWith('.')) return false
      try {
        const st = fs.statSync(path.join(projectsDir, s))
        return st.isDirectory() || st.isSymbolicLink()
      } catch { return false }
    })
  } catch { /* no projects */ }

  const projects = slugs.map((slug) => computeHorizon(slug, mcdDir))
    .filter((p) => p.turnCount > 0)
    .sort((a, b) => (a.turnsRemaining ?? 9999) - (b.turnsRemaining ?? 9999))

  return Response.json({
    projects,
    criticalCount: projects.filter((p) => p.status === 'critical').length,
    warningCount: projects.filter((p) => p.status === 'warning').length,
    computedAt: new Date().toISOString(),
  } satisfies ContextHorizonResponse)
}
