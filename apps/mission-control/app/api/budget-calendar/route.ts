import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface CalendarDay {
  date: string
  totalTokens: number
  byProject: Record<string, number>
}

export interface BudgetCalendarResponse {
  days: CalendarDay[]
  slugs: string[]
  months: number
  generatedAt: string
}

interface JsonlLine {
  timestamp?: string
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

function toDateStr(iso: string): string {
  return iso.slice(0, 10)
}

function parseTokensByDay(slug: string, mcdDir: string, cutoffMs: number): Map<string, number> {
  const byDay = new Map<string, number>()
  for (const file of findJsonlFiles(slug, mcdDir)) {
    let lines: string[]
    try { lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean) } catch { continue }
    for (const raw of lines) {
      let line: JsonlLine
      try { line = JSON.parse(raw) } catch { continue }
      if (!line.timestamp || line.message?.role !== 'assistant') continue
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
      const day = toDateStr(line.timestamp)
      byDay.set(day, (byDay.get(day) ?? 0) + total)
    }
  }
  return byDay
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const months = Math.max(1, Math.min(6, parseInt(url.searchParams.get('months') ?? '3', 10)))

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const cutoffMs = Date.now() - months * 30 * 24 * 3_600_000

  // Aggregate per-day per-project
  const dailyByProject = new Map<string, Map<string, number>>()
  for (const slug of slugs) {
    const byDay = parseTokensByDay(slug, mcdDir, cutoffMs)
    for (const [day, tokens] of byDay) {
      if (!dailyByProject.has(day)) dailyByProject.set(day, new Map())
      dailyByProject.get(day)!.set(slug, (dailyByProject.get(day)!.get(slug) ?? 0) + tokens)
    }
  }

  // Build sorted day list
  const days: CalendarDay[] = [...dailyByProject.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, projMap]) => {
      const byProject: Record<string, number> = {}
      let total = 0
      for (const [slug, tokens] of projMap) {
        byProject[slug] = tokens
        total += tokens
      }
      return { date, totalTokens: total, byProject }
    })

  // Find slugs that had any activity
  const activeSlugs = new Set<string>()
  for (const d of days) {
    for (const slug of Object.keys(d.byProject)) activeSlugs.add(slug)
  }

  return Response.json({
    days,
    slugs: [...activeSlugs].sort(),
    months,
    generatedAt: new Date().toISOString(),
  } satisfies BudgetCalendarResponse)
}
