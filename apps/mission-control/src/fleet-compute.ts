import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type ProjectState = 'idle' | 'active' | 'stalled' | 'autonomous'
export type GoalStatus = 'active' | 'paused' | 'completed'
export type BudgetStatus = 'ok' | 'warning' | 'critical' | 'exhausted'

export interface FleetProject {
  slug: string
  state: ProjectState
  ageMins: number
  stuckThresholdMinutes: number
  monthlyTokenBudget?: number
  monthlyTokensUsed?: number
  budgetStatus?: BudgetStatus
  queuedCount?: number
  circuitOpen?: boolean
  contextUsagePct?: number
  goalText?: string
  goalStatus?: GoalStatus
}

export interface FleetResponse {
  idle: number
  active: number
  stalled: number
  autonomous: number
  projects: FleetProject[]
}

export interface StallEntry {
  slug: string
  stallAgeMins: number
  stallReason: string
  snippet: string | null
}

export interface StallsResponse {
  stalls: StallEntry[]
  checkedAt: string
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

function getTranscriptInfo(slug: string, mcdDir: string): { mtime: number | null; latestFile: string | null } {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try {
    realPath = fs.realpathSync(projectPath)
  } catch {
    return { mtime: null, latestFile: null }
  }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { mtime: null, latestFile: null }
  }
  if (jsonlFiles.length === 0) return { mtime: null, latestFile: null }
  let latestFile = ''
  let latestMtime = 0
  for (const file of jsonlFiles) {
    try {
      const mtime = fs.statSync(path.join(transcriptDir, file)).mtimeMs
      if (mtime > latestMtime) {
        latestMtime = mtime
        latestFile = path.join(transcriptDir, file)
      }
    } catch {}
  }
  return { mtime: latestMtime || null, latestFile: latestFile || null }
}

function extractSnippet(transcriptFile: string): string | null {
  try {
    const content = fs.readFileSync(transcriptFile, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean).reverse()
    for (const line of lines.slice(0, 50)) {
      try {
        const entry = JSON.parse(line)
        if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const block of entry.message.content) {
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
              return block.text.slice(0, 200).trim()
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null
}

function computeContextUsagePct(slug: string, mcdDir: string): number | undefined {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return undefined }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(transcriptDir, f))
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
  const lines = raw.trim().split('\n').filter(Boolean).reverse()
  for (const line of lines.slice(0, 100)) {
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { usage?: { input_tokens?: number } } }
      if (rec.type === 'assistant' && rec.message?.usage?.input_tokens != null) {
        return Math.min(Math.round((rec.message.usage.input_tokens / 200_000) * 100), 100)
      }
    } catch {}
  }
  return undefined
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

function computeBudgetStatus(used: number, budget: number): BudgetStatus {
  const pct = used / budget
  if (pct >= 1) return 'exhausted'
  if (pct >= 0.8) return 'critical'
  if (pct >= 0.5) return 'warning'
  return 'ok'
}

function stallReason(ageMins: number): string {
  if (ageMins > 60) return `Inactive ${ageMins}m — likely waiting for operator input`
  if (ageMins > 30) return `Inactive ${ageMins}m — may be blocked on a question`
  return `Inactive ${ageMins}m — possible stall or slow tool call`
}

function computeMonthlyTokensUsed(slug: string, mcdDir: string): number {
  const now = new Date()
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const files: string[] = []
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    files.push(...fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(transcriptDir, f)))
  } catch { return 0 }
  let total = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      if (!ts || !ts.startsWith(currentYearMonth)) continue
      const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
      total += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    }
  }
  return total
}

interface ProjectEntry {
  chatId: string
  slug: string
  stuckThresholdMinutes: number
  monthlyTokenBudget?: number
}

interface ChannelsJson {
  projects?: Record<string, { slug?: string; stuckThresholdMinutes?: number; monthlyTokenBudget?: number }>
  defaults?: { stuckThresholdMinutes?: number }
}

interface SchedulesJson {
  schedules?: Array<{ chatId?: string; enabled?: boolean }>
}

