import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
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
      .sort()
  } catch { return [] }
}

export type AnomalyMetric = 'interTurnGapMins' | 'toolCallsPerTurn' | 'outputTokensPerTurn'

export interface AnomalyEntry {
  slug: string
  metric: AnomalyMetric
  metricLabel: string
  currentValue: number
  baselineMean: number
  baselineStd: number
  zScore: number
  severity: 'warn' | 'critical'
  sparkline: number[]
}

export interface AnomaliesResponse {
  anomalies: AnomalyEntry[]
  checkedAt: string
  projectsChecked: number
}

interface TurnStat {
  tsMs: number
  outputTokens: number
  toolCallCount: number
  interTurnGapMins: number
}

function sampleStd(values: number[], mean: number): number {
  if (values.length < 2) return 0
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function computeTurnStats(slug: string, mcdDir: string): TurnStat[] {
  const files = findAllJsonl(slug, mcdDir)
  type Rec = { tsMs: number; outputTokens: number; toolCallCount: number }
  const records: Rec[] = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: { type: string; timestamp?: string; message?: { usage?: { output_tokens?: number }; content?: Array<{ type: string }> } }
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      const tsMs = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs)) continue
      const outputTokens = rec.message?.usage?.output_tokens ?? 0
      const toolCallCount = (rec.message?.content ?? []).filter((b) => b.type === 'tool_use').length
      records.push({ tsMs, outputTokens, toolCallCount })
    }
  }

  records.sort((a, b) => a.tsMs - b.tsMs)

  return records.map((r, i) => ({
    tsMs: r.tsMs,
    outputTokens: r.outputTokens,
    toolCallCount: r.toolCallCount,
    interTurnGapMins: i > 0 ? (r.tsMs - records[i - 1].tsMs) / 60000 : 0,
  }))
}

function analyzeProject(slug: string, mcdDir: string): AnomalyEntry[] {
  const allTurns = computeTurnStats(slug, mcdDir)
  const now = Date.now()
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const window = allTurns.filter((t) => t.tsMs > now - sevenDaysMs)
  if (window.length < 7) return []

  const recentTurns = window.slice(-3)
  const baselineTurns = window.slice(0, -3)
  if (baselineTurns.length < 4) return []

  const metrics: Array<{ key: AnomalyMetric; label: string; get: (t: TurnStat) => number }> = [
    { key: 'interTurnGapMins', label: 'inter-turn gap (min)', get: (t) => t.interTurnGapMins },
    { key: 'toolCallsPerTurn', label: 'tool calls/turn', get: (t) => t.toolCallCount },
    { key: 'outputTokensPerTurn', label: 'output tokens/turn', get: (t) => t.outputTokens },
  ]

  const sparklineSource = window.slice(-20)
  const entries: AnomalyEntry[] = []

  for (const m of metrics) {
    const baselineVals = baselineTurns.map(m.get)
    const mean = baselineVals.reduce((s, v) => s + v, 0) / baselineVals.length
    const std = sampleStd(baselineVals, mean)
    if (std < 0.01) continue

    const recentMean = recentTurns.reduce((s, t) => s + m.get(t), 0) / recentTurns.length
    const zScore = Math.abs((recentMean - mean) / std)
    if (zScore < 2) continue

    entries.push({
      slug,
      metric: m.key,
      metricLabel: m.label,
      currentValue: Math.round(recentMean * 100) / 100,
      baselineMean: Math.round(mean * 100) / 100,
      baselineStd: Math.round(std * 100) / 100,
      zScore: Math.round(zScore * 100) / 100,
      severity: zScore >= 3 ? 'critical' : 'warn',
      sparkline: sparklineSource.map(m.get),
    })
  }

  return entries
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ anomalies: [], checkedAt: new Date().toISOString(), projectsChecked: 0 } satisfies AnomaliesResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const anomalies: AnomalyEntry[] = []
  let projectsChecked = 0

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (!proj.slug) continue
      projectsChecked++
      anomalies.push(...analyzeProject(proj.slug, mcdDir))
    }
  }

  anomalies.sort((a, b) => b.zScore - a.zScore)

  return Response.json({ anomalies, checkedAt: new Date().toISOString(), projectsChecked } satisfies AnomaliesResponse)
}
