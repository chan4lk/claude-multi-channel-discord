import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface HistoricalWeek {
  weekStart: string   // YYYY-MM-DD
  completed: number   // proposals completed this week
  cumDone: number     // cumulative done up to end of week
  remaining: number   // pending at end of week
}

export interface ProjectedWeek {
  weekStart: string
  remaining: number
}

export interface BacklogForecastResponse {
  historical: HistoricalWeek[]
  projected: ProjectedWeek[]       // future weeks until cleared (or 52 weeks max)
  totalProposals: number
  totalDone: number
  totalPending: number
  velocity4w: number               // proposals/week (last 4w)
  velocityOptimistic: number       // p75 of weekly velocities
  estimatedDoneDate: string | null // ISO date (linear) or null if stalled
  estimatedDoneDateOptimistic: string | null
  stalled: boolean
  generatedAt: string
}

interface BacklogProposal {
  status: 'done' | 'pending' | 'in_progress'
  created: string | null
}

function readFile(p: string): string | null {
  try { return fs.readFileSync(p, 'utf-8') } catch { return null }
}

function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addWeeks(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

function parseBacklogMd(content: string): BacklogProposal[] {
  const proposals: BacklogProposal[] = []
  const sections = content.split(/^##\s+/m).slice(1)

  for (const section of sections) {
    const lines = section.split('\n')
    const titleLine = lines[0]?.trim() ?? ''
    if (!titleLine) continue

    let status: BacklogProposal['status'] = 'pending'
    let created: string | null = null

    for (const line of lines) {
      if (line.includes('[x] done')) { status = 'done'; break }
      if (line.includes('[~]') || line.includes('in_progress')) { status = 'in_progress' }
    }

    for (const line of lines) {
      const m = line.match(/\*\*Created:\*\*\s*(\d{4}-\d{2}-\d{2})/)
      if (m) { created = m[1] ?? null; break }
    }

    proposals.push({ status, created })
  }

  return proposals
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[idx] ?? 0
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')

  // Try repo-relative path first, then sibling
  const backlogPaths = [
    path.join(mcdDir, '..', 'projects', 'claude-mcd', 'BACKLOG.md'),
    path.join(os.homedir(), '.claude', 'channels', 'discord-multi', '..', 'projects', 'claude-mcd', 'BACKLOG.md'),
    '/home/openclaw/.claude/channels/discord-multi/projects/claude-mcd/BACKLOG.md',
  ]

  let backlogContent: string | null = null
  for (const p of backlogPaths) {
    backlogContent = readFile(p)
    if (backlogContent) break
  }

  if (!backlogContent) {
    return Response.json({
      historical: [], projected: [], totalProposals: 0, totalDone: 0, totalPending: 0,
      velocity4w: 0, velocityOptimistic: 0, estimatedDoneDate: null,
      estimatedDoneDateOptimistic: null, stalled: true,
      generatedAt: new Date().toISOString(),
    } satisfies BacklogForecastResponse)
  }

  const proposals = parseBacklogMd(backlogContent)
  const totalProposals = proposals.length
  const totalDone = proposals.filter((p) => p.status === 'done').length
  const totalPending = proposals.filter((p) => p.status === 'pending' || p.status === 'in_progress').length

  // Build weekly completion series (by created date as proxy for completion)
  // Group "done" proposals by their created week as a rough proxy
  // Better: use created date as the placement, acceptance as "that week's work done"
  const byWeek = new Map<string, { completed: number }>()
  const today = new Date().toISOString().slice(0, 10)
  const todayWeek = weekStart(today)

  for (const p of proposals) {
    if (p.status !== 'done' || !p.created) continue
    const ws = weekStart(p.created)
    if (!byWeek.has(ws)) byWeek.set(ws, { completed: 0 })
    byWeek.get(ws)!.completed++
  }

  // Sort all weeks
  const allWeeks = [...byWeek.keys()].sort()
  if (allWeeks.length === 0) {
    return Response.json({
      historical: [], projected: [], totalProposals, totalDone, totalPending,
      velocity4w: 0, velocityOptimistic: 0, estimatedDoneDate: null,
      estimatedDoneDateOptimistic: null, stalled: true,
      generatedAt: new Date().toISOString(),
    } satisfies BacklogForecastResponse)
  }

  // Build historical with cumulative + remaining
  let cumDone = 0
  const historical: HistoricalWeek[] = []
  for (const ws of allWeeks) {
    const completed = byWeek.get(ws)!.completed
    cumDone += completed
    historical.push({
      weekStart: ws,
      completed,
      cumDone,
      remaining: totalProposals - cumDone,
    })
  }

  // Last 4w velocity
  const fourWeeksAgo = addWeeks(todayWeek, -4)
  const recent4w = historical.filter((h) => h.weekStart >= fourWeeksAgo)
  const velocity4w = recent4w.length > 0
    ? Math.round((recent4w.reduce((s, h) => s + h.completed, 0) / 4) * 10) / 10
    : 0

  // p75 optimistic velocity from all historical weekly velocities
  const allVelocities = historical.map((h) => h.completed).sort((a, b) => a - b)
  const velocityOptimistic = percentile(allVelocities, 75)

  const stalled = velocity4w === 0

  // Build projection (up to 52 weeks)
  const projected: ProjectedWeek[] = []
  let remaining = totalPending

  function buildProjection(vel: number): string | null {
    if (vel <= 0) return null
    let rem = totalPending
    let week = todayWeek
    for (let i = 0; i < 52 && rem > 0; i++) {
      week = addWeeks(week, 1)
      rem = Math.max(0, rem - vel)
      if (i < 52) projected.push({ weekStart: week, remaining: rem })
    }
    if (rem <= 0) return week
    return null
  }

  const estimatedDoneDate = buildProjection(velocity4w)
  projected.length = 0  // reset for optimistic
  const estimatedDoneDateOptimistic = buildProjection(velocityOptimistic)

  // Rebuild linear projection for return value
  const linearProjected: ProjectedWeek[] = []
  if (velocity4w > 0) {
    let rem = totalPending
    let week = todayWeek
    for (let i = 0; i < 52 && rem > 0; i++) {
      week = addWeeks(week, 1)
      rem = Math.max(0, rem - velocity4w)
      linearProjected.push({ weekStart: week, remaining: rem })
    }
  }

  return Response.json({
    historical,
    projected: linearProjected,
    totalProposals,
    totalDone,
    totalPending,
    velocity4w,
    velocityOptimistic,
    estimatedDoneDate,
    estimatedDoneDateOptimistic,
    stalled,
    generatedAt: new Date().toISOString(),
  } satisfies BacklogForecastResponse)
}
