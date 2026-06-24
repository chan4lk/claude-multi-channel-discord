import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
// NOTE: src/db (better-sqlite3) is imported dynamically inside computeFindings
// so that the pure rule registry + adapters below can be imported under Bun's
// test runner, which cannot load the better-sqlite3 native addon.

// ── Unified Fleet attention engine (P208) ───────────────────────────────────
// Single rule set behind BOTH the Fleet Advisor (actionable cards) and the
// Fleet Brief (narrative deep-links). Each rule emits a typed Finding carrying
// everything either surface needs: severity, slug, signal source, advisor
// title/explanation/action, and a brief one-liner message + deep-link href.
// Add a new signal by adding ONE entry to RULES — both surfaces pick it up.

export const WINDOW_DAYS = 30

export type Severity = 'critical' | 'warn' | 'info' | 'ok'
export type ActionType = 'inject' | 'distill' | 'command'
export type SignalKey =
  | 'circuit' | 'context' | 'stall' | 'idle' | 'memory'
  | 'budget' | 'thrashing' | 'declining' | 'alerts' | 'healthy'

export interface Finding {
  id: string
  slug: string
  severity: Severity
  signal: SignalKey
  title: string // advisor headline
  explanation: string // advisor detail
  message: string // brief one-liner
  href: string // deep-link
  action?: { type: ActionType; payload: string } // present → surfaces as an advisor card
}

/** Per-project signals, read once and shared across all rules. */
export interface FleetSignals {
  slug: string
  chatId: string
  isScheduled: boolean
  ageMs: number
  ageMins: number
  ageHours: number
  ageDays: number
  contextPct: number | null
  churn: number
  convDelta: number | null
  highChurn: boolean
  openAlerts: number
  memAgeDays: number | null
  monthlyTokenBudget?: number
  monthlyUsed?: number
  circuitOpen: boolean // open AND within the 10-min auto-reset window
}

export interface RuleCtx {
  medianChurn: number
}

export type Rule = (s: FleetSignals, ctx: RuleCtx) => Finding | null

export function sevOrder(s: Severity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : s === 'info' ? 2 : 3
}

// ── shared signal readers (deduped from the old advisor route) ───────────────

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function transcriptDirFor(slug: string, mcdDir: string): string | null {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return null }
  return path.join(os.homedir(), '.claude', 'projects', encodeProjectCwd(realPath))
}

function getTranscriptMtime(slug: string, mcdDir: string): number | null {
  const dir = transcriptDirFor(slug, mcdDir)
  if (!dir) return null
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')) } catch { return null }
  let latest = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(dir, f)).mtimeMs
      if (m > latest) latest = m
    } catch {}
  }
  return latest || null
}

function getLatestInputTokens(slug: string, mcdDir: string): number | undefined {
  const dir = transcriptDirFor(slug, mcdDir)
  if (!dir) return undefined
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
      .map((x) => path.join(dir, x.f))
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
  try {
    const stat = fs.statSync(path.join(mcdDir, 'projects', slug, 'MEMORY.md'))
    return (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)
  } catch { return null }
}

function computeMonthlyTokensUsed(slug: string, mcdDir: string): number {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const dir = transcriptDirFor(slug, mcdDir)
  if (!dir) return 0
  let files: string[] = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)) } catch { return 0 }
  let total = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      try {
        const rec = JSON.parse(line) as { type?: string; timestamp?: string; message?: { usage?: { input_tokens?: number; output_tokens?: number } } }
        if (rec.type !== 'assistant') continue
        if (!rec.timestamp?.startsWith(ym)) continue
        const u = rec.message?.usage
        total += (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0)
      } catch {}
    }
  }
  return total
}

// ── the rule registry — edit HERE to add a signal (P208 AC5) ─────────────────

