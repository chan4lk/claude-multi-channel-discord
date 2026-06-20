import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'
import type { SlugMetrics } from './[slug]/route'

export const dynamic = 'force-dynamic'

export interface MetricsResponse {
  projects: SlugMetrics[]
  aggregate: {
    totalInputTokens: number
    totalOutputTokens: number
    estimatedCostUsd: number
    projectCount: number
  }
  checkedAt: string
}

// Inline the slug metrics logic so we don't need dynamic imports

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

const MODEL_PRICING: Record<string, [number, number]> = {
  haiku: [0.8, 4],
  sonnet: [3, 15],
  opus: [15, 75],
}

function pricingForModel(model: string): [number, number] {
  const lower = model.toLowerCase()
  if (lower.includes('haiku')) return MODEL_PRICING.haiku
  if (lower.includes('opus')) return MODEL_PRICING.opus
  return MODEL_PRICING.sonnet
}

function isoToDate(ts: string): string { return ts.slice(0, 10) }

function computeSlugMetrics(slug: string, model: string, mcdDir: string): SlugMetrics {
  const files = findAllJsonl(slug, mcdDir)
  const [inputRate, outputRate] = pricingForModel(model)
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  const dayMap = new Map<string, number>()
  for (let d = 6; d >= 0; d--) {
    dayMap.set(new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), 0)
  }

  let totalInput = 0, totalOutput = 0, totalTurns = 0
  let firstTs: number | null = null, lastTs: number | null = null
  let prevAssistantTs: number | null = null
  const latencies: number[] = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }

      const ts = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : null
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts
        if (!lastTs || ts > lastTs) lastTs = ts
      }

      if (rec.type === 'assistant') {
        totalTurns++
        const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
        const inTok = usage?.input_tokens ?? 0
        const outTok = usage?.output_tokens ?? 0
        totalInput += inTok
        totalOutput += outTok

        if (ts && ts >= sevenDaysAgo) {
          const date = isoToDate(new Date(ts).toISOString())
          dayMap.set(date, (dayMap.get(date) ?? 0) + inTok + outTok)
        }

        if (ts && prevAssistantTs !== null) {
          const lat = ts - prevAssistantTs
          if (lat > 0 && lat < 30 * 60 * 1000) latencies.push(lat)
        }
        if (ts) prevAssistantTs = ts
      }
    }
  }

  const cost = (totalInput / 1_000_000) * inputRate + (totalOutput / 1_000_000) * outputRate
  latencies.sort((a, b) => a - b)
  const avgLatency = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0
  const spanDays = firstTs && lastTs ? Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000)) : 1

  return {
    slug,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    estimatedCostUsd: cost,
    avgLatencyMs: Math.round(avgLatency),
    p95LatencyMs: Math.round(p95Latency),
    turnsPerDay: Math.round((totalTurns / spanDays) * 10) / 10,
    dayBuckets: [...dayMap.entries()].map(([date, tokens]) => ({ date, tokens })),
    stale: false,
    checkedAt: new Date().toISOString(),
  }
}

export async function GET(_req: NextRequest): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  }

  let channels: { projects?: Record<string, { slug?: string; model?: string }> } | null = null
  try {
    channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8'))
  } catch {}

  const entries = Object.values(channels?.projects ?? {}).filter((p): p is { slug: string; model?: string } => !!p.slug)
  const projects = entries.map((p) => computeSlugMetrics(p.slug, p.model ?? 'claude-sonnet', mcdDir))

  const aggregate = {
    totalInputTokens: projects.reduce((s, p) => s + p.totalInputTokens, 0),
    totalOutputTokens: projects.reduce((s, p) => s + p.totalOutputTokens, 0),
    estimatedCostUsd: projects.reduce((s, p) => s + p.estimatedCostUsd, 0),
    projectCount: projects.length,
  }

  return Response.json({ projects, aggregate, checkedAt: new Date().toISOString() } satisfies MetricsResponse)
}