function loadChannelEntries(mcdDir: string): { entries: ProjectEntry[]; chatIdToSlug: Map<string, string>; defaultThreshold: number } {
  const channels = readJson<ChannelsJson>(path.join(mcdDir, 'channels.json'))
  const defaultThreshold = channels?.defaults?.stuckThresholdMinutes ?? 5
  const chatIdToSlug = new Map<string, string>()
  const entries: ProjectEntry[] = []
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        chatIdToSlug.set(chatId, proj.slug)
        entries.push({
          chatId,
          slug: proj.slug,
          stuckThresholdMinutes: proj.stuckThresholdMinutes ?? defaultThreshold,
          monthlyTokenBudget: proj.monthlyTokenBudget,
        })
      }
    }
  }
  return { entries, chatIdToSlug, defaultThreshold }
}

function loadScheduledSlugs(mcdDir: string, chatIdToSlug: Map<string, string>): Set<string> {
  const schedules = readJson<SchedulesJson>(path.join(mcdDir, 'schedules.json'))
  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }
  return scheduledSlugs
}

export function computeFleet(mcdDir: string | undefined): FleetResponse {
  if (!mcdDir) return { idle: 0, active: 0, stalled: 0, autonomous: 0, projects: [] }
  const { entries, chatIdToSlug } = loadChannelEntries(mcdDir)
  const scheduledSlugs = loadScheduledSlugs(mcdDir, chatIdToSlug)
  const circuitState = readJson<Record<string, { circuitOpen: boolean; slug: string; ts: string }>>(
    path.join(mcdDir, 'circuit-state.json')
  ) ?? {}

  const budgetQueueState = readJson<Record<string, { slug: string; count: number; updatedAt: string }>>(
    path.join(mcdDir, 'budget-queue-state.json')
  ) ?? {}

  const projects: FleetProject[] = entries.map(({ chatId, slug, stuckThresholdMinutes, monthlyTokenBudget }) => {
    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMs = mtime ? Date.now() - mtime : Infinity
    const ageMins = Math.min(Math.floor(ageMs / 60_000), 9999)
    const hasSchedule = scheduledSlugs.has(slug)
    let state: ProjectState
    if (ageMs < 30_000) state = 'active'
    else if (ageMs < 5 * 60_000) state = hasSchedule ? 'autonomous' : 'idle'
    else if (ageMs < 2 * 60 * 60_000) state = hasSchedule ? 'autonomous' : 'stalled'
    else state = hasSchedule ? 'autonomous' : 'idle'
    const result: FleetProject = { slug, state, ageMins, stuckThresholdMinutes }
    if (monthlyTokenBudget != null) {
      result.monthlyTokenBudget = monthlyTokenBudget
      const used = computeMonthlyTokensUsed(slug, mcdDir)
      result.monthlyTokensUsed = used
      result.budgetStatus = computeBudgetStatus(used, monthlyTokenBudget)
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
    if (ctxPct != null) result.contextUsagePct = ctxPct
    const goal = readGoal(slug, mcdDir)
    if (goal) { result.goalText = goal.goalText; result.goalStatus = goal.goalStatus }
    return result
  })

  const counts = { idle: 0, active: 0, stalled: 0, autonomous: 0 }
  for (const p of projects) counts[p.state]++
  return { ...counts, projects }
}

export function computeStalls(mcdDir: string | undefined): StallsResponse {
  if (!mcdDir) return { stalls: [], checkedAt: new Date().toISOString() }
  const { entries, chatIdToSlug } = loadChannelEntries(mcdDir)
  const scheduledSlugs = loadScheduledSlugs(mcdDir, chatIdToSlug)

  const stalls: StallEntry[] = []
  for (const { slug } of entries) {
    if (slug === 'master') continue
    const { mtime, latestFile } = getTranscriptInfo(slug, mcdDir)
    if (!mtime) continue
    const ageMs = Date.now() - mtime
    const ageMins = Math.floor(ageMs / 60_000)
    if (ageMs >= 5 * 60_000 && ageMs < 2 * 60 * 60_000 && !scheduledSlugs.has(slug)) {
      const snippet = latestFile ? extractSnippet(latestFile) : null
      stalls.push({ slug, stallAgeMins: ageMins, stallReason: stallReason(ageMins), snippet })
    }
  }
  stalls.sort((a, b) => b.stallAgeMins - a.stallAgeMins)
  return { stalls, checkedAt: new Date().toISOString() }
}
