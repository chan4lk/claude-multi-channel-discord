import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface DailySpend {
  date: string
  tokens: number
}

export interface ProjectForecast {
  slug: string
  monthlyBudget: number
  monthlyUsed: number
  burnRatePerDay: number
  projectedMonthlyTotal: number
  daysToExhaustion: number | null
  regressionR2: number
  daily14d: DailySpend[]
}

export interface BudgetForecastResponse {
  projects: ProjectForecast[]
  generatedAt: string
}

interface JsonlLine {
  timestamp?: string
  type?: string
  message?: {
    role?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
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

function getDailySpend(slug: string, mcdDir: string, days = 14): DailySpend[] {
  const cutoffMs = Date.now() - days * 24 * 3_600_000
  const byDay = new Map<string, number>()

  for (const file of findJsonlFiles(slug, mcdDir)) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }

    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (line.type !== 'assistant' && line.message?.role !== 'assistant') continue
      if (!line.timestamp) continue
      const ts = Date.parse(line.timestamp)
      if (isNaN(ts) || ts < cutoffMs) continue

      const u = line.message?.usage
      if (!u) continue
      const total =
        (u.input_tokens ?? 0) +
        (u.output_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0)
      if (total === 0) continue

      const day = line.timestamp.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + total)
    }
  }

  // Fill in all 14 days (zero for days with no spend)
  const result: DailySpend[] = []
  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 3_600_000).toISOString().slice(0, 10)
    result.push({ date, tokens: byDay.get(date) ?? 0 })
  }
  return result
}

function getMonthlyUsed(slug: string, mcdDir: string): number {
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let total = 0

  for (const file of findJsonlFiles(slug, mcdDir)) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (!line.timestamp?.startsWith(ym)) continue
      if (line.type !== 'assistant' && line.message?.role !== 'assistant') continue
      const u = line.message?.usage
      if (!u) continue
      total += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
    }
  }
  return total
}

function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 }

  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const meanY = sumY / n

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: meanY, r2: 0 }

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R²
  const ssTot = points.reduce((s, p) => s + Math.pow(p.y - meanY, 2), 0)
  const ssRes = points.reduce((s, p) => s + Math.pow(p.y - (slope * p.x + intercept), 2), 0)
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot

  return { slope, intercept, r2: Math.max(0, Math.round(r2 * 100) / 100) }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{
    projects?: Record<string, { slug?: string; monthlyTokenBudget?: number }>
    defaults?: { monthlyTokenBudget?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const projectEntries: Array<{ slug: string; monthlyBudget: number }> = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (!proj.slug) continue
      const budget = proj.monthlyTokenBudget ?? channels.defaults?.monthlyTokenBudget ?? 0
      if (budget > 0) {
        projectEntries.push({ slug: proj.slug, monthlyBudget: budget })
      }
    }
  }

  const now = new Date()
  // Days remaining in this month
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysLeft = daysInMonth - dayOfMonth

  const projects: ProjectForecast[] = []

  for (const { slug, monthlyBudget } of projectEntries) {
    const daily14d = getDailySpend(slug, mcdDir, 14)
    const monthlyUsed = getMonthlyUsed(slug, mcdDir)

    // Linear regression: x = day index (0=oldest), y = tokens
    const points = daily14d
      .map((d, i) => ({ x: i, y: d.tokens }))
      .filter(p => p.y > 0)

    const { slope, intercept, r2 } = linearRegression(points)
    const burnRatePerDay = Math.max(0, slope + intercept / 14)

    // Project remaining days: cumulative = monthlyUsed + burnRatePerDay × daysLeft
    const projectedMonthlyTotal = monthlyUsed + burnRatePerDay * daysLeft

    // Days to exhaustion: when monthlyUsed + burnRatePerDay × d = monthlyBudget
    let daysToExhaustion: number | null = null
    if (burnRatePerDay > 0 && monthlyUsed < monthlyBudget) {
      const remaining = monthlyBudget - monthlyUsed
      const days = Math.ceil(remaining / burnRatePerDay)
      if (days >= 0 && days <= 365) daysToExhaustion = days
    }

    projects.push({
      slug,
      monthlyBudget,
      monthlyUsed,
      burnRatePerDay: Math.round(burnRatePerDay),
      projectedMonthlyTotal: Math.round(projectedMonthlyTotal),
      daysToExhaustion,
      regressionR2: r2,
      daily14d,
    })
  }

  // Sort: projects with daysToExhaustion first (asc), then nulls
  projects.sort((a, b) => {
    if (a.daysToExhaustion === null && b.daysToExhaustion === null) return 0
    if (a.daysToExhaustion === null) return 1
    if (b.daysToExhaustion === null) return -1
    return a.daysToExhaustion - b.daysToExhaustion
  })

  return Response.json({
    projects,
    generatedAt: new Date().toISOString(),
  } satisfies BudgetForecastResponse)
}