export const RULES: Rule[] = [
  // Circuit breaker open.
  (s) => s.circuitOpen ? {
    id: `circuit-${s.slug}`, slug: s.slug, severity: 'critical', signal: 'circuit',
    title: `Circuit open: ${s.slug}`,
    explanation: `${s.slug} has failed repeatedly and its circuit breaker is open. It will not accept new messages until it auto-resets (10 min window).`,
    message: `${s.slug}: circuit breaker open — failing repeatedly`,
    href: `/focus/${s.slug}`,
    action: { type: 'command', payload: `!project stop ${s.slug}` },
  } : null,

  // Context window pressure.
  (s) => {
    if (s.contextPct == null) return null
    const pct = Math.round(s.contextPct)
    if (s.contextPct >= 87) return {
      id: `ctx-${s.slug}`, slug: s.slug, severity: s.contextPct >= 95 ? 'critical' : 'warn', signal: 'context',
      title: `Context ${pct}% full: ${s.slug}`,
      explanation: `${s.slug} context window is ${pct}% used. Compression should be triggered to prevent saturation and forced session reset.`,
      message: `${s.slug}: context ${pct}% full — compress soon`,
      href: `/context-eta`,
      action: { type: 'inject', payload: `Your context window is nearly full. Please summarise completed work, close finished tasks, and compact your working memory before continuing.` },
    }
    if (s.contextPct >= 80 && s.contextPct < 87) return {
      id: `ctxeta-${s.slug}`, slug: s.slug, severity: 'info', signal: 'context',
      title: `Context ${pct}% — ${s.slug}`,
      explanation: `${s.slug} context is at ${pct}%. Monitor for saturation; compression may be needed soon.`,
      message: `${s.slug}: context ${pct}% — monitor for saturation`,
      href: `/context-eta`,
      action: { type: 'inject', payload: `Your context window is getting large. Consider summarising completed work to save space.` },
    }
    return null
  },

  // Idle — long silence with no memory writes (checked before stall).
  (s) => (!s.isScheduled && s.ageDays >= 2 && s.churn === 0) ? {
    id: `idle-${s.slug}`, slug: s.slug, severity: 'info', signal: 'idle',
    title: `${s.slug} idle ${s.ageDays}d`,
    explanation: `${s.slug} has not replied in ${s.ageDays} days and has written no memory — it may be idle rather than working.`,
    message: `${s.slug}: stalled ${s.ageDays}d with no memory writes — may be idle`,
    href: `/focus/${s.slug}`,
    action: { type: 'inject', payload: `Please summarise your current status and any blockers.` },
  } : null,

  // Stall — silent but recently active, may be blocked mid-task.
  (s) => {
    const idleApplies = !s.isScheduled && s.ageDays >= 2 && s.churn === 0
    if (s.isScheduled || idleApplies) return null
    if (s.ageMs < 30 * 60_000 || s.ageMs >= 48 * 3_600_000) return null
    const severity: Severity = s.ageMins <= 60 ? 'info' : 'warn'
    const label = s.ageHours >= 1 ? `${s.ageHours}h` : `${s.ageMins}m`
    return {
      id: `stall-${s.slug}`, slug: s.slug, severity, signal: 'stall',
      title: `${s.slug} inactive ${label}`,
      explanation: `${s.slug} has not replied in ${label} and may be waiting for operator input or blocked mid-task.`,
      message: `${s.slug}: no reply in ${label} — may be blocked mid-task`,
      href: `/focus/${s.slug}`,
      action: { type: 'inject', payload: `Please summarise your current status and any blockers.` },
    }
  },

  // Stale memory.
  (s) => (s.memAgeDays != null && s.memAgeDays > 14) ? {
    id: `mem-${s.slug}`, slug: s.slug, severity: 'info', signal: 'memory',
    title: `Stale memory: ${s.slug}`,
    explanation: `${s.slug} last distilled memory ${Math.round(s.memAgeDays)} days ago. Running distillation will give the next session fresher context.`,
    message: `${s.slug}: memory ${Math.round(s.memAgeDays)}d stale — distill for fresher context`,
    href: `/focus/${s.slug}`,
    action: { type: 'distill', payload: s.slug },
  } : null,

  // Monthly token budget.
  (s) => {
    if (!s.monthlyTokenBudget || s.monthlyUsed == null) return null
    const pct = s.monthlyUsed / s.monthlyTokenBudget
    if (pct >= 0.9) return {
      id: `budget-${s.slug}`, slug: s.slug, severity: pct >= 1 ? 'critical' : 'warn', signal: 'budget',
      title: `Budget ${pct >= 1 ? 'exhausted' : 'critical'}: ${s.slug}`,
      explanation: `${s.slug} has used ${Math.round(pct * 100)}% of its monthly token budget (${s.monthlyUsed.toLocaleString()}/${s.monthlyTokenBudget.toLocaleString()}).`,
      message: `${s.slug}: ${Math.round(pct * 100)}% of monthly token budget used`,
      href: `/focus/${s.slug}`,
      action: { type: 'command', payload: `!project show ${s.slug}` },
    }
    if (pct >= 0.75) return {
      id: `budgetwarn-${s.slug}`, slug: s.slug, severity: 'info', signal: 'budget',
      title: `Budget ${Math.round(pct * 100)}%: ${s.slug}`,
      explanation: `${s.slug} has used ${Math.round(pct * 100)}% of monthly budget. Review spending if autonomous tasks are running.`,
      message: `${s.slug}: ${Math.round(pct * 100)}% of monthly token budget used`,
      href: `/focus/${s.slug}`,
      action: { type: 'command', payload: `!project usage ${s.slug}` },
    }
    return null
  },

  // Thrashing — declining convergence with heavy memory churn.
  (s) => (s.convDelta != null && s.convDelta < -0.001 && s.highChurn) ? {
    id: `thrash-${s.slug}`, slug: s.slug, severity: 'critical', signal: 'thrashing',
    title: `Thrashing: ${s.slug}`,
    explanation: `${s.slug} convergence is falling (${(s.convDelta * 100).toFixed(1)}%) while memory churn is high (${s.churn} lines) — likely rework loops rather than progress.`,
    message: `${s.slug}: declining convergence (${(s.convDelta * 100).toFixed(1)}%) with high memory churn (${s.churn} lines) — likely thrashing`,
    href: `/focus/${s.slug}`,
    action: { type: 'inject', payload: `Your convergence is declining while memory churn is high. Step back, confirm the current goal, and avoid rewriting prior decisions unless they are wrong.` },
  } : null,

  // Declining — losing ground without the churn signature.
  (s) => (s.convDelta != null && s.convDelta < -0.001 && !s.highChurn) ? {
    id: `decl-${s.slug}`, slug: s.slug, severity: 'warn', signal: 'declining',
    title: `Convergence declining: ${s.slug}`,
    explanation: `${s.slug} convergence dropped ${(s.convDelta * 100).toFixed(1)}% over the window — it is losing ground on its goal.`,
    message: `${s.slug}: convergence declining (${(s.convDelta * 100).toFixed(1)}%) — losing ground`,
    href: `/focus/${s.slug}`,
  } : null,

  // Open alert backlog (fleet-wide triage view; no per-project action).
  (s) => (s.openAlerts > 0) ? {
    id: `alerts-${s.slug}`, slug: s.slug, severity: s.openAlerts >= 3 ? 'warn' : 'info', signal: 'alerts',
    title: `${s.openAlerts} open alert${s.openAlerts === 1 ? '' : 's'}: ${s.slug}`,
    explanation: `${s.slug} has ${s.openAlerts} unacknowledged alert${s.openAlerts === 1 ? '' : 's'} awaiting triage.`,
    message: `${s.slug}: ${s.openAlerts} open alert${s.openAlerts === 1 ? '' : 's'} awaiting triage`,
    href: `/alert-flow`,
  } : null,
]

