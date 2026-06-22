import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { upsertConvergenceScore, getConvergenceScore } from '../../../src/db'

export const dynamic = 'force-dynamic'

export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'
export type GoalStatus = 'active' | 'paused' | 'completed'
export type BudgetStatus = 'ok' | 'warning' | 'critical' | 'exhausted'

export interface MemoryStatus {
  exists: boolean
  sizeBytes: number
  lastModified: string | null
}

export interface FleetProject {
  slug: string
  state: ProjectState
  ageMins: number
  stuckThresholdMinutes: number
  platform?: string
  monthlyTokenBudget?: number
  monthlyTokensUsed?: number
  budgetStatus?: BudgetStatus
  queuedCount?: number
  circuitOpen?: boolean
  contextUsagePct?: number
  contextFillEtaMinutes?: number
  goalText?: string
  goalStatus?: GoalStatus
  memoryStatus?: MemoryStatus
  convergenceScore?: number
}

export interface FleetResponse {
  idle: number
  active: number
  stalled: number
  autonomous: number
  avgConvergence?: number
  projects: FleetProject[]
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

function computeMonthlyTokensUsed(slug: string, mcdDir: string): number {
  const now = new Date()
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const files = findAllJsonl(slug, mcdDir)
  let total = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue

      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      if (!ts) continue
      // Only count entries from the current calendar month
      if (!ts.startsWith(currentYearMonth)) continue

      const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
      total += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    }
  }

  return total
}

function computeContextUsagePct(slug: string, mcdDir: string): number | undefined {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return undefined }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return undefined }
  if (jsonlFiles.length === 0) return undefined

  // Find the most recently modified JSONL
  let latestFile = ''
  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime > latestMtime) { latestMtime = mtime; latestFile = file }
    } catch {}
  }
  if (!latestFile) return undefined

  let raw = ''
  try { raw = fs.readFileSync(latestFile, 'utf-8') } catch { return undefined }
  const lines = raw.trim().split('\n').filter(Boolean).reverse()
  for (const line of lines.slice(0, 100)) {
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { usage?: { input_tokens?: number } } }
      if (rec.type === 'assistant' && rec.message?.usage?.input_tokens != null) {
        const pct = (rec.message.usage.input_tokens / 200_000) * 100
        return Math.min(Math.round(pct), 100)
      }
    } catch {}
  }
  return undefined
}

function computeContextFillEta(slug: string, mcdDir: string): number | undefined {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return undefined }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return undefined }
  if (jsonlFiles.length === 0) return undefined

  let latestFile = ''
  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime > latestMtime) { latestMtime = mtime; latestFile = file }
    } catch {}
  }
  if (!latestFile) return undefined

  let raw = ''
  try { raw = fs.readFileSync(latestFile, 'utf-8') } catch { return undefined }
  const lines = raw.trim().split('\n').filter(Boolean)

  type TurnSample = { tokens: number; tsMs: number }
  const samples: TurnSample[] = []
  for (const line of lines) {
    if (samples.length >= 10) break
    try {
      const rec = JSON.parse(line) as { type?: string; timestamp?: string; message?: { usage?: { input_tokens?: number } } }
      if (rec.type === 'assistant' && rec.message?.usage?.input_tokens != null && rec.timestamp) {
        const tsMs = new Date(rec.timestamp).getTime()
        if (!isNaN(tsMs)) {
          samples.unshift({ tokens: rec.message.usage.input_tokens, tsMs })
        }
      }
    } catch {}
  }

  if (samples.length < 3) return undefined

  const last5 = samples.slice(-5)
  const tokenDelta = last5[last5.length - 1].tokens - last5[0].tokens
  const timeDeltaMs = last5[last5.length - 1].tsMs - last5[0].tsMs
  const nIntervals = last5.length - 1

  if (tokenDelta <= 0 || timeDeltaMs <= 0) return undefined

  const tokensPerTurn = tokenDelta / nIntervals
  const msPerTurn = timeDeltaMs / nIntervals
  const currentTokens = last5[last5.length - 1].tokens
  const headroom = 200_000 - currentTokens
  if (headroom <= 0) return 0

  const turnsToFill = headroom / tokensPerTurn
  const etaMs = turnsToFill * msPerTurn
  return Math.round(etaMs / 60_000)
}

