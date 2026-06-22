import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export interface DailyHealthPoint {
  date: string
  score: number
  recency: number
  stallRate: number
  efficiency: number
  freshness: number
}

export interface ProjectTrend {
  slug: string
  daily: DailyHealthPoint[]
  currentScore: number
  trendArrow: 'up' | 'down' | 'flat'
  trendDelta: number
  trendColor: 'green' | 'red' | 'grey'
  insufficientData: boolean
}

export interface HealthTrendsResponse {
  projects: ProjectTrend[]
  checkedAt: string
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

interface DayRecord {
  lastTurnTs: number | null
  totalOutput: number
  totalToolCalls: number
  stalled: number
  sessions: number
}

function buildDayMap(files: string[], days: string[]): Map<string, DayRecord> {
  const map = new Map<string, DayRecord>()
  for (const d of days) {
    map.set(d, { lastTurnTs: null, totalOutput: 0, totalToolCalls: 0, stalled: 0, sessions: 0 })
  }

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean)

    let fileStalled = false
    const tail = lines.slice(-20)
    fileStalled = tail.some((l) => {
      try {
        const r = JSON.parse(l) as Record<string, unknown>
        const s = JSON.stringify(r)
        return s.includes('stuck') || s.includes('stalled') ||
          (s.includes('stop_reason') && s.includes('timeout'))
      } catch { return false }
    })

    // Track which days this file contributes sessions to
    const filedays = new Set<string>()

    for (const line of lines) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue

      const ts = typeof rec.timestamp === 'string'
        ? new Date(rec.timestamp).getTime()
        : null
      if (!ts) continue

      const date = new Date(ts).toISOString().slice(0, 10)
      if (!map.has(date)) continue

      const dr = map.get(date)!
      if (dr.lastTurnTs === null || ts > dr.lastTurnTs) dr.lastTurnTs = ts

      const msg = (rec as { message?: { usage?: { output_tokens?: number }; content?: unknown[] } }).message
      dr.totalOutput += msg?.usage?.output_tokens ?? 0

      const content = Array.isArray(msg?.content) ? msg.content : []
      for (const block of content) {
        if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_use') {
          dr.totalToolCalls++
        }
      }

      if (!filedays.has(date)) {
        filedays.add(date)
        dr.sessions++
        if (fileStalled) dr.stalled++
      }
    }
  }

  return map
}

function computeMemoryMtimes(slug: string, mcdDir: string): Map<string, number> {
  // Returns map of date -> latest mtime (ms) of any memory file written on that date
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  const result = new Map<string, number>()
  try {
    const files = fs.readdirSync(memDir).filter((f) => f.endsWith('.md'))
    for (const f of files) {
      try {
        const s = fs.statSync(path.join(memDir, f))
        const date = new Date(s.mtimeMs).toISOString().slice(0, 10)
        const cur = result.get(date) ?? 0
        if (s.mtimeMs > cur) result.set(date, s.mtimeMs)
      } catch { /* skip */ }
    }
  } catch { /* no memory dir */ }
  return result
}

function computeFleetMedianOutputPerCall(slugs: string[], mcdDir: string, days: string[]): number {
  const ratios: number[] = []
  for (const slug of slugs) {
    const files = findAllJsonl(slug, mcdDir)
    const dayMap = buildDayMap(files, days)
    for (const [, dr] of dayMap) {
      if (dr.totalToolCalls > 0) {
        ratios.push(dr.totalOutput / dr.totalToolCalls)
      }
    }
  }
  if (ratios.length === 0) return 0
  ratios.sort((a, b) => a - b)
  const mid = Math.floor(ratios.length / 2)
  return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid]
}

function scoreRecency(dayTs: number | null, dayEndMs: number): number {
  if (dayTs === null) return 0
  const hoursSince = (dayEndMs - dayTs) / (1000 * 60 * 60)
  return Math.round(100 * Math.exp(-hoursSince / 24))
}

function scoreStallRate(dr: DayRecord): number {
  if (dr.sessions === 0) return 100
  return Math.round((1 - dr.stalled / dr.sessions) * 100)
}

