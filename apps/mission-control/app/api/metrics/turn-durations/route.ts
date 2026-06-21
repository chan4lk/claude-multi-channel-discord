import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface TurnDurationEntry {
  slug: string
  p50: number
  p90: number
  p99: number
  max: number
  count: number
  recommendedThresholdMins: number
}

export interface TurnDurationsResponse {
  projects: TurnDurationEntry[]
  generatedAt: string
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(Math.floor(sorted.length * p), sorted.length - 1)
  return sorted[idx]
}

function computeTurnDurations(slug: string, mcdDir: string): TurnDurationEntry {
  const files = findAllJsonl(slug, mcdDir)
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const durations: number[] = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean)

    let userTs: number | null = null

    for (const line of lines) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : null
      if (!ts || ts < cutoff) continue

      if (rec.type === 'user') {
        userTs = ts
      } else if (rec.type === 'assistant' && userTs !== null) {
        const dur = ts - userTs
        if (dur > 0 && dur < 60 * 60 * 1000) {
          durations.push(dur)
        }
        userTs = null
      }
    }
  }

  durations.sort((a, b) => a - b)

  const p50ms = percentile(durations, 0.5)
  const p90ms = percentile(durations, 0.9)
  const p99ms = percentile(durations, 0.99)
  const maxMs = durations.length > 0 ? durations[durations.length - 1] : 0

  const recommendedThresholdMins = durations.length >= 5
    ? Math.min(30, Math.ceil((p99ms / 60000) * 1.5))
    : 5

  return {
    slug,
    p50: Math.round(p50ms),
    p90: Math.round(p90ms),
    p99: Math.round(p99ms),
    max: Math.round(maxMs),
    count: durations.length,
    recommendedThresholdMins,
  }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  let channels: { projects?: Record<string, { slug?: string; claude?: { stuckThresholdMinutes?: number } }> } | null = null
  try { channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8')) } catch {}

  const entries = Object.values(channels?.projects ?? {}).filter((p): p is { slug: string; claude?: { stuckThresholdMinutes?: number } } => !!p.slug)
  const projects = entries.map((p) => computeTurnDurations(p.slug, mcdDir))

  return Response.json({ projects, generatedAt: new Date().toISOString() } satisfies TurnDurationsResponse)
}