function readMemoryStatus(slug: string, mcdDir: string): MemoryStatus {
  const memPath = path.join(mcdDir, 'projects', slug, 'MEMORY.md')
  try {
    const stat = fs.statSync(memPath)
    return { exists: true, sizeBytes: stat.size, lastModified: stat.mtime.toISOString() }
  } catch {
    return { exists: false, sizeBytes: 0, lastModified: null }
  }
}

function computeConvergenceScore(slug: string, mcdDir: string, goalText?: string): number {
  const files = findAllJsonl(slug, mcdDir)
  const cutoffMs = Date.now() - 24 * 60 * 60_000
  const goalKeywords = goalText
    ? goalText.toLowerCase().split(/\W+/).filter((w) => w.length > 4)
    : []

  let totalTurns = 0
  let goalAdvancingTurns = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean)
    let i = 0
    while (i < lines.length) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(lines[i]) } catch { i++; continue }
      if (rec.type !== 'assistant') { i++; continue }
      const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : 0
      if (ts < cutoffMs) { i++; continue }
      totalTurns++

      // Look ahead for a tool_result with mcp__mcd__reply
      let hasReply = false
      const content = (rec as { message?: { content?: unknown[] } }).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type?: string; name?: string; input?: { text?: string } }
          if (b.type === 'tool_use' && b.name === 'mcp__mcd__reply') {
            hasReply = true
            const text = (b.input?.text ?? '').toLowerCase()
            if (goalKeywords.length === 0 || goalKeywords.some((kw) => text.includes(kw))) {
              goalAdvancingTurns++
            }
            break
          }
        }
      }
      if (!hasReply && goalKeywords.length === 0) {
        // If no goal keywords defined, count all reply turns
      }
      i++
    }
  }

  if (totalTurns === 0) return 0
  return Math.round((goalAdvancingTurns / totalTurns) * 100)
}

function readGoal(slug: string, mcdDir: string): { goalText: string; goalStatus: GoalStatus } | null {
  const goalPath = path.join(mcdDir, 'projects', slug, 'GOAL.md')
  try {
    const raw = fs.readFileSync(goalPath, 'utf-8').trim()
    if (!raw) return null
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (match) {
      const frontmatter = match[1]
      const body = match[2].trim()
      const statusMatch = frontmatter.match(/^status:\s*(\w+)$/m)
      const status = statusMatch?.[1] as GoalStatus | undefined
      const goalStatus: GoalStatus = (status === 'paused' || status === 'completed') ? status : 'active'
      return { goalText: (body || raw).slice(0, 200), goalStatus }
    }
    return { goalText: raw.slice(0, 200), goalStatus: 'active' }
  } catch {
    return null
  }
}

function getTranscriptMtime(slug: string, mcdDir: string): number | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try {
    realPath = fs.realpathSync(projectPath)
  } catch {
    return null
  }

  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }

  if (jsonlFiles.length === 0) return null

  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(path.join(transcriptDir, file)).mtimeMs
      if (mtime > latestMtime) latestMtime = mtime
    } catch {}
  }

  return latestMtime || null
}

