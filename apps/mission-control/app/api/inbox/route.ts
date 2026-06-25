import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type AlertSeverity = 'critical' | 'warning'
export type AlertType = 'context-pressure' | 'circuit-open' | 'watchdog-kill' | 'low-health'

export interface InboxAlert {
  id: string
  slug: string
  type: AlertType
  severity: AlertSeverity
  message: string
  ts: string
}

export interface InboxResponse {
  alerts: InboxAlert[]
  total: number
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function getSlugs(mcdDir: string): string[] {
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }
  return slugs
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function getContextPressure(mcdDir: string, slug: string): number {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
  const encoded = encodeProjectCwd(realPath)
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  let jsonlFiles: string[] = []
  try {
    jsonlFiles = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return 0 }

  const CONTEXT_LIMIT = 200_000
  let maxUsed = 0
  for (const f of jsonlFiles) {
    let raw = ''
    try { raw = fs.readFileSync(f, 'utf-8') } catch { continue }
    const lines = raw.split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
      try {
        const entry = JSON.parse(lines[i]) as { type?: string; usage?: { input_tokens?: number } }
        if (entry.usage?.input_tokens != null) {
          maxUsed = Math.max(maxUsed, entry.usage.input_tokens)
          break
        }
      } catch { continue }
    }
  }
  return Math.round((maxUsed / CONTEXT_LIMIT) * 100)
}

function getOpenCircuits(mcdDir: string, slugs: string[]): { slug: string; ts: string }[] {
  const result: { slug: string; ts: string }[] = []
  for (const slug of slugs) {
    const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
    let raw = ''
    try { raw = fs.readFileSync(logPath, 'utf-8') } catch { continue }
    const lines = raw.split('\n').filter(Boolean)
    let lastEvent: { ts: string; event: string } | null = null
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as { ts?: string; event?: string }
        if (e.ts && e.event) lastEvent = { ts: e.ts, event: e.event }
      } catch { continue }
    }
    if (lastEvent?.event === 'open') {
      result.push({ slug, ts: lastEvent.ts })
    }
  }
  return result
}

function getRecentWatchdogKills(mcdDir: string, slugs: string[], windowMs: number): { slug: string; ts: string }[] {
  const cutoff = Date.now() - windowMs
  const result: { slug: string; ts: string }[] = []
  for (const slug of slugs) {
    const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
    let raw = ''
    try { raw = fs.readFileSync(logPath, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as { ts?: string; slug?: string }
        if (e.ts && Date.parse(e.ts) >= cutoff) result.push({ slug, ts: e.ts })
      } catch { continue }
    }
  }
  return result
}

function computeHealthScore(mcdDir: string, slug: string, nowMs: number): number {
  // simplified circuit + watchdog score (matches health-score API weights)
  const circuitPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  const killPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()

  let circuitOpens = 0
  try {
    for (const line of fs.readFileSync(circuitPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as { ts?: string; event?: string }
        if (e.event === 'open' && e.ts && e.ts >= cutoff) circuitOpens++
      } catch { continue }
    }
  } catch { /* no file */ }

  let kills = 0
  try {
    for (const line of fs.readFileSync(killPath, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as { ts?: string }
        if (e.ts && e.ts >= cutoff) kills++
      } catch { continue }
    }
  } catch { /* no file */ }

  const contextPct = getContextPressure(mcdDir, slug)

  const circuitScore = Math.max(0, 100 - (circuitOpens / 7) * 40)
  const killScore = Math.max(0, 100 - (kills / 7) * 50)
  const ctxScore = Math.max(0, 100 - contextPct)

  return Math.round(circuitScore * 0.35 + killScore * 0.35 + ctxScore * 0.30)
}

export async function GET(request: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const slugs = getSlugs(mcdDir)
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const alerts: InboxAlert[] = []
  const seen = new Set<string>()

  function addAlert(a: InboxAlert) {
    const key = `${a.slug}:${a.type}`
    if (seen.has(key)) return
    seen.add(key)
    alerts.push(a)
  }

  // Context pressure >= 80%
  for (const slug of slugs) {
    const pct = getContextPressure(mcdDir, slug)
    if (pct >= 80) {
      addAlert({
        id: `ctx-${slug}`,
        slug,
        type: 'context-pressure',
        severity: pct >= 90 ? 'critical' : 'warning',
        message: `Context at ${pct}% — approaching 200k limit`,
        ts: nowIso,
      })
    }
  }

  // Open circuit breakers
  for (const { slug, ts } of getOpenCircuits(mcdDir, slugs)) {
    addAlert({
      id: `circuit-${slug}`,
      slug,
      type: 'circuit-open',
      severity: 'critical',
      message: 'Circuit breaker open — repeated stuck-agent kills',
      ts,
    })
  }

  // Watchdog kills in last 30 min
  for (const { slug, ts } of getRecentWatchdogKills(mcdDir, slugs, 30 * 60 * 1000)) {
    addAlert({
      id: `wdog-${slug}`,
      slug,
      type: 'watchdog-kill',
      severity: 'warning',
      message: 'Watchdog kill in last 30 min — agent was stuck',
      ts,
    })
  }

  // Health score < 50
  for (const slug of slugs) {
    const score = computeHealthScore(mcdDir, slug, nowMs)
    if (score < 50) {
      addAlert({
        id: `health-${slug}`,
        slug,
        type: 'low-health',
        severity: score < 30 ? 'critical' : 'warning',
        message: `Health score ${score}/100 — below threshold`,
        ts: nowIso,
      })
    }
  }

  // Sort: critical first, then by ts descending
  alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1
    return b.ts.localeCompare(a.ts)
  })

  return Response.json({
    alerts,
    total: alerts.length,
    generatedAt: nowIso,
  } satisfies InboxResponse)
}
