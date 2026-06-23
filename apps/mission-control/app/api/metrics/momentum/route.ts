import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const DAYS = 14

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

export interface MomentumSeries {
  slug: string
  values: number[]   // daily token totals over last DAYS days, oldest→newest
  total: number      // sum across the window
}

export interface MomentumResponse {
  days: string[]            // ISO YYYY-MM-DD, oldest→newest, length DAYS
  series: MomentumSeries[]  // sorted by total desc
  generatedAt: string
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
}

function computeDaily(slug: string, mcdDir: string, dayIndex: Map<string, number>): number[] {
  const files = findAllJsonl(slug, mcdDir)
  const values = new Array<number>(DAYS).fill(0)
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
      const dayKey = new Date(tsMs).toISOString().slice(0, 10)
      const idx = dayIndex.get(dayKey)
      if (idx != null) values[idx] += tok
    }
  }
  return values
}

export async function GET(): Promise<Response> {
  const now = Date.now()

  // last DAYS days, oldest→newest (index DAYS-1 = today)
  const days: string[] = []
  for (let d = DAYS - 1; d >= 0; d--) {
    days.push(new Date(now - d * 86400_000).toISOString().slice(0, 10))
  }
  const dayIndex = new Map(days.map((k, i) => [k, i]))

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ days, series: [], generatedAt: new Date().toISOString() } satisfies MomentumResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const series: MomentumSeries[] = []
  for (const proj of Object.values(channels?.projects ?? {})) {
    const slug = proj.slug
    if (!slug) continue
    const values = computeDaily(slug, mcdDir, dayIndex)
    const total = values.reduce((s, v) => s + v, 0)
    if (total === 0) continue
    series.push({ slug, values, total })
  }

  series.sort((a, b) => b.total - a.total)

  return Response.json({ days, series, generatedAt: new Date().toISOString() } satisfies MomentumResponse)
}
