import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type AdvisorSeverity = 'critical' | 'warn' | 'info'
export type AdvisorActionType = 'inject' | 'distill' | 'command'

export interface AdvisorCard {
  id: string
  severity: AdvisorSeverity
  slug?: string
  title: string
  explanation: string
  actionType: AdvisorActionType
  actionPayload: string
}

export interface AdvisorResponse {
  recommendations: AdvisorCard[]
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

function getTranscriptMtime(slug: string, mcdDir: string): number | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
  } catch { return null }
  if (files.length === 0) return null
  let latest = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
      if (m > latest) latest = m
    } catch {}
  }
  return latest || null
}

function getLatestInputTokens(slug: string, mcdDir: string): number | undefined {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return undefined }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(transcriptDir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map((x) => path.join(transcriptDir, x.f))
  } catch { return undefined }
  if (files.length === 0) return undefined
  let raw = ''
  try { raw = fs.readFileSync(files[0], 'utf-8') } catch { return undefined }
  const lines = raw.trim().split('\n').filter(Boolean).reverse()
  for (const line of lines.slice(0, 100)) {
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { usage?: { input_tokens?: number } } }
      if (rec.type === 'assistant' && rec.message?.usage?.input_tokens != null) {
        return rec.message.usage.input_tokens
      }
    } catch {}
  }
  return undefined
}

function getMemoryAge(slug: string, mcdDir: string): number | null {
  const memPath = path.join(mcdDir, 'projects', slug, 'MEMORY.md')
  try {
    const stat = fs.statSync(memPath)
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)
  } catch { return null }
}

function computeMonthlyTokensUsed(slug: string, mcdDir: string): number {
  const now = new Date()
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let files: string[] = []
  try {
    files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
  } catch { return 0 }
  let total = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      try {
        const rec = JSON.parse(line) as { type?: string; timestamp?: string; message?: { usage?: { input_tokens?: number; output_tokens?: number } } }
        if (rec.type !== 'assistant') continue
        if (!rec.timestamp?.startsWith(currentYearMonth)) continue
        const usage = rec.message?.usage
        total += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
      } catch {}
    }
  }
  return total
}

function sevOrder(s: AdvisorSeverity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : 2
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ recommendations: [], generatedAt: new Date().toISOString() } satisfies AdvisorResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string; stuckThresholdMinutes?: number; monthlyTokenBudget?: number }>
    defaults?: { stuckThresholdMinutes?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const defaultThreshold = channels?.defaults?.stuckThresholdMinutes ?? 5
  const chatIdToSlug = new Map<string, string>()

  const projectEntries: Array<{ chatId: string; slug: string; threshold: number; monthlyTokenBudget?: number }> = []
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) {
        chatIdToSlug.set(chatId, proj.slug)
        projectEntries.push({
          chatId,
          slug: proj.slug,
          threshold: proj.stuckThresholdMinutes ?? defaultThreshold,
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

  const recommendations: AdvisorCard[] = []

  for (const { chatId, slug, threshold, monthlyTokenBudget } of projectEntries) {
    if (slug === 'master') continue

    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMs = mtime ? Date.now() - mtime : Infinity
    const ageMins = Math.floor(ageMs / 60_000)
    const isScheduled = scheduledSlugs.has(slug)

    // Circuit open
    const circuit = circuitState[chatId]
    if (circuit?.circuitOpen) {
      const tsMs = new Date(circuit.ts).getTime()
      if (Date.now() - tsMs < 10 * 60_000) {
        recommendations.push({
          id: `circuit-${slug}`,
          severity: 'critical',
          slug,
          title: `Circuit open: ${slug}`,
          explanation: `${slug} has failed repeatedly and its circuit breaker is open. It will not accept new messages until it auto-resets (10 min window).`,
          actionType: 'command',
          actionPayload: `!project stop ${slug}`,
        })
      }
    }

    // Stalled project
    if (!isScheduled && ageMs >= 30 * 60_000 && ageMs < 4 * 60 * 60_000) {
      recommendations.push({
        id: `stall-${slug}`,
        severity: ageMins > 60 ? 'warn' : 'info',
        slug,
        title: `${slug} inactive ${ageMins}m`,
        explanation: `${slug} has not replied in ${ageMins} minutes and may be waiting for operator input or blocked mid-task.`,
        actionType: 'inject',
        actionPayload: `Please summarise your current status and any blockers.`,
      })
    }

    // High context usage
    const inputTokens = getLatestInputTokens(slug, mcdDir)
    if (inputTokens != null) {
      const pct = (inputTokens / 200_000) * 100
      if (pct >= 87) {
        recommendations.push({
          id: `ctx-${slug}`,
          severity: pct >= 95 ? 'critical' : 'warn',
          slug,
          title: `Context ${Math.round(pct)}% full: ${slug}`,
          explanation: `${slug} context window is ${Math.round(pct)}% used. Compression should be triggered to prevent saturation and forced session reset.`,
          actionType: 'inject',
          actionPayload: `Your context window is nearly full. Please summarise completed work, close finished tasks, and compact your working memory before continuing.`,
        })
      } else if (pct >= 70 && pct < 87) {
        // Context fill ETA check — simplified: estimate based on pct
        // If growing quickly and > 70%, warn
        const etaRoughMins = pct > 80 ? 30 : 60
        if (etaRoughMins < 60) {
          recommendations.push({
            id: `ctxeta-${slug}`,
            severity: 'info',
            slug,
            title: `Context ${Math.round(pct)}% — ${slug}`,
            explanation: `${slug} context is at ${Math.round(pct)}%. Monitor for saturation; compression may be needed soon.`,
            actionType: 'inject',
            actionPayload: `Your context window is getting large. Consider summarising completed work to save space.`,
          })
        }
      }
    }

    // Memory stale > 14 days
    const memAgeDays = getMemoryAge(slug, mcdDir)
    if (memAgeDays !== null && memAgeDays > 14) {
      recommendations.push({
        id: `mem-${slug}`,
        severity: 'info',
        slug,
        title: `Stale memory: ${slug}`,
        explanation: `${slug} last distilled memory ${Math.round(memAgeDays)} days ago. Running distillation will give the next session fresher context.`,
        actionType: 'distill',
        actionPayload: slug,
      })
    }

    // Budget warning/critical
    if (monthlyTokenBudget) {
      const used = computeMonthlyTokensUsed(slug, mcdDir)
      const pct = used / monthlyTokenBudget
      if (pct >= 0.9) {
        recommendations.push({
          id: `budget-${slug}`,
          severity: pct >= 1 ? 'critical' : 'warn',
          slug,
          title: `Budget ${pct >= 1 ? 'exhausted' : 'critical'}: ${slug}`,
          explanation: `${slug} has used ${Math.round(pct * 100)}% of its monthly token budget (${used.toLocaleString()}/${monthlyTokenBudget.toLocaleString()}).`,
          actionType: 'command',
          actionPayload: `!project show ${slug}`,
        })
      } else if (pct >= 0.75) {
        recommendations.push({
          id: `budgetwarn-${slug}`,
          severity: 'info',
          slug,
          title: `Budget ${Math.round(pct * 100)}%: ${slug}`,
          explanation: `${slug} has used ${Math.round(pct * 100)}% of monthly budget. Review spending if autonomous tasks are running.`,
          actionType: 'command',
          actionPayload: `!project usage ${slug}`,
        })
      }
    }
  }

  // Sort by severity, take top 5
  recommendations.sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity))
  const top5 = recommendations.slice(0, 5)

  return Response.json({ recommendations: top5, generatedAt: new Date().toISOString() } satisfies AdvisorResponse)
}
