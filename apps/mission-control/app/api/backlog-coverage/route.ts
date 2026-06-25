import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface BacklogProposal {
  number: number
  title: string
  status: 'done' | 'pending' | 'in_progress'
  created: string | null   // YYYY-MM-DD
}

export interface WeekBucket {
  weekStart: string        // YYYY-MM-DD (Monday)
  done: number
  pending: number
  inProgress: number
}

export interface BacklogCoverageResponse {
  proposals: BacklogProposal[]
  weeklySeries: WeekBucket[]
  statusCounts: { done: number; pending: number; inProgress: number; total: number }
  velocity4w: number
  velocityPrior4w: number
  nextPending: BacklogProposal[]
  slug: string
  slugs: string[]
  generatedAt: string
}

function readFile(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return null }
}

function parseBacklogMd(content: string): BacklogProposal[] {
  const proposals: BacklogProposal[] = []
  const sections = content.split(/^##\s+/m).slice(1)

  for (const section of sections) {
    const lines = section.split('\n')
    const titleLine = lines[0]?.trim() ?? ''

    // Extract number from P228 format
    const numMatch = titleLine.match(/^P(\d+)\s+[—–-]/)
    const number = numMatch ? parseInt(numMatch[1], 10) : 0

    const title = titleLine.replace(/^P\d+\s+[—–-]\s+/, '').replace(/^[A-Z0-9]+\s+[—–-]\s+/, '').trim()
    if (!title) continue

    let status: BacklogProposal['status'] = 'pending'
    let created: string | null = null

    for (const line of lines) {
      if (line.includes('[x] done')) { status = 'done'; break }
      if (line.includes('[ ] in_progress') || line.includes('[~]')) { status = 'in_progress' }
    }

    for (const line of lines) {
      const m = line.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)
      if (m) { created = m[1] ?? null; break }
    }

    proposals.push({ number, title, status, created })
  }

  return proposals
}

// Returns the Monday of the ISO week containing the date
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function buildWeeklySeries(proposals: BacklogProposal[]): WeekBucket[] {
  const byWeek = new Map<string, WeekBucket>()

  for (const p of proposals) {
    if (!p.created) continue
    const ws = weekStart(p.created)
    if (!byWeek.has(ws)) byWeek.set(ws, { weekStart: ws, done: 0, pending: 0, inProgress: 0 })
    const bucket = byWeek.get(ws)!
    if (p.status === 'done') bucket.done++
    else if (p.status === 'in_progress') bucket.inProgress++
    else bucket.pending++
  }

  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestedSlug = url.searchParams.get('slug')

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(path.join(mcdDir, 'channels.json'))

  const allSlugs: string[] = []
  if (channels?.projects) {
    for (const proj of Object.values(channels.projects)) {
      if (proj.slug) allSlugs.push(proj.slug)
    }
  }

  // Default to claude-mcd if present, otherwise first slug
  const slug = requestedSlug ?? (allSlugs.includes('claude-mcd') ? 'claude-mcd' : allSlugs[0] ?? 'claude-mcd')

  const backlogPath = path.join(mcdDir, 'projects', slug, 'BACKLOG.md')
  const content = readFile(backlogPath)

  const proposals = content ? parseBacklogMd(content) : []

  const done = proposals.filter((p) => p.status === 'done').length
  const pending = proposals.filter((p) => p.status === 'pending').length
  const inProgress = proposals.filter((p) => p.status === 'in_progress').length

  // Velocity: proposals created+done in last 4w vs prior 4w
  const now = Date.now()
  const fourWeeksMs = 4 * 7 * 24 * 3_600_000
  const velocity4w = proposals.filter((p) => {
    if (p.status !== 'done' || !p.created) return false
    const ts = new Date(p.created).getTime()
    return ts >= now - fourWeeksMs
  }).length
  const velocityPrior4w = proposals.filter((p) => {
    if (p.status !== 'done' || !p.created) return false
    const ts = new Date(p.created).getTime()
    return ts >= now - 2 * fourWeeksMs && ts < now - fourWeeksMs
  }).length

  const nextPending = proposals.filter((p) => p.status === 'pending').slice(0, 3)
  const weeklySeries = buildWeeklySeries(proposals)

  return Response.json({
    proposals,
    weeklySeries,
    statusCounts: { done, pending, inProgress, total: proposals.length },
    velocity4w,
    velocityPrior4w,
    nextPending,
    slug,
    slugs: allSlugs,
    generatedAt: new Date().toISOString(),
  } satisfies BacklogCoverageResponse)
}