function scoreEfficiency(dr: DayRecord, fleetMedian: number): number {
  if (dr.totalToolCalls === 0) return 50
  const ratio = dr.totalOutput / dr.totalToolCalls
  const median = fleetMedian > 0 ? fleetMedian : ratio
  const r = ratio / median
  return Math.max(0, Math.min(100, Math.round(100 / (1 + r))))
}

function scoreFreshness(memMtimes: Map<string, number>, date: string, dayEndMs: number): number {
  const mtime = memMtimes.get(date)
  if (mtime === undefined) return 30
  const daysSince = (dayEndMs - mtime) / (1000 * 60 * 60 * 24)
  return Math.round(100 * Math.exp(-daysSince / 20))
}

function computeProjectTrend(
  slug: string,
  mcdDir: string,
  days: string[],
  fleetMedian: number,
): ProjectTrend {
  const files = findAllJsonl(slug, mcdDir)
  const dayMap = buildDayMap(files, days)
  const memMtimes = computeMemoryMtimes(slug, mcdDir)

  const now = Date.now()
  const daily: DailyHealthPoint[] = days.map((date) => {
    const dr = dayMap.get(date) ?? { lastTurnTs: null, totalOutput: 0, totalToolCalls: 0, stalled: 0, sessions: 0 }
    const dayEndMs = Math.min(now, new Date(date + 'T23:59:59Z').getTime())

    const recency = scoreRecency(dr.lastTurnTs, dayEndMs)
    const stallRate = scoreStallRate(dr)
    const efficiency = scoreEfficiency(dr, fleetMedian)
    const freshness = scoreFreshness(memMtimes, date, dayEndMs)

    const hasData = dr.sessions >= 1
    const score = hasData
      ? Math.round(recency * 0.4 + stallRate * 0.3 + efficiency * 0.2 + freshness * 0.1)
      : -1

    return { date, score, recency, stallRate, efficiency, freshness }
  })

  const totalSessions = daily.reduce((s, d) => s + (d.score >= 0 ? 1 : 0), 0)
  const insufficientData = totalSessions < 2

  const validScores = daily.filter((d) => d.score >= 0)
  const currentScore = validScores.length > 0 ? validScores[validScores.length - 1].score : -1

  // 7-day trend: avg of last 7 valid vs avg of prior 7 valid
  const recent7 = validScores.slice(-7)
  const prior7 = validScores.slice(-14, -7)
  const recentAvg = recent7.length > 0 ? recent7.reduce((s, d) => s + d.score, 0) / recent7.length : 0
  const priorAvg = prior7.length > 0 ? prior7.reduce((s, d) => s + d.score, 0) / prior7.length : recentAvg
  const trendDelta = Math.round(recentAvg - priorAvg)

  const trendArrow: 'up' | 'down' | 'flat' = trendDelta >= 3 ? 'up' : trendDelta <= -3 ? 'down' : 'flat'
  const trendColor: 'green' | 'red' | 'grey' = trendDelta >= 5 ? 'green' : trendDelta <= -5 ? 'red' : 'grey'

  return { slug, daily, currentScore, trendArrow, trendDelta, trendColor, insufficientData }
}

export async function GET() {
  const mcdDir = process.env.MCD_CHANNELS_DIR ??
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  let channels: { projects?: Record<string, { slug: string }> } | null = null
  try {
    channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8'))
  } catch { /* empty */ }

  const slugs = Object.values(channels?.projects ?? {}).map((p) => p.slug).filter(Boolean)

  const now = Date.now()
  const days: string[] = []
  for (let d = 29; d >= 0; d--) {
    days.push(new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  }

  const fleetMedian = computeFleetMedianOutputPerCall(slugs, mcdDir, days)
  const projects = slugs.map((slug) => computeProjectTrend(slug, mcdDir, days, fleetMedian))

  return NextResponse.json({ projects, checkedAt: new Date().toISOString() } satisfies HealthTrendsResponse)
}
