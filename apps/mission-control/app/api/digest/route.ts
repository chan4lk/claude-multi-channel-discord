import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  insertDigest, getLatestDigest, getDigestHistory,
  getAlertEvents, getConvergenceScore, getGoalAdvancementScore, getLatestContextPressure,
} from '../../../src/db'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface DigestProject {
  slug: string
  contextPct: number
  convergence: number | null
  goalPct: number | null
  alertCount: number
  turnsToday: number
  flags: string[] // e.g. "context-critical", "low-convergence"
}

export interface DigestPayload {
  projects: DigestProject[]
  totalAlerts: number
  stuckCount: number
  topActive: string[] // top-5 by turnsToday
  markdownSummary: string
}

export interface DigestResponse {
  id: number
  ts: number
  projectCount: number
  payload: DigestPayload
}

export interface DigestHistoryResponse {
  digests: Array<{ id: number; ts: number; projectCount: number; summary: string }>
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function countTurnsToday(slug: string, mcdDir: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  let count = 0
  try {
    const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
    for (const f of files) {
      const full = path.join(transcriptDir, f)
      if (fs.statSync(full).mtimeMs < cutoff.getTime()) continue
      const raw = fs.readFileSync(full, 'utf-8')
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as { role?: string; timestamp?: string }
          if (parsed.role === 'assistant' && parsed.timestamp) {
            if (new Date(parsed.timestamp) >= cutoff) count++
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* ignore */ }
  return count
}

function countStuckToday(slug: string, mcdDir: string): boolean {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return false }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  const cutoff = Date.now() - 24 * 3_600_000
  try {
    const files = fs.readdirSync(transcriptDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(transcriptDir, f))
      .filter((f) => fs.statSync(f).mtimeMs > cutoff)
    for (const f of files) {
      const raw = fs.readFileSync(f, 'utf-8')
      if (/\bstuck\b/i.test(raw)) return true
    }
  } catch { /* ignore */ }
  return false
}

function buildMarkdown(projects: DigestProject[], totalAlerts: number, stuckCount: number): string {
  const lines: string[] = [
    `# Fleet Digest — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `**${projects.length} projects** · ${totalAlerts} alerts · ${stuckCount} stuck signals`,
    '',
    '## Project Health',
  ]
  for (const p of projects) {
    const flags = p.flags.length > 0 ? ` ⚠ ${p.flags.join(', ')}` : ' ✓'
    lines.push(`- **${p.slug}**: ctx ${p.contextPct}% · cnv ${p.convergence ?? '—'} · goal ${p.goalPct ?? '—'}% · ${p.turnsToday} turns${flags}`)
  }
  if (projects.length === 0) lines.push('- No projects.')
  lines.push('')
  lines.push('## Top Active')
  const top = [...projects].sort((a, b) => b.turnsToday - a.turnsToday).slice(0, 5)
  for (const p of top) lines.push(`- ${p.slug}: ${p.turnsToday} turns today`)
  return lines.join('\n')
}

async function computeDigest(mcdDir: string): Promise<DigestResponse> {
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)
  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }

  const projects: DigestProject[] = []
  let stuckCount = 0

  for (const slug of slugs) {
    const ctx = getLatestContextPressure(slug)
    const convergence = getConvergenceScore(slug)
    const goalPct = getGoalAdvancementScore(slug)
    const alerts = getAlertEvents({ slug, limit: 100 })
    const alertCount = alerts.length
    const turnsToday = countTurnsToday(slug, mcdDir)
    const isStuck = countStuckToday(slug, mcdDir)
    if (isStuck) stuckCount++

    const flags: string[] = []
    const contextPct = ctx?.score ?? 0
    if (contextPct >= 90) flags.push('context-critical')
    else if (contextPct >= 70) flags.push('context-warning')
    if (convergence !== null && convergence < 30) flags.push('low-convergence')
    if (goalPct !== null && goalPct < 20) flags.push('goal-drift')
    if (isStuck) flags.push('stuck')

    projects.push({ slug, contextPct, convergence, goalPct: goalPct, alertCount, turnsToday, flags })
  }

  const totalAlerts = projects.reduce((s, p) => s + p.alertCount, 0)
  const topActive = [...projects].sort((a, b) => b.turnsToday - a.turnsToday).slice(0, 5).map((p) => p.slug)
  const markdownSummary = buildMarkdown(projects, totalAlerts, stuckCount)

  const payload: DigestPayload = { projects, totalAlerts, stuckCount, topActive, markdownSummary }
  const id = insertDigest(slugs.length, markdownSummary.slice(0, 200), payload)

  return { id, ts: Math.floor(Date.now() / 1000), projectCount: slugs.length, payload }
}

export async function POST(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const digest = await computeDigest(mcdDir)
  return Response.json(digest)
}

export async function GET(req: NextRequest): Promise<Response> {
  const history = req.nextUrl.searchParams.get('history')
  if (history) {
    const rows = getDigestHistory(30)
    return Response.json({
      digests: rows.map((r) => ({ id: r.id, ts: r.ts, projectCount: r.project_count, summary: r.summary })),
    } satisfies DigestHistoryResponse)
  }

  const latest = getLatestDigest()
  if (!latest) return Response.json({ error: 'No digest yet. POST /api/digest to generate.' }, { status: 404 })

  return Response.json({
    id: latest.id,
    ts: latest.ts,
    projectCount: latest.project_count,
    payload: JSON.parse(latest.payload) as DigestPayload,
  } satisfies DigestResponse)
}
