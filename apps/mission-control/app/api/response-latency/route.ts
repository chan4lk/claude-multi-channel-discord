import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export type LatencyTrend = 'improving' | 'stable' | 'degrading'

export interface ProjectLatency {
  slug: string
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  p99: number
  samples: number
  trend: LatencyTrend
  recent7dP90: number | null
  prior7dP90: number | null
}

export interface ResponseLatencyResponse {
  projects: ProjectLatency[]
  generatedAt: string
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
  const projectPath = path.join(mcdDir, 'projects', slug)
  let realPath = projectPath
  try { realPath = fs.realpathSync(projectPath) } catch { return [] }
  const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  try {
    return fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(transcriptDir, f))
  } catch { return [] }
}

interface Turn {
  userTs: number
  assistantTs: number
  deltaSeconds: number
}

function parseTurns(slug: string, mcdDir: string): Turn[] {
  const files = findJsonlFiles(slug, mcdDir)
  const turns: Turn[] = []

  for (const file of files) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }

    interface Rec {
      type?: string
      timestamp?: string
      message?: {
        role?: string
        content?: Array<{ type?: string }>
      }
    }

    let pendingUserTs: number | null = null

    for (const raw of lines) {
      let rec: Rec
      try { rec = JSON.parse(raw) } catch { continue }

      const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN
      if (isNaN(ts)) continue

      const role = rec.message?.role
      const content = rec.message?.content ?? []

      if (role === 'user' && content.length > 0 && content[0]?.type !== 'tool_result') {
        pendingUserTs = ts
      } else if (role === 'assistant' && pendingUserTs !== null) {
        const delta = (ts - pendingUserTs) / 1000
        if (delta >= 0 && delta < 3600) {
          turns.push({ userTs: pendingUserTs, assistantTs: ts, deltaSeconds: delta })
        }
        pendingUserTs = null
      }
    }
  }

  return turns
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
}

function p90OfWindow(turns: Turn[], startMs: number, endMs: number): number | null {
  const window = turns.filter(t => t.userTs >= startMs && t.userTs < endMs)
  if (window.length < 3) return null
  const sorted = window.map(t => t.deltaSeconds).sort((a, b) => a - b)
  return percentile(sorted, 90)
}

function computeTrend(recent: number | null, prior: number | null): LatencyTrend {
  if (recent === null || prior === null || prior === 0) return 'stable'
  const change = (recent - prior) / prior
  if (change < -0.1) return 'improving'
  if (change > 0.1) return 'degrading'
  return 'stable'
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

  const now = Date.now()
  const day7 = 7 * 24 * 3_600_000
  const recent7dStart = now - day7
  const prior7dStart = now - 2 * day7

  const projects: ProjectLatency[] = []

  for (const slug of slugs) {
    const turns = parseTurns(slug, mcdDir)
    if (turns.length < 3) continue

    const sorted = turns.map(t => t.deltaSeconds).sort((a, b) => a - b)

    const recent7dP90 = p90OfWindow(turns, recent7dStart, now)
    const prior7dP90 = p90OfWindow(turns, prior7dStart, recent7dStart)

    projects.push({
      slug,
      p10: Math.round(percentile(sorted, 10)),
      p25: Math.round(percentile(sorted, 25)),
      p50: Math.round(percentile(sorted, 50)),
      p75: Math.round(percentile(sorted, 75)),
      p90: Math.round(percentile(sorted, 90)),
      p99: Math.round(percentile(sorted, 99)),
      samples: turns.length,
      trend: computeTrend(recent7dP90, prior7dP90),
      recent7dP90: recent7dP90 !== null ? Math.round(recent7dP90) : null,
      prior7dP90: prior7dP90 !== null ? Math.round(prior7dP90) : null,
    })
  }

  // Sort by p90 desc
  projects.sort((a, b) => b.p90 - a.p90)

  return Response.json({
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies ResponseLatencyResponse)
}
