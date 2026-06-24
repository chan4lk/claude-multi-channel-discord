import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getMemoryConvergenceXY, getAlertFlow } from '../../../src/db'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30

export type BriefSeverity = 'critical' | 'warn' | 'info' | 'ok'

export interface BriefFinding {
  slug: string
  severity: BriefSeverity
  message: string
  href: string // deep-link to the most relevant existing view
}

export interface BriefResponse {
  findings: BriefFinding[]
  fleetStatus: 'attention' | 'nominal' | 'empty'
  windowDays: number
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

/** Latest transcript mtime (ms) for a project, or null when none found. */
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
  let latest = 0
  for (const f of files) {
    try {
      const m = fs.statSync(path.join(transcriptDir, f)).mtimeMs
      if (m > latest) latest = m
    } catch {}
  }
  return latest || null
}

function sevOrder(s: BriefSeverity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : s === 'info' ? 2 : 3
}

export async function GET(): Promise<Response> {
  const generatedAt = new Date().toISOString()
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ findings: [], fleetStatus: 'empty', windowDays: WINDOW_DAYS, generatedAt } satisfies BriefResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const schedules = readJson<{ schedules?: Array<{ chatId?: string; enabled?: boolean }> }>(
    path.join(mcdDir, 'schedules.json')
  )

  const chatIdToSlug = new Map<string, string>()
  const slugs: string[] = []
  for (const [chatId, proj] of Object.entries(channels?.projects ?? {})) {
    if (proj.slug && proj.slug !== 'master') {
      chatIdToSlug.set(chatId, proj.slug)
      slugs.push(proj.slug)
    }
  }

  if (slugs.length === 0) {
    return Response.json({ findings: [], fleetStatus: 'empty', windowDays: WINDOW_DAYS, generatedAt } satisfies BriefResponse)
  }

  const scheduledSlugs = new Set<string>()
  for (const s of schedules?.schedules ?? []) {
    if (s.enabled !== false && s.chatId) {
      const slug = chatIdToSlug.get(s.chatId)
      if (slug) scheduledSlugs.add(slug)
    }
  }

  // Joined memory churn + convergence delta over the window (reuses P201 helper).
  const sinceTs = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10)
  const xy = getMemoryConvergenceXY(sinceTs, sinceDate)
  const xyBy = new Map(xy.map((r) => [r.slug, r]))

  // Median churn across projects with any churn → adaptive "high churn" bar.
  const churns = xy.map((r) => r.churn).filter((c) => c > 0).sort((a, b) => a - b)
  const medianChurn = churns.length
    ? churns[Math.floor((churns.length - 1) / 2)]
    : 0

  // Open (unacknowledged) alert counts per slug over the window.
  const alertBy = new Map<string, number>()
  for (const a of getAlertFlow(sinceTs, /* includeAcked */ false)) {
    alertBy.set(a.slug, (alertBy.get(a.slug) ?? 0) + a.count)
  }

  const findings: BriefFinding[] = []

  for (const slug of slugs) {
    const row = xyBy.get(slug)
    const convDelta =
      row && row.convStart != null && row.convEnd != null && row.convPoints >= 2
        ? Math.round((row.convEnd - row.convStart) * 1000) / 1000
        : null
    const churn = row?.churn ?? 0
    const highChurn = churn > 0 && churn >= Math.max(medianChurn, 1)
    const openAlerts = alertBy.get(slug) ?? 0

    const mtime = getTranscriptMtime(slug, mcdDir)
    const ageMs = mtime ? Date.now() - mtime : Infinity
    const ageHours = ageMs === Infinity ? Infinity : Math.floor(ageMs / 3_600_000)
    const ageDays = ageMs === Infinity ? Infinity : Math.floor(ageMs / 86_400_000)
    const isScheduled = scheduledSlugs.has(slug)

    let matched = false

    // Rule: thrashing — declining convergence with heavy memory churn.
    if (convDelta != null && convDelta < -0.001 && highChurn) {
      findings.push({
        slug,
        severity: 'critical',
        message: `${slug}: declining convergence (${(convDelta * 100).toFixed(1)}%) with high memory churn (${churn} lines) — likely thrashing`,
        href: '/memory-convergence-xy',
      })
      matched = true
    } else if (convDelta != null && convDelta < -0.001) {
      // Rule: declining — losing ground without the churn signature.
      findings.push({
        slug,
        severity: 'warn',
        message: `${slug}: convergence declining (${(convDelta * 100).toFixed(1)}%) — losing ground`,
        href: '/convergence-trend',
      })
      matched = true
    }

    // Rule: idle — long silence with no memory writes.
    if (!isScheduled && ageDays >= 2 && churn === 0) {
      findings.push({
        slug,
        severity: 'info',
        message: `${slug}: stalled ${ageDays}d with no memory writes — may be idle`,
        href: '/idle-fleet',
      })
      matched = true
    } else if (!isScheduled && ageHours >= 4 && ageHours < 48) {
      // Rule: stall — silent but recently active, may be blocked mid-task.
      findings.push({
        slug,
        severity: 'warn',
        message: `${slug}: no reply in ${ageHours}h — may be blocked mid-task`,
        href: '/feed',
      })
      matched = true
    }

    // Rule: open alerts — unresolved triage backlog.
    if (openAlerts > 0) {
      findings.push({
        slug,
        severity: openAlerts >= 3 ? 'warn' : 'info',
        message: `${slug}: ${openAlerts} open alert${openAlerts === 1 ? '' : 's'} awaiting triage`,
        href: '/alert-flow',
      })
      matched = true
    }

    // Rule: healthy — improving convergence, active, no alerts.
    if (!matched && convDelta != null && convDelta > 0.001 && openAlerts === 0 && ageHours < 24) {
      findings.push({
        slug,
        severity: 'ok',
        message: `${slug}: improving convergence (+${(convDelta * 100).toFixed(1)}%) — healthy`,
        href: '/convergence-trend',
      })
    }
  }

  // Severity drives sort order; ties broken alphabetically for stable output.
  findings.sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity) || a.slug.localeCompare(b.slug))

  const hasIssue = findings.some((f) => f.severity !== 'ok')
  let fleetStatus: BriefResponse['fleetStatus'] = 'nominal'
  if (hasIssue) fleetStatus = 'attention'

  // All-nominal state: no issues anywhere → one explicit reassurance card.
  if (!hasIssue) {
    return Response.json({
      findings: [
        {
          slug: '',
          severity: 'ok',
          message: 'All projects nominal — no thrashing, stalls, or open alerts detected.',
          href: '/',
        },
      ],
      fleetStatus,
      windowDays: WINDOW_DAYS,
      generatedAt,
    } satisfies BriefResponse)
  }

  return Response.json({ findings, fleetStatus, windowDays: WINDOW_DAYS, generatedAt } satisfies BriefResponse)
}
