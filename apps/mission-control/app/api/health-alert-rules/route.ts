import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface AlertRule {
  slug: string
  threshold: number
  lastScore: number | null
  consecutiveBelowCount: number
  alertFired: boolean
  lastEvalAt: string | null
  status: 'ok' | 'warning' | 'alert'
}

export interface HealthAlertRulesResponse {
  rules: AlertRule[]
  generatedAt: string
}

function mcdDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
}

interface ChannelEntry {
  slug?: string
  healthScoreThreshold?: number
}

interface ChannelsJson {
  projects?: Record<string, ChannelEntry>
}

interface AlertState {
  consecutiveBelowCount: number
  alertFired: boolean
  lastScore: number
  lastEvalAt: string
}

function readChannels(dir: string): ChannelsJson | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'channels.json'), 'utf-8')) as ChannelsJson }
  catch { return null }
}

function readAlertState(dir: string): Record<string, AlertState> {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'health-alert-state.json'), 'utf-8')) as Record<string, AlertState> }
  catch { return {} }
}

function getRealProjectPath(dir: string, slug: string): string | null {
  try { return fs.realpathSync(path.join(dir, 'projects', slug)) } catch { return null }
}

function getTranscriptDir(realPath: string): string {
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  return path.join(os.homedir(), '.claude', 'projects', encoded)
}

function computeCurrentScore(dir: string, slug: string): number | null {
  try {
    const realPath = getRealProjectPath(dir, slug)
    if (!realPath) return null

    const memDir = path.join(realPath, 'memory')
    let memoryFiles = 0
    try {
      memoryFiles = fs.readdirSync(memDir).filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).length
    } catch { /* ok */ }

    const transcriptDir = getTranscriptDir(realPath)
    let sessions = 0
    let lastModifiedMs: number | null = null
    try {
      const files = fs.readdirSync(transcriptDir).filter((f) => f.endsWith('.jsonl'))
      sessions = files.length
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(transcriptDir, f))
          if (lastModifiedMs === null || stat.mtimeMs > lastModifiedMs) lastModifiedMs = stat.mtimeMs
        } catch { /* skip */ }
      }
    } catch { /* ok */ }

    const killWindow = 7 * 24 * 3_600_000
    const logPath = path.join(dir, 'projects', slug, 'watchdog-kills.jsonl')
    let recentKills = 0
    try {
      const raw = fs.readFileSync(logPath, 'utf-8')
      const cutoff = Date.now() - killWindow
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const ev = JSON.parse(line) as { ts?: string }
          if (ev.ts && new Date(ev.ts).getTime() >= cutoff) recentKills++
        } catch { /* skip */ }
      }
    } catch { /* ok */ }

    const specclaw = path.join(realPath, '.specclaw', 'changes')
    let openProposals = 0
    try {
      for (const ch of fs.readdirSync(specclaw)) {
        const proposalMd = path.join(specclaw, ch, 'proposal.md')
        const verifyReport = path.join(specclaw, ch, 'verify-report.md')
        if (fs.existsSync(proposalMd) && !fs.existsSync(verifyReport)) openProposals++
      }
    } catch { /* ok */ }

    const lastActiveDaysAgo = lastModifiedMs !== null ? (Date.now() - lastModifiedMs) / (24 * 3_600_000) : null

    const memoryScore = Math.round(Math.min(memoryFiles / 20, 1) * 25)
    const activityScore = sessions === 0 ? 0 : Math.round(10 + Math.min((sessions - 1) / 49, 1) * 15)
    let recencyScore = 0
    if (lastActiveDaysAgo !== null) {
      if (lastActiveDaysAgo <= 1) recencyScore = 20
      else if (lastActiveDaysAgo <= 7) recencyScore = 15
      else if (lastActiveDaysAgo <= 30) recencyScore = 8
      else if (lastActiveDaysAgo <= 90) recencyScore = 3
    }
    const stabilityScore = Math.max(0, 20 - recentKills * 5)
    const proposalScore = openProposals === 0 ? 5
      : openProposals <= 3 ? 10
      : openProposals <= 6 ? 8
      : 6

    return memoryScore + activityScore + recencyScore + stabilityScore + proposalScore
  } catch { return null }
}

export async function GET(): Promise<Response> {
  const dir = mcdDir()
  const channels = readChannels(dir)
  if (!channels) return Response.json({ rules: [], generatedAt: new Date().toISOString() } satisfies HealthAlertRulesResponse)

  const alertState = readAlertState(dir)
  const rules: AlertRule[] = []

  for (const [chatId, entry] of Object.entries(channels.projects ?? {})) {
    const threshold = entry.healthScoreThreshold
    if (typeof threshold !== 'number' || !entry.slug) continue

    const state = alertState[chatId]
    const lastScore = state?.lastScore ?? computeCurrentScore(dir, entry.slug)

    let status: AlertRule['status'] = 'ok'
    if (state?.alertFired) status = 'alert'
    else if (typeof lastScore === 'number' && lastScore < threshold) status = 'warning'

    rules.push({
      slug: entry.slug,
      threshold,
      lastScore: lastScore ?? null,
      consecutiveBelowCount: state?.consecutiveBelowCount ?? 0,
      alertFired: state?.alertFired ?? false,
      lastEvalAt: state?.lastEvalAt ?? null,
      status,
    })
  }

  rules.sort((a, b) => {
    const order = { alert: 0, warning: 1, ok: 2 }
    return order[a.status] - order[b.status]
  })

  return Response.json({ rules, generatedAt: new Date().toISOString() } satisfies HealthAlertRulesResponse)
}

export async function PUT(req: NextRequest): Promise<Response> {
  let body: { slug: string; threshold: number | null }
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { slug, threshold } = body
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 })
  }
  if (threshold !== null && (typeof threshold !== 'number' || threshold < 0 || threshold > 100)) {
    return Response.json({ error: 'threshold must be 0-100 or null' }, { status: 400 })
  }

  const dir = mcdDir()
  const channelsPath = path.join(dir, 'channels.json')
  let channels: ChannelsJson
  try { channels = JSON.parse(fs.readFileSync(channelsPath, 'utf-8')) as ChannelsJson }
  catch { return Response.json({ error: 'channels.json not found' }, { status: 500 }) }

  let found = false
  for (const entry of Object.values(channels.projects ?? {})) {
    if (entry.slug === slug) {
      if (threshold === null) {
        delete entry.healthScoreThreshold
      } else {
        entry.healthScoreThreshold = threshold
      }
      found = true
      break
    }
  }

  if (!found) return Response.json({ error: `Project "${slug}" not found` }, { status: 404 })

  const tmp = channelsPath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(channels, null, 2), 'utf-8')
  fs.renameSync(tmp, channelsPath)

  return Response.json({ ok: true })
}