// Healthy is derived after the issue rules: only when nothing else fired.
function healthyFinding(s: FleetSignals): Finding | null {
  if (s.convDelta != null && s.convDelta > 0.001 && s.openAlerts === 0 && s.ageHours < 24) {
    return {
      id: `ok-${s.slug}`, slug: s.slug, severity: 'ok', signal: 'healthy',
      title: `${s.slug} healthy`,
      explanation: `${s.slug} convergence is improving (+${(s.convDelta * 100).toFixed(1)}%) with no open alerts and recent activity.`,
      message: `${s.slug}: improving convergence (+${(s.convDelta * 100).toFixed(1)}%) — healthy`,
      href: `/focus/${s.slug}`,
    }
  }
  return null
}

/** Gather every project's signals once, then run the shared rule set. */
export async function computeFindings(mcdDir: string): Promise<Finding[]> {
  const { getMemoryConvergenceXY, getAlertFlow } = await import('../src/db')
  const channels = readJson<{
    projects?: Record<string, { slug?: string; stuckThresholdMinutes?: number; monthlyTokenBudget?: number }>
  }>(path.join(mcdDir, 'channels.json'))
  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )
  const circuitState = readJson<Record<string, { circuitOpen: boolean; slug: string; ts: string }>>(
    path.join(mcdDir, 'circuit-state.json')
  ) ?? {}

  const chatIdToSlug = new Map<string, string>()
  const entries: Array<{ chatId: string; slug: string; monthlyTokenBudget?: number }> = []
  for (const [chatId, proj] of Object.entries(channels?.projects ?? {})) {
    if (proj.slug && proj.slug !== 'master') {
      chatIdToSlug.set(chatId, proj.slug)
      entries.push({ chatId, slug: proj.slug, monthlyTokenBudget: proj.monthlyTokenBudget })
    }
  }
  if (entries.length === 0) return []

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  // Joined memory churn + convergence delta (P201 helper).
  const sinceTs = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10)
  const xy = getMemoryConvergenceXY(sinceTs, sinceDate)
  const xyBy = new Map(xy.map((r) => [r.slug, r]))
  const churns = xy.map((r) => r.churn).filter((c) => c > 0).sort((a, b) => a - b)
  const medianChurn = churns.length ? churns[Math.floor((churns.length - 1) / 2)] : 0

  const alertBy = new Map<string, number>()
  for (const a of getAlertFlow(sinceTs, /* includeAcked */ false)) {
    alertBy.set(a.slug, (alertBy.get(a.slug) ?? 0) + a.count)
  }

  const ctx: RuleCtx = { medianChurn }
  const out: Finding[] = []

  for (const { chatId, slug, monthlyTokenBudget } of entries) {
    const row = xyBy.get(slug)
    const convDelta =
      row && row.convStart != null && row.convEnd != null && row.convPoints >= 2
        ? Math.round((row.convEnd - row.convStart) * 1000) / 1000
        : null
    const churn = row?.churn ?? 0
    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMs = mtime ? Date.now() - mtime : Infinity
    const inputTokens = getLatestInputTokens(slug, mcdDir)
    const circuit = circuitState[chatId]
    const circuitOpen = !!circuit?.circuitOpen && Date.now() - new Date(circuit.ts).getTime() < 10 * 60_000

    const s: FleetSignals = {
      slug, chatId,
      isScheduled: scheduledSlugs.has(slug),
      ageMs,
      ageMins: ageMs === Infinity ? Infinity : Math.floor(ageMs / 60_000),
      ageHours: ageMs === Infinity ? Infinity : Math.floor(ageMs / 3_600_000),
      ageDays: ageMs === Infinity ? Infinity : Math.floor(ageMs / 86_400_000),
      contextPct: inputTokens != null ? (inputTokens / 200_000) * 100 : null,
      churn,
      convDelta,
      highChurn: churn > 0 && churn >= Math.max(medianChurn, 1),
      openAlerts: alertBy.get(slug) ?? 0,
      memAgeDays: getMemoryAge(slug, mcdDir),
      monthlyTokenBudget,
      monthlyUsed: monthlyTokenBudget ? computeMonthlyTokensUsed(slug, mcdDir) : undefined,
      circuitOpen,
    }

    const before = out.length
    for (const rule of RULES) {
      const f = rule(s, ctx)
      if (f) out.push(f)
    }
    // Healthy only when no issue fired for this project.
    if (out.length === before) {
      const h = healthyFinding(s)
      if (h) out.push(h)
    }
  }

  out.sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity) || a.slug.localeCompare(b.slug))
  return out
}

