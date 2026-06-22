import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

// Pricing per million tokens [input, output] in USD
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

export interface DayCost {
  date: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  costUsd: number
}

export interface ProjectCost {
  slug: string
  model: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheTokens: number
  totalCostUsd: number
  cacheHitPct: number
  trend7d: number // % change vs prior 7 days
  days: DayCost[] // last 30 days
}

export interface CostResponse {
  projects: ProjectCost[]
  totalCostUsd: number
  generatedAt: string
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

function computeCostData(slug: string, mcdDir: string, model: string): Omit<ProjectCost, 'slug' | 'model'> {
  const [inputRate, outputRate] = pricingForModel(model)
  const files = findAllJsonl(slug, mcdDir)

  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
  const cutoff30 = now - thirtyDaysMs

  const dayMap = new Map<string, DayCost>()
  // Pre-fill last 30 days
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now - d * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    dayMap.set(date, { date, inputTokens: 0, outputTokens: 0, cacheTokens: 0, costUsd: 0 })
  }

  let totalInput = 0
  let totalOutput = 0
  let totalCache = 0
  let recent7Input = 0
  let recent7Output = 0
  let prior7Input = 0
  let prior7Output = 0

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue

      const tsMs = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs)) continue
      if (tsMs < cutoff30) continue

      const usage = rec.message?.usage ?? {}
      const inTok = usage.input_tokens ?? 0
      const outTok = usage.output_tokens ?? 0
      const cacheRead = usage.cache_read_input_tokens ?? 0
      const cacheCreate = usage.cache_creation_input_tokens ?? 0
      const cacheTok = cacheRead + cacheCreate

      totalInput += inTok
      totalOutput += outTok
      totalCache += cacheTok

      const date = new Date(tsMs).toISOString().slice(0, 10)
      const dayCost = (inTok / 1_000_000) * inputRate + (outTok / 1_000_000) * outputRate
      const entry = dayMap.get(date)
      if (entry) {
        entry.inputTokens += inTok
        entry.outputTokens += outTok
        entry.cacheTokens += cacheTok
        entry.costUsd += dayCost
      }

      const age = now - tsMs
      if (age <= sevenDaysMs) {
        recent7Input += inTok
        recent7Output += outTok
      } else if (age <= 2 * sevenDaysMs) {
        prior7Input += inTok
        prior7Output += outTok
      }
    }
  }

  const totalCostUsd = (totalInput / 1_000_000) * inputRate + (totalOutput / 1_000_000) * outputRate
  const cacheHitPct = (totalInput + totalCache) > 0
    ? Math.round((totalCache / (totalInput + totalCache)) * 1000) / 10
    : 0

  const recent7Cost = (recent7Input / 1_000_000) * inputRate + (recent7Output / 1_000_000) * outputRate
  const prior7Cost = (prior7Input / 1_000_000) * inputRate + (prior7Output / 1_000_000) * outputRate
  const trend7d = prior7Cost > 0
    ? Math.round(((recent7Cost - prior7Cost) / prior7Cost) * 1000) / 10
    : 0

  const days = [...dayMap.values()]

  return { totalInputTokens: totalInput, totalOutputTokens: totalOutput, totalCacheTokens: totalCache, totalCostUsd, cacheHitPct, trend7d, days }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], totalCostUsd: 0, generatedAt: new Date().toISOString() } satisfies CostResponse)
  }

  const channels = readJson<{
    projects?: Record<string, { slug?: string; model?: string }>
    defaults?: { model?: string }
  }>(path.join(mcdDir, 'channels.json'))

  const projects: ProjectCost[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue
      const model = proj.model ?? channels.defaults?.model ?? 'claude-sonnet'
      const data = computeCostData(slug, mcdDir, model)
      projects.push({ slug, model, ...data })
    }
  }

  projects.sort((a, b) => b.totalCostUsd - a.totalCostUsd)
  const totalCostUsd = projects.reduce((s, p) => s + p.totalCostUsd, 0)

  return Response.json({ projects, totalCostUsd, generatedAt: new Date().toISOString() } satisfies CostResponse)
}
