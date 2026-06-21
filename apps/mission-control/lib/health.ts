import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface HealthScore {
  slug: string
  score: number
  recency: number
  stallRate: number
  efficiency: number
  freshness: number
  insufficientData: boolean
  computedAt: string
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

function computeRecencyScore(slug: string, mcdDir: string): number {
  const files = findAllJsonl(slug, mcdDir)
  if (files.length === 0) return 0

  let latestMtime = 0
  for (const f of files) {
    try {
      const s = fs.statSync(f)
      if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs
    } catch { /* skip */ }
  }
  if (latestMtime === 0) return 0

  const hoursSince = (Date.now() - latestMtime) / (1000 * 60 * 60)
  // Exponential decay: 100 at 0h, ~37 at 24h, ~14 at 48h, ~5 at 72h
  return Math.round(100 * Math.exp(-hoursSince / 24))
}

function computeStallRateScore(files: string[]): { score: number; sessionCount: number } {
  let totalSessions = 0
  let stalledSessions = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    const lines = raw.trim().split('\n').filter(Boolean)
    if (lines.length === 0) continue

    totalSessions++
    // Check last few lines for stall signals
    const tail = lines.slice(-20)
    const hasStallSignal = tail.some((l) => {
      try {
        const rec = JSON.parse(l) as Record<string, unknown>
        const content = JSON.stringify(rec)
        return content.includes('stuck') || content.includes('stalled') ||
          content.includes('stop_reason') && content.includes('timeout')
      } catch { return false }
    })
    if (hasStallSignal) stalledSessions++
  }

  if (totalSessions === 0) return { score: 100, sessionCount: 0 }
  const stallRate = stalledSessions / totalSessions
  return { score: Math.round((1 - stallRate) * 100), sessionCount: totalSessions }
}

function computeEfficiencyScore(files: string[], fleetMedianTpt: number): number {
  let totalTokens = 0
  let totalTurns = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: Record<string, unknown>
      try { rec = JSON.parse(line) } catch { continue }
      if (rec.type !== 'assistant') continue
      totalTurns++
      const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
      totalTokens += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
    }
  }

  if (totalTurns === 0) return 50
  const tpt = totalTokens / totalTurns
  const median = fleetMedianTpt > 0 ? fleetMedianTpt : tpt

  // Relative to median: 1x = 80, 2x = 60, 0.5x = 100, 3x = 40
  const ratio = tpt / median
  const score = Math.round(100 / (1 + ratio))
  return Math.max(0, Math.min(100, score))
}

function computeFreshnessScore(slug: string, mcdDir: string): number {
  const memDir = path.join(mcdDir, 'projects', slug, 'memory')
  let latestMtime = 0
  try {
    const files = fs.readdirSync(memDir)
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      try {
        const s = fs.statSync(path.join(memDir, f))
        if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs
      } catch { /* skip */ }
    }
  } catch { return 50 } // no memory dir → neutral

  if (latestMtime === 0) return 30
  const daysSince = (Date.now() - latestMtime) / (1000 * 60 * 60 * 24)
  // 100 if written today, ~70 at 7 days, ~37 at 30 days
  return Math.round(100 * Math.exp(-daysSince / 20))
}

export function computeHealth(slug: string, mcdDir: string, fleetMedianTpt: number = 0): HealthScore {
  const files = findAllJsonl(slug, mcdDir)

  const recency = computeRecencyScore(slug, mcdDir)
  const { score: stallRate, sessionCount } = computeStallRateScore(files)
  const efficiency = computeEfficiencyScore(files, fleetMedianTpt)
  const freshness = computeFreshnessScore(slug, mcdDir)

  const insufficientData = sessionCount < 2

  const score = insufficientData
    ? -1
    : Math.round(recency * 0.4 + stallRate * 0.3 + efficiency * 0.2 + freshness * 0.1)

  return {
    slug,
    score,
    recency,
    stallRate,
    efficiency,
    freshness,
    insufficientData,
    computedAt: new Date().toISOString(),
  }
}
