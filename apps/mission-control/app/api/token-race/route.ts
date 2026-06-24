import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

const COLORS = [
  '#22d3ee', '#a78bfa', '#f59e0b', '#34d399',
  '#fb7185', '#60a5fa', '#fbbf24', '#c084fc',
  '#4ade80', '#f472b6', '#38bdf8', '#818cf8',
]

function slugColor(slug: string): string {
  const idx = slug.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length
  return COLORS[idx]
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

export interface TokenRaceSeries {
  slug: string
  color: string
  points: Array<{ date: string; cumulative: number }>
  totalTokens: number
}

export interface TokenRaceResponse {
  series: TokenRaceSeries[]
  windowDays: number
  generatedAt: string
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: {
    usage?: {
      output_tokens?: number
    }
  }
}

function computeSeriesForSlug(
  slug: string,
  mcdDir: string,
  windowDays: number,
): TokenRaceSeries {
  const files = findAllJsonl(slug, mcdDir)
  const now = Date.now()
  const cutoffMs = now - windowDays * 24 * 60 * 60 * 1000

  const dayMap = new Map<string, number>()

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue

      const tsMs = typeof rec.timestamp === 'string' ? new Date(rec.timestamp).getTime() : NaN
      if (isNaN(tsMs)) continue
      if (tsMs < cutoffMs) continue

      const outTok = rec.message?.usage?.output_tokens ?? 0
      const date = new Date(tsMs).toISOString().slice(0, 10)
      dayMap.set(date, (dayMap.get(date) ?? 0) + outTok)
    }
  }

  // Sort dates ascending, build cumulative series
  const sortedDates = [...dayMap.keys()].sort()
  let cumulative = 0
  const points: Array<{ date: string; cumulative: number }> = []
  for (const date of sortedDates) {
    cumulative += dayMap.get(date) ?? 0
    points.push({ date, cumulative })
  }

  return {
    slug,
    color: slugColor(slug),
    points,
    totalTokens: cumulative,
  }
}

export async function GET(request: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({
      series: [],
      windowDays: 30,
      generatedAt: new Date().toISOString(),
    } satisfies TokenRaceResponse)
  }

  const url = new URL(request.url)
  const rawWindow = parseInt(url.searchParams.get('window') ?? '30', 10)
  const windowDays = isNaN(rawWindow) ? 30 : Math.min(Math.max(rawWindow, 1), 90)

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const series: TokenRaceSeries[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue
      const s = computeSeriesForSlug(slug, mcdDir, windowDays)
      series.push(s)
    }
  }

  // Sort by totalTokens descending
  series.sort((a, b) => b.totalTokens - a.totalTokens)

  return Response.json({
    series,
    windowDays,
    generatedAt: new Date().toISOString(),
  } satisfies TokenRaceResponse)
}
