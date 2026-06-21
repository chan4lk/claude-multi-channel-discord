import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface WeeklyProjectStats {
  slug: string
  turns: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  stalls: number
  toolCalls: number
  avgTurnMs: number
  prCount: number
  memoriesWritten: number
  impactScore: number
}

export interface FleetWeeklyStats {
  totalTurns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCostUsd: number
  totalStalls: number
  totalToolCalls: number
  totalPrs: number
  projectCount: number
  topByActivity: string
  topByEfficiency: string
}

export interface WeeklyReportResponse {
  generatedAt: string
  weekStart: string
  weekEnd: string
  projects: WeeklyProjectStats[]
  fleet: FleetWeeklyStats
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
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

function analyzeJsonl(jsonlFiles: string[], weekStartMs: number, weekEndMs: number): {
  turns: number
  inputTokens: number
  outputTokens: number
  stalls: number
  toolCalls: number
  totalLatencyMs: number
  model: string
} {
  let turns = 0
  let inputTokens = 0
  let outputTokens = 0
  let stalls = 0
  let toolCalls = 0
  let totalLatencyMs = 0
  let model = 'sonnet'
  let prevAssistantTs: number | null = null

  for (const file of jsonlFiles) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }

      const ts = rec.timestamp ? new Date(rec.timestamp as string).getTime() : 0
      if (ts < weekStartMs || ts > weekEndMs) continue

      if (rec.type === 'assistant') {
        turns++
        if (typeof rec.costUSD === 'number' || rec.usage) {
          const usage = rec.usage as { input_tokens?: number; output_tokens?: number } | undefined
          if (usage?.input_tokens) inputTokens += usage.input_tokens
          if (usage?.output_tokens) outputTokens += usage.output_tokens
        }
        if (prevAssistantTs !== null) {
          totalLatencyMs += ts - prevAssistantTs
        }
        prevAssistantTs = ts

        const content = (rec.message as { content?: unknown[] } | undefined)?.content ?? []
        for (const block of content as Array<{ type?: string }>) {
          if (block.type === 'tool_use') toolCalls++
        }

        const stopReason = (rec.message as { stop_reason?: string } | undefined)?.stop_reason
        if (stopReason === 'max_tokens' || stopReason === 'end_turn') {
          // check for stall pattern — no tool calls in content
          const hasTools = (content as Array<{ type?: string }>).some((b) => b.type === 'tool_use')
          if (!hasTools && turns > 1) stalls++
        }

        const m = (rec.message as { model?: string } | undefined)?.model
        if (m) model = m
      }
    }
  }
  return { turns, inputTokens, outputTokens, stalls, toolCalls, totalLatencyMs, model }
}

function countPrs(realDir: string, weekStartIso: string): number {
  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    const out = execSync(
      `git -C ${JSON.stringify(realDir)} log --oneline --after=${JSON.stringify(weekStartIso)} --merges 2>/dev/null`,
      { encoding: 'utf-8', timeout: 6000 }
    ).trim()
    return out ? out.split('\n').length : 0
  } catch { return 0 }
}

function countRecentMemories(realDir: string, weekStartMs: number): number {
  let count = 0
  const memDirs = [
    path.join(realDir, '.claude', 'memory'),
    path.join(realDir, 'memory'),
  ]
  for (const dir of memDirs) {
    try {
      const files = fs.readdirSync(dir)
      for (const f of files) {
        if (!f.endsWith('.md')) continue
        const stat = fs.statSync(path.join(dir, f))
        if (stat.mtimeMs >= weekStartMs) count++
      }
    } catch {}
  }
  return count
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const nowMs = Date.now()
  const weekStartMs = nowMs - 7 * 24 * 60 * 60 * 1000
  const weekStart = isoDate(weekStartMs)
  const weekEnd = isoDate(nowMs)

  const projectsDir = path.join(mcdDir, 'projects')
  let slugs: string[] = []
  try {
    slugs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => d.name)
      .filter((s) => s !== '.archive')
  } catch {}

  const projects: WeeklyProjectStats[] = []

  for (const slug of slugs) {
    const projectPath = path.join(projectsDir, slug)
    let realDir = projectPath
    try { realDir = fs.realpathSync(projectPath) } catch {}

    const encoded = encodeProjectCwd(realDir)
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)

    let jsonlFiles: string[] = []
    try {
      jsonlFiles = fs.readdirSync(transcriptDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(transcriptDir, f))
        .filter((f) => {
          const stat = fs.statSync(f)
          return stat.mtimeMs >= weekStartMs
        })
    } catch {}

    const { turns, inputTokens, outputTokens, stalls, toolCalls, totalLatencyMs, model } =
      analyzeJsonl(jsonlFiles, weekStartMs, nowMs)

    if (turns === 0 && inputTokens === 0) continue

    const [inputRate, outputRate] = pricingForModel(model)
    const estimatedCostUsd =
      (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate

    const prCount = countPrs(realDir, weekStart)
    const memoriesWritten = countRecentMemories(realDir, weekStartMs)
    const avgTurnMs = turns > 1 ? Math.round(totalLatencyMs / (turns - 1)) : 0
    const impactScore = turns * 2 + prCount * 20 + toolCalls + memoriesWritten * 5

    projects.push({
      slug,
      turns,
      inputTokens,
      outputTokens,
      estimatedCostUsd,
      stalls,
      toolCalls,
      avgTurnMs,
      prCount,
      memoriesWritten,
      impactScore,
    })
  }

  projects.sort((a, b) => b.impactScore - a.impactScore)

  const fleet: FleetWeeklyStats = {
    totalTurns: projects.reduce((s, p) => s + p.turns, 0),
    totalInputTokens: projects.reduce((s, p) => s + p.inputTokens, 0),
    totalOutputTokens: projects.reduce((s, p) => s + p.outputTokens, 0),
    totalEstimatedCostUsd: projects.reduce((s, p) => s + p.estimatedCostUsd, 0),
    totalStalls: projects.reduce((s, p) => s + p.stalls, 0),
    totalToolCalls: projects.reduce((s, p) => s + p.toolCalls, 0),
    totalPrs: projects.reduce((s, p) => s + p.prCount, 0),
    projectCount: projects.length,
    topByActivity: projects[0]?.slug ?? '—',
    topByEfficiency: projects
      .filter((p) => p.turns > 0)
      .sort((a, b) => (a.estimatedCostUsd / (a.turns || 1)) - (b.estimatedCostUsd / (b.turns || 1)))[0]?.slug ?? '—',
  }

  return Response.json({
    generatedAt: new Date().toISOString(),
    weekStart,
    weekEnd,
    projects,
    fleet,
  } satisfies WeeklyReportResponse)
}
