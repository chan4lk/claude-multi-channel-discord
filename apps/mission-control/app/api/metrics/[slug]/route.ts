import * as fs from 'fs'
import * as path from 'path'
import { NextRequest } from 'next/server'
import { requireSession } from '@/src/security'
import { monthlyTokens, slugToolCounts, slugTurns } from '@/src/fact-index'

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

function resolveProjectDir(slug: string, mcdDir: string): string | null {
  const p = path.join(mcdDir, 'projects', slug)
  if (!fs.existsSync(p)) return null
  try { return fs.realpathSync(p) } catch { return p }
}

function isoToDate(ts: string): string {
  return ts.slice(0, 10)
}

function computeMetrics(slug: string, model: string): Omit<SlugMetrics, 'slug' | 'stale' | 'checkedAt' | 'monthlyTokenBudget'> {
  const [inputRate, outputRate] = pricingForModel(model)

  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000
  const currentMonth = new Date().toISOString().slice(0, 7)

  const dayMap: Map<string, number> = new Map()
  for (let d = 6; d >= 0; d--) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    dayMap.set(date, 0)
  }

  // Turn series (ts-ordered) and tool counts come from the fact index instead
  // of a full transcript scan.
  const turns = slugTurns({ slug })

  let totalInput = 0
  let totalOutput = 0
  const latencies: number[] = []
  let prevTurnTs: number | null = null
  let firstTs: number | null = null
  let lastTs: number | null = null

  for (const turn of turns) {
    totalInput += turn.input_tokens
    totalOutput += turn.output_tokens

    if (firstTs === null || turn.ts_ms < firstTs) firstTs = turn.ts_ms
    if (lastTs === null || turn.ts_ms > lastTs) lastTs = turn.ts_ms

    if (turn.ts_ms >= sevenDaysAgo) {
      const date = isoToDate(new Date(turn.ts_ms).toISOString())
      dayMap.set(date, (dayMap.get(date) ?? 0) + turn.input_tokens + turn.output_tokens)
    }

    if (prevTurnTs !== null) {
      const latency = turn.ts_ms - prevTurnTs
      if (latency > 0 && latency < 30 * 60 * 1000) latencies.push(latency)
    }
    prevTurnTs = turn.ts_ms
  }

  const totalTurns = turns.length

  const toolCounts = slugToolCounts({ slug })
  const totalToolCalls = toolCounts.reduce((s, t) => s + t.count, 0)
  const topTools = [...toolCounts]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(({ tool_name, count }) => ({ name: tool_name, count }))

  const cost = (totalInput / 1_000_000) * inputRate + (totalOutput / 1_000_000) * outputRate

  latencies.sort((a, b) => a - b)
  const avgLatency = latencies.length > 0 ? latencies.reduce((s, v) => s + v, 0) / latencies.length : 0
  const p95Latency = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0

  const spanDays = firstTs && lastTs ? Math.max(1, (lastTs - firstTs) / (24 * 60 * 60 * 1000)) : 1
  const turnsPerDay = totalTurns / spanDays

  const dayBuckets = [...dayMap.entries()].map(([date, tokens]) => ({ date, tokens }))

  const avgCallsPerTurn = totalTurns > 0
    ? Math.round((totalToolCalls / totalTurns) * 10) / 10
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
    monthlyTokens: monthlyTokens({ slug, yearMonth: currentMonth }).totalTokens,
    dayBuckets,
    toolStats,
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

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

  const metrics = computeMetrics(slug, model)

  return Response.json({
    slug,
    ...metrics,
    ...(monthlyTokenBudget !== undefined ? { monthlyTokenBudget } : {}),
    stale: false,
    checkedAt: new Date().toISOString(),
  } satisfies SlugMetrics)
}
