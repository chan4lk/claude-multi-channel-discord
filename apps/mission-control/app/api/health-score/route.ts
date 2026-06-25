import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getConvergenceScore } from '../../../src/db'

export const dynamic = 'force-dynamic'

interface DimResult {
  score: number
  series: number[]
}

interface ProjectHealth {
  slug: string
  healthScore: number
  dims: {
    circuitTripRate: DimResult
    watchdogKillRate: DimResult
    contextPressure: DimResult
    toolErrorRate: DimResult
    goalAlignment: DimResult
  }
}

export interface HealthScoreResponse {
  projects: ProjectHealth[]
  generatedAt: string
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
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

function dayBucket(ts: string, nowMs: number): number | null {
  const ms = Date.parse(ts)
  if (isNaN(ms)) return null
  const daysAgo = Math.floor((nowMs - ms) / 86_400_000)
  if (daysAgo < 0 || daysAgo >= 7) return null
  return 6 - daysAgo
}

function computeCircuitTripRate(slug: string, mcdDir: string, nowMs: number): DimResult {
  const logPath = path.join(mcdDir, 'projects', slug, 'circuit-events.jsonl')
  const daily = new Array<number>(7).fill(0)
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return { score: 100, series: daily } }

  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { ts?: string; event?: string }
      if (e.event !== 'open' || !e.ts || e.ts < cutoff) continue
      const bucket = dayBucket(e.ts, nowMs)
      if (bucket !== null) daily[bucket]++
    } catch { continue }
  }

  const total = daily.reduce((a, b) => a + b, 0)
  const rate = total / 7
  const score = Math.max(0, 100 - rate * 40)
  return { score: Math.round(score), series: daily }
}

function computeWatchdogKillRate(slug: string, mcdDir: string, nowMs: number): DimResult {
  const logPath = path.join(mcdDir, 'projects', slug, 'watchdog-kills.jsonl')
  const daily = new Array<number>(7).fill(0)
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { return { score: 100, series: daily } }

  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { ts?: string }
      if (!e.ts || e.ts < cutoff) continue
      const bucket = dayBucket(e.ts, nowMs)
      if (bucket !== null) daily[bucket]++
    } catch { continue }
  }

  const total = daily.reduce((a, b) => a + b, 0)
  const rate = total / 7
  const score = Math.max(0, 100 - rate * 50)
  return { score: Math.round(score), series: daily }
}

function computeContextPressure(slug: string, mcdDir: string): DimResult {
  const files = findJsonlFiles(slug, mcdDir)
  if (files.length === 0) return { score: 100, series: new Array(7).fill(100) }

  let latestFile = ''
  let latestMtime = 0
  for (const file of files) {
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime > latestMtime) { latestMtime = mtime; latestFile = file }
    } catch {}
  }
  if (!latestFile) return { score: 100, series: new Array(7).fill(100) }

  let raw = ''
  try { raw = fs.readFileSync(latestFile, 'utf-8') } catch { return { score: 100, series: new Array(7).fill(100) } }

  const lines = raw.trim().split('\n').filter(Boolean).reverse()
  for (const line of lines.slice(0, 100)) {
    try {
      const rec = JSON.parse(line) as { type?: string; message?: { usage?: { input_tokens?: number } } }
      if (rec.type === 'assistant' && rec.message?.usage?.input_tokens != null) {
        const inputTokens = rec.message.usage.input_tokens
        const score = Math.max(0, Math.round(100 - (inputTokens / 200_000) * 100))
        return { score, series: new Array(7).fill(score) }
      }
    } catch {}
  }
  return { score: 100, series: new Array(7).fill(100) }
}

function computeToolErrorRate(slug: string, mcdDir: string, nowMs: number): DimResult {
  const files = findJsonlFiles(slug, mcdDir)
  const daily = new Array<number>(7).fill(0)
  const dailyTotal = new Array<number>(7).fill(0)
  let totalErrors = 0
  let totalTools = 0
  const cutoff = new Date(nowMs - 7 * 86_400_000).toISOString()

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line) as {
          type?: string
          timestamp?: string
          is_error?: boolean
        }
        if (rec.type !== 'tool_result') continue
        const ts = rec.timestamp ?? ''
        if (ts && ts < cutoff) continue

        totalTools++
        const bucket = ts ? dayBucket(ts, nowMs) : null
        if (bucket !== null) dailyTotal[bucket]++

        if (rec.is_error === true) {
          totalErrors++
          if (bucket !== null) daily[bucket]++
        }
      } catch { continue }
    }
  }

  const series = daily.map((errs, i) => dailyTotal[i] > 0 ? Math.round((errs / dailyTotal[i]) * 100) : 0)
  const errorRate = totalErrors / Math.max(1, totalTools)
  const score = Math.max(0, Math.round(100 - errorRate * 100))
  return { score, series }
}

function computeGoalAlignment(slug: string): DimResult {
  const convergenceScore = getConvergenceScore(slug)
  const score = convergenceScore !== null ? Math.round(convergenceScore) : 50
  return { score, series: new Array(7).fill(score) }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const nowMs = Date.now()
  const projects: ProjectHealth[] = slugs.map((slug) => {
    const circuitTripRate = computeCircuitTripRate(slug, mcdDir, nowMs)
    const watchdogKillRate = computeWatchdogKillRate(slug, mcdDir, nowMs)
    const contextPressure = computeContextPressure(slug, mcdDir)
    const toolErrorRate = computeToolErrorRate(slug, mcdDir, nowMs)
    const goalAlignment = computeGoalAlignment(slug)

    const healthScore = Math.round(
      circuitTripRate.score * 0.25 +
      watchdogKillRate.score * 0.20 +
      contextPressure.score * 0.20 +
      toolErrorRate.score * 0.20 +
      goalAlignment.score * 0.15
    )

    return {
      slug,
      healthScore,
      dims: { circuitTripRate, watchdogKillRate, contextPressure, toolErrorRate, goalAlignment },
    }
  })

  projects.sort((a, b) => b.healthScore - a.healthScore)

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies HealthScoreResponse)
}
