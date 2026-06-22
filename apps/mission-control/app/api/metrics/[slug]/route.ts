import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export interface ToolStat {
  name: string
  count: number
}

export interface ToolStats {
  topTools: ToolStat[]
  avgCallsPerTurn: number
  avgOutputTokensPerTurn: number
  efficiencyScore: number  // 0-100: output tokens per tool call normalized
}

export interface SlugMetrics {
  slug: string
  totalInputTokens: number
  totalOutputTokens: number
  estimatedCostUsd: number
  avgLatencyMs: number
  p95LatencyMs: number
  turnsPerDay: number
  monthlyTokens: number
  monthlyTokenBudget?: number
  dayBuckets: { date: string; tokens: number }[]
  toolStats: ToolStats
  stale: boolean
  checkedAt: string
}

// Approximate pricing per million tokens [input, output]
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

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function resolveProjectDir(slug: string, mcdDir: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  if (!fs.existsSync(p)) return null
  try { return fs.realpathSync(p) } catch { return p }
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

function isoToDate(ts: string): string {
  return ts.slice(0, 10)
}

function parseMetrics(jsonlFiles: string[], model: string): Omit<SlugMetrics, 'slug' | 'stale' | 'checkedAt' | 'monthlyTokenBudget'> {
  const [inputRate, outputRate] = pricingForModel(model)

  let totalInput = 0
  let totalOutput = 0
  let monthlyTokens = 0
  const latencies: number[] = []
  const dayMap: Map<string, number> = new Map()
  const toolCounts: Map<string, number> = new Map()
  const callsPerTurn: number[] = []

  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const currentMonth = new Date().toISOString().slice(0, 7)

  for (let d = 6; d >= 0; d--) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    dayMap.set(date, 0)
  }

  let prevAssistantTs: number | null = null
  let firstTs: number | null = null
  let lastTs: number | null = null
  let totalTurns = 0
  let totalToolCalls = 0

  for (const file of jsonlFiles) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean)

    for (const line of lines) {
      let record: Record<string, unknown>
      try { record = JSON.parse(line) } catch { continue }

      const ts = typeof record.timestamp === 'string'
        ? new Date(record.timestamp).getTime()
        : null

      if (ts) {
        if (firstTs === null || ts < firstTs) firstTs = ts
        if (lastTs === null || ts > lastTs) lastTs = ts
      }

      if (record.type === 'assistant') {
        totalTurns++
        const msg = (record as { message?: { usage?: { input_tokens?: number; output_tokens?: number }; content?: unknown[] } }).message
        const usage = msg?.usage
        const inTok = usage?.input_tokens ?? 0
        const outTok = usage?.output_tokens ?? 0
        totalInput += inTok
        totalOutput += outTok

        const recordMonth = ts ? new Date(ts).toISOString().slice(0, 7) : null
        if (recordMonth === currentMonth) monthlyTokens += inTok + outTok

        if (ts && ts >= sevenDaysAgo) {
          const date = isoToDate(new Date(ts).toISOString())
          dayMap.set(date, (dayMap.get(date) ?? 0) + inTok + outTok)
        }

        if (ts && prevAssistantTs !== null) {
          const latency = ts - prevAssistantTs
          if (latency > 0 && latency < 30 * 60 * 1000) latencies.push(latency)
        }
        if (ts) prevAssistantTs = ts

        let turnToolCalls = 0
        const content = Array.isArray(msg?.content) ? msg.content : []
        for (const block of content) {
          if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'tool_use') {
            const name = String((block as Record<string, unknown>).name ?? 'unknown')
            toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
            turnToolCalls++
            totalToolCalls++
          }
        }
        callsPerTurn.push(turnToolCalls)
      }
    }
  }

  const cost = (totalInput / 1_000_000) * inputRate + (totalOutput / 1_000_000) * outputRate

  latencies.sort((a, b) => a - b)
  const avgLatency = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0

  const spanDays = firstTs && lastTs ? Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000)) : 1
  const turnsPerDay = totalTurns / spanDays

  const dayBuckets = [...dayMap.entries()].map(([date, tokens]) => ({ date, tokens }))

  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const avgCallsPerTurn = callsPerTurn.length > 0
    ? Math.round((callsPerTurn.reduce((s, v) => s + v, 0) / callsPerTurn.length) * 10) / 10
    : 0
  const avgOutputTokensPerTurn = totalTurns > 0 ? Math.round(totalOutput / totalTurns) : 0
  const rawEfficiency = totalToolCalls > 0 ? totalOutput / totalToolCalls : 0
  const efficiencyScore = Math.min(100, Math.round((rawEfficiency / 2000) * 100))

  const toolStats: ToolStats = { topTools, avgCallsPerTurn, avgOutputTokensPerTurn, efficiencyScore }

  return {
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    estimatedCostUsd: cost,
    avgLatencyMs: Math.round(avgLatency),
    p95LatencyMs: Math.round(p95Latency),
    turnsPerDay: Math.round(turnsPerDay * 10) / 10,
    monthlyTokens,
    dayBuckets,
    toolStats,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  }

  let channels: { projects?: Record<string, { slug?: string; model?: string; monthlyTokenBudget?: number }> } | null = null
  try {
    channels = JSON.parse(fs.readFileSync(path.join(mcdDir, 'channels.json'), 'utf-8'))
  } catch {}

  const projectEntry = Object.values(channels?.projects ?? {}).find((p) => p.slug === slug)
  if (!projectEntry) {
    return Response.json({ error: 'Unknown slug' }, { status: 404 })
  }

  const projectDir = resolveProjectDir(slug, mcdDir)
  const model = projectEntry.model ?? 'claude-sonnet'
  const monthlyTokenBudget = typeof (projectEntry as Record<string, unknown>)['monthlyTokenBudget'] === 'number'
    ? (projectEntry as Record<string, unknown>)['monthlyTokenBudget'] as number
    : undefined

  const emptyToolStats: ToolStats = { topTools: [], avgCallsPerTurn: 0, avgOutputTokensPerTurn: 0, efficiencyScore: 0 }

  if (!projectDir) {
    return Response.json({
      slug, totalInputTokens: 0, totalOutputTokens: 0, estimatedCostUsd: 0,
      avgLatencyMs: 0, p95LatencyMs: 0, turnsPerDay: 0, monthlyTokens: 0,
      ...(monthlyTokenBudget !== undefined ? { monthlyTokenBudget } : {}),
      dayBuckets: [], toolStats: emptyToolStats, stale: false, checkedAt: new Date().toISOString(),
    } satisfies SlugMetrics)
  }

  const files = findAllJsonl(slug, mcdDir)
  const metrics = parseMetrics(files, model)

  return Response.json({
    slug,
    ...metrics,
    ...(monthlyTokenBudget !== undefined ? { monthlyTokenBudget } : {}),
    stale: false,
    checkedAt: new Date().toISOString(),
  } satisfies SlugMetrics)
}