// ── surface adapters ────────────────────────────────────────────────────────

export interface AdvisorCard {
  id: string
  severity: 'critical' | 'warn' | 'info'
  slug?: string
  title: string
  explanation: string
  actionType: ActionType
  actionPayload: string
}

/** Findings that carry an action become Advisor cards (top N by severity). */
export function toAdvisorCards(findings: Finding[], limit = 5): AdvisorCard[] {
  return findings
    .filter((f) => f.action && f.severity !== 'ok')
    .map((f) => ({
      id: f.id,
      severity: f.severity as 'critical' | 'warn' | 'info',
      slug: f.slug || undefined,
      title: f.title,
      explanation: f.explanation,
      actionType: f.action!.type,
      actionPayload: f.action!.payload,
    }))
    .slice(0, limit)
}

export interface BriefFinding {
  slug: string
  severity: Severity
  message: string
  href: string
}

export interface BriefResult {
  findings: BriefFinding[]
  fleetStatus: 'attention' | 'nominal' | 'empty'
}

/** All findings become Brief cards; an all-nominal fleet collapses to one card. */
export function toBriefResult(findings: Finding[], hasProjects: boolean): BriefResult {
  if (!hasProjects) return { findings: [], fleetStatus: 'empty' }
  const hasIssue = findings.some((f) => f.severity !== 'ok')
  if (!hasIssue) {
    return {
      findings: [{
        slug: '', severity: 'ok',
        message: 'All projects nominal — no thrashing, stalls, or open alerts detected.',
        href: '/',
      }],
      fleetStatus: 'nominal',
    }
  }
  return {
    findings: findings.map((f) => ({ slug: f.slug, severity: f.severity, message: f.message, href: f.href })),
    fleetStatus: 'attention',
  }
}

/** True when the instance has at least one non-master project registered. */
export function hasProjects(mcdDir: string): boolean {
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  return Object.values(channels?.projects ?? {}).some((p) => p.slug && p.slug !== 'master')
}
