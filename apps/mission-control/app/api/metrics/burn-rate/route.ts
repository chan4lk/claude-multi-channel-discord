import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
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

export interface BurnRateProject {
  slug: string
  model: string
  monthTokens: number          // tokens used this calendar month so far
  dailyRate: number            // avg tokens/day over last 7 days
  projectedMonthEnd: number    // monthTokens + dailyRate * daysRemaining
  daysUntilExhausted: number | null  // null when no budget or rate is 0
  budget: number               // monthlyTokenBudget (0 = unset)
  budgetPct: number | null     // monthTokens / budget * 100
  spark: number[]              // last 7 days daily token totals, oldest→newest
}

export interface BurnRateResponse {
  projects: BurnRateProject[]
  fleet: {
    monthTokens: number
    dailyRate: number
    projectedMonthEnd: number
    spark: number[]
  }
  daysRemaining: number
  generatedAt: string
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

function computeBurn(slug: string, mcdDir: string, now: number): { monthTokens: number; dailyRate: number; spark: number[] } {
  const files = findAllJsonl(slug, mcdDir)

  const monthStart = new Date(now)
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthStartMs = monthStart.getTime()

  // last-7-days daily buckets, oldest→newest (index 6 = today)
  const spark = [0, 0, 0, 0, 0, 0, 0]
  const dayKeys: string[] = []
  for (let d = 6; d >= 0; d--) {
    dayKeys.push(new Date(now - d * 86400_000).toISOString().slice(0, 10))
  }
  const sparkIndex = new Map(dayKeys.map((k, i) => [k, i]))

  let monthTokens = 0
  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue
      const tsMs = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs)) continue
      const usage = rec.message?.usage ?? {}
      const tok = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      if (tok === 0) continue

      if (tsMs >= monthStartMs) monthTokens += tok

      const dayKey = new Date(tsMs).toISOString().slice(0, 10)
      const idx = sparkIndex.get(dayKey)
      if (idx != null) spark[idx] += tok
    }
  }

  const last7Total = spark.reduce((s, v) => s + v, 0)
  const dailyRate = Math.round(last7Total / 7)
  return { monthTokens, dailyRate, spark }
}

export async function GET(): Promise<Response> {
  const now = Date.now()
  const nowDate = new Date(now)
  const daysInMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0)).getUTCDate()
  const daysRemaining = daysInMonth - nowDate.getUTCDate()

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({
      projects: [], fleet: { monthTokens: 0, dailyRate: 0, projectedMonthEnd: 0, spark: [0, 0, 0, 0, 0, 0, 0] },
      daysRemaining, generatedAt: new Date().toISOString(),
    } satisfies BurnRateResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string; model?: string; monthlyTokenBudget?: number }>
    defaults?: { model?: string; monthlyTokenBudget?: number }
  }>(path.join(mcdDir, 'channels.json'))

  const projects: BurnRateProject[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue
      const model = proj.model ?? channels.defaults?.model ?? 'claude-sonnet'
      const budget = proj.monthlyTokenBudget ?? channels.defaults?.monthlyTokenBudget ?? 0
      const { monthTokens, dailyRate, spark } = computeBurn(slug, mcdDir, now)
      const projectedMonthEnd = monthTokens + dailyRate * daysRemaining
      const daysUntilExhausted = budget > 0 && dailyRate > 0
        ? Math.max(0, Math.round((budget - monthTokens) / dailyRate))
        : null
      const budgetPct = budget > 0 ? Math.round((monthTokens / budget) * 1000) / 10 : null
      projects.push({ slug, model, monthTokens, dailyRate, projectedMonthEnd, daysUntilExhausted, budget, budgetPct, spark })
    }
  }

  // Highest burn risk first: budget-exhausting projects, then by daily rate.
  projects.sort((a, b) => {
    const ax = a.daysUntilExhausted ?? Infinity
    const bx = b.daysUntilExhausted ?? Infinity
    if (ax !== bx) return ax - bx
    return b.dailyRate - a.dailyRate
  })

  const fleetSpark = [0, 0, 0, 0, 0, 0, 0]
  for (const p of projects) for (let i = 0; i < 7; i++) fleetSpark[i] += p.spark[i]
  const fleetMonth = projects.reduce((s, p) => s + p.monthTokens, 0)
  const fleetRate = projects.reduce((s, p) => s + p.dailyRate, 0)

  return Response.json({
    projects,
    fleet: { monthTokens: fleetMonth, dailyRate: fleetRate, projectedMonthEnd: fleetMonth + fleetRate * daysRemaining, spark: fleetSpark },
    daysRemaining,
    generatedAt: new Date().toISOString(),
  } satisfies BurnRateResponse)
}
