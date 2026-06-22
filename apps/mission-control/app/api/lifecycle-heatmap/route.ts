import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
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
      .sort()
  } catch { return [] }
}

function isoWeekKey(date: Date): string {
  // Returns YYYY-WW (ISO week)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export interface ProjectLifecycleRow {
  slug: string
  createdAtWeek: string
  weekCounts: Record<string, number>
  totalTurns: number
}

export interface LifecycleHeatmapResponse {
  rows: ProjectLifecycleRow[]
  weeks: string[]
  maxCount: number
  generatedAt: string
}

function computeProjectRows(slugs: string[], mcdDir: string): ProjectLifecycleRow[] {
  const now = Date.now()
  const cutoffMs = now - 52 * 7 * 24 * 60 * 60 * 1000
  const rows: ProjectLifecycleRow[] = []

  for (const slug of slugs) {
    const files = findAllJsonl(slug, mcdDir)
    const weekCounts: Record<string, number> = {}
    let firstTsMs = Infinity

    for (const file of files) {
      let raw = ''
      try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        let rec: { type?: string; timestamp?: string }
        try { rec = JSON.parse(line) } catch { continue }
        if (rec.type !== 'assistant') continue
        const tsMs = rec.timestamp ? new Date(rec.timestamp).getTime() : NaN
        if (isNaN(tsMs) || tsMs < cutoffMs) continue
        if (tsMs < firstTsMs) firstTsMs = tsMs
        const wk = isoWeekKey(new Date(tsMs))
        weekCounts[wk] = (weekCounts[wk] ?? 0) + 1
      }
    }

    const totalTurns = Object.values(weekCounts).reduce((s, n) => s + n, 0)
    if (totalTurns === 0) continue

    const createdAtWeek = firstTsMs < Infinity ? isoWeekKey(new Date(firstTsMs)) : ''
    rows.push({ slug, createdAtWeek, weekCounts, totalTurns })
  }

  // Sort by creation week ascending (oldest first)
  rows.sort((a, b) => a.createdAtWeek.localeCompare(b.createdAtWeek))
  return rows
}

function buildWeekRange(): string[] {
  const weeks: string[] = []
  const now = new Date()
  for (let i = 51; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
    weeks.push(isoWeekKey(d))
  }
  // Deduplicate preserving order
  return [...new Set(weeks)]
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ rows: [], weeks: [], maxCount: 0, generatedAt: new Date().toISOString() } satisfies LifecycleHeatmapResponse)
  }

  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))
  const slugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug) slugs.push(proj.slug)
    }
  }

  const rows = computeProjectRows(slugs, mcdDir)
  const weeks = buildWeekRange()
  const maxCount = rows.reduce((m, r) => {
    const rowMax = Object.values(r.weekCounts).reduce((a, b) => Math.max(a, b), 0)
    return Math.max(m, rowMax)
  }, 0)

  return Response.json({ rows, weeks, maxCount, generatedAt: new Date().toISOString() } satisfies LifecycleHeatmapResponse)
}
