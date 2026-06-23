import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface HeatmapCell {
  slug: string
  date: string // YYYY-MM-DD
  rate: number // 0-1 keyword hit rate
  matchingTurns: string[] // up to 5 excerpts
}

export interface GoalHeatmapResponse {
  slugs: string[]
  dates: string[] // last 30 days, oldest first
  cells: HeatmapCell[]
  fleetAvgByDate: Record<string, number> // date -> fleet avg rate
  generatedAt: string
}

let cache: { data: GoalHeatmapResponse; ts: number } | null = null
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function findJsonlFiles(slug: string, mcdDir: string): string[] {
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

function parseGoalText(raw: string): string {
  const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
  return (match ? match[1] : raw).trim()
}

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join(' ')
  }
  return ''
}

function last30Days(): string[] {
  const days: string[] = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

interface TurnEntry {
  date: string
  text: string
  hasKeyword: boolean
}

function scanTranscripts(slug: string, mcdDir: string, keywords: string[]): TurnEntry[] {
  const cutoff = Date.now() - 30 * 24 * 3_600_000
  const files = findJsonlFiles(slug, mcdDir)
  const turns: TurnEntry[] = []

  for (const file of files) {
    try { if (fs.statSync(file).mtimeMs < cutoff) continue } catch { continue }
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: { role?: string; content?: unknown; timestamp?: string } | null = null
      try { parsed = JSON.parse(line) } catch { continue }
      if (!parsed || parsed.role !== 'assistant' || !parsed.timestamp) continue

      const msTs = new Date(parsed.timestamp).getTime()
      if (msTs < cutoff) continue

      const date = parsed.timestamp.slice(0, 10)
      const text = extractText(parsed.content)
      if (!text) continue
      const words = tokenize(text)
      const hasKeyword = keywords.some((kw) => words.includes(kw))
      turns.push({ date, text, hasKeyword })
    }
  }
  return turns
}

export async function GET(): Promise<Response> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return Response.json(cache.data)
  }

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(channelsPath)

  const dates = last30Days()

  // Gather active-goal slugs
  interface GoalEntry { slug: string; keywords: string[] }
  const goalEntries: GoalEntry[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug || slug === 'master') continue
      const goalFile = path.join(mcdDir, 'projects', slug, '.goal')
      if (!fs.existsSync(goalFile)) continue
      let raw = ''
      try { raw = fs.readFileSync(goalFile, 'utf-8') } catch { continue }
      const goalText = parseGoalText(raw)
      if (!goalText) continue
      const keywords = tokenize(goalText)
      if (keywords.length === 0) continue
      goalEntries.push({ slug, keywords })
    }
  }

  const cells: HeatmapCell[] = []
  const fleetSumByDate: Record<string, number> = {}
  const fleetCountByDate: Record<string, number> = {}
  for (const d of dates) { fleetSumByDate[d] = 0; fleetCountByDate[d] = 0 }

  for (const { slug, keywords } of goalEntries) {
    const turns = scanTranscripts(slug, mcdDir, keywords)

    // Group by date
    const byDate: Record<string, TurnEntry[]> = {}
    for (const t of turns) {
      if (!byDate[t.date]) byDate[t.date] = []
      byDate[t.date].push(t)
    }

    for (const date of dates) {
      const dayTurns = byDate[date] ?? []
      const total = dayTurns.length
      const matched = dayTurns.filter((t) => t.hasKeyword)
      const rate = total > 0 ? matched.length / total : 0
      const excerpts = matched.slice(0, 5).map((t) => t.text.slice(0, 200))

      cells.push({ slug, date, rate, matchingTurns: excerpts })
      fleetSumByDate[date] += rate
      fleetCountByDate[date] += 1
    }
  }

  const fleetAvgByDate: Record<string, number> = {}
  for (const d of dates) {
    const c = fleetCountByDate[d]
    fleetAvgByDate[d] = c > 0 ? fleetSumByDate[d] / c : 0
  }

  const data: GoalHeatmapResponse = {
    slugs: goalEntries.map((e) => e.slug),
    dates,
    cells,
    fleetAvgByDate,
    generatedAt: new Date().toISOString(),
  }

  cache = { data, ts: Date.now() }
  return Response.json(data)
}