function classifyState(
  chatId: string,
  slug: string,
  mcdDir: string,
  scheduledSlugs: Set<string>,
  stuckThresholdMinutes: number,
  circuitState: Record<string, { circuitOpen: boolean; slug: string; ts: string }>,
  budgetQueueState: Record<string, { slug: string; count: number; updatedAt: string }>,
  monthlyTokenBudget?: number
): FleetProject {
  const mtime = getTranscriptMtime(slug, mcdDir)
  const ageMs = mtime ? Date.now() - mtime : Infinity
  const ageMins = Math.min(Math.floor(ageMs / 60_000), 9999)
  const hasSchedule = scheduledSlugs.has(slug)

  let state: ProjectState
  if (ageMs < 30_000) {
    state = 'active'
  } else if (ageMs < 5 * 60_000) {
    state = hasSchedule ? 'autonomous' : 'idle'
  } else if (ageMs < 2 * 60 * 60_000) {
    state = hasSchedule ? 'autonomous' : 'stalled'
  } else {
    state = hasSchedule ? 'autonomous' : 'idle'
  }

  const result: FleetProject = { slug, state, ageMins, stuckThresholdMinutes }

  if (monthlyTokenBudget != null) {
    result.monthlyTokenBudget = monthlyTokenBudget
    const used = computeMonthlyTokensUsed(slug, mcdDir)
    result.monthlyTokensUsed = used
    const pct = used / monthlyTokenBudget
    result.budgetStatus = pct >= 1 ? 'exhausted' : pct >= 0.8 ? 'critical' : pct >= 0.5 ? 'warning' : 'ok'
    if (result.budgetStatus === 'exhausted') {
      const qe = budgetQueueState[chatId]
      if (qe && qe.count > 0) result.queuedCount = qe.count
    }
  }

  // Add circuit state (auto-expire after 10 min)
  const circuit = circuitState[chatId]
  if (circuit?.circuitOpen) {
    const tsMs = new Date(circuit.ts).getTime()
    if (Date.now() - tsMs < 10 * 60_000) {
      result.circuitOpen = true
    }
  }

  const ctxPct = computeContextUsagePct(slug, mcdDir)
  if (ctxPct != null) {
    result.contextUsagePct = ctxPct
    if (ctxPct > 50) {
      const eta = computeContextFillEta(slug, mcdDir)
      if (eta != null && eta < 120) result.contextFillEtaMinutes = eta
    }
  }

  const goal = readGoal(slug, mcdDir)
  if (goal) { result.goalText = goal.goalText; result.goalStatus = goal.goalStatus }

  const mem = readMemoryStatus(slug, mcdDir)
  if (mem.exists) result.memoryStatus = mem

  const convergenceScore = computeConvergenceScore(slug, mcdDir, result.goalText)
  result.convergenceScore = convergenceScore
  try {
    const today = new Date().toISOString().slice(0, 10)
    upsertConvergenceScore(slug, today, convergenceScore)
  } catch {}

  return result
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] } satisfies FleetResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string; platform?: string; stuckThresholdMinutes?: number; monthlyTokenBudget?: number }>
    defaults?: { stuckThresholdMinutes?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const defaultThreshold = channels?.defaults?.stuckThresholdMinutes ?? 5

  const chatIdToSlug = new Map<string, string>()
  const projectEntries: Array<{ chatId: string; slug: string; platform?: string; stuckThresholdMinutes: number; monthlyTokenBudget?: number }> = []

  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        chatIdToSlug.set(chatId, proj.slug)
        projectEntries.push({
          chatId,
          slug: proj.slug,
          platform: proj.platform,
          stuckThresholdMinutes: proj.stuckThresholdMinutes ?? defaultThreshold,
          monthlyTokenBudget: proj.monthlyTokenBudget,
        })
      }
    }
  }

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  const circuitState = readJson<Record<string, { circuitOpen: boolean; slug: string; ts: string }>>(
    path.join(mcdDir, 'circuit-state.json')
  ) ?? {}

  const budgetQueueState = readJson<Record<string, { slug: string; count: number; updatedAt: string }>>(
    path.join(mcdDir, 'budget-queue-state.json')
  ) ?? {}

  const projects: FleetProject[] = projectEntries.map(({ chatId, slug, platform, stuckThresholdMinutes, monthlyTokenBudget }) => {
    const p = classifyState(chatId, slug, mcdDir, scheduledSlugs, stuckThresholdMinutes, circuitState, budgetQueueState, monthlyTokenBudget)
    if (platform) p.platform = platform
    return p
  })

  const counts = { idle: 0, active: 0, stalled: 0, autonomous: 0 }
  for (const p of projects) counts[p.state]++

  const scoredProjects = projects.filter((p) => p.convergenceScore != null)
  const avgConvergence = scoredProjects.length > 0
    ? Math.round(scoredProjects.reduce((sum, p) => sum + (p.convergenceScore ?? 0), 0) / scoredProjects.length)
    : undefined

  return Response.json({ ...counts, avgConvergence, projects } satisfies FleetResponse)
}
