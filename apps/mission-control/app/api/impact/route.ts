import * as fs from 'fs'
import * as path from 'path'
import { getTopConvergenceSlug, getConvergenceSince, getGoalAdvancementSince } from '../../../src/db'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 90 // series window
const DELTA_WINDOW_DAYS = 7 // before/after mean window per proposal

export interface SeriesPoint {
  date: string // YYYY-MM-DD
  score: number
}

export interface ShippedProposal {
  id: string // e.g. "P194"
  number: number
  title: string
  shipDate: string // YYYY-MM-DD (from Created marker)
  beforeMean: number | null
  afterMean: number | null
  delta: number | null // afterMean − beforeMean
}

export interface ImpactResponse {
  slug: string | null // master/most-tracked project the series belongs to
  convergence: SeriesPoint[] // oldest → newest
  goal: SeriesPoint[]
  proposals: ShippedProposal[] // within window, oldest → newest
  topMovers: ShippedProposal[] // proposals with a delta, ranked by |delta| desc
  windowDays: number
  deltaWindowDays: number
}

interface ParsedProposal {
  number: number
  id: string
  title: string
  created: string | null
}

function parseDoneProposals(content: string): ParsedProposal[] {
  const out: ParsedProposal[] = []
  const headers = [...content.matchAll(/^## (P(\d+))\s+[—–-]\s+(.+)$/gm)]
  const statusRe = /\*\*Status:\*\*\s+`\[([x ])\]\s*(done|pending|in-progress)`/
  const createdRe = /\*\*Created:\*\*\s+(\d{4}-\d{2}-\d{2})/
  for (const match of headers) {
    const num = parseInt(match[2], 10)
    const title = match[3].trim()
    const idx = match.index!
    const nextIdx = content.indexOf('\n## P', idx + 1)
    const chunk = nextIdx > -1 ? content.slice(idx, nextIdx) : content.slice(idx)
    const status = statusRe.exec(chunk)
    if (status?.[1] !== 'x') continue // done only
    const created = createdRe.exec(chunk)?.[1] ?? null
    out.push({ number: num, id: `P${num}`, title, created })
  }
  return out
}

function meanInWindow(series: SeriesPoint[], startDate: string, endDate: string): number | null {
  const vals = series.filter((p) => p.date >= startDate && p.date < endDate).map((p) => p.score)
  if (vals.length === 0) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(): Promise<Response> {
  const sinceDate = shiftDate(new Date().toISOString().slice(0, 10), -WINDOW_DAYS)
  const slug = getTopConvergenceSlug()

  const convergence: SeriesPoint[] = slug
    ? getConvergenceSince(slug, sinceDate).map((r) => ({ date: r.date, score: r.score }))
    : []
  const goal: SeriesPoint[] = slug
    ? getGoalAdvancementSince(slug, sinceDate).map((r) => ({ date: r.date, score: r.score }))
    : []

  // Parse shipped proposals from BACKLOG.md (process.cwd() is the repo root).
  let proposals: ShippedProposal[] = []
  try {
    const content = fs.readFileSync(path.join(process.cwd(), 'BACKLOG.md'), 'utf-8')
    proposals = parseDoneProposals(content)
      .filter((p) => p.created && p.created >= sinceDate)
      .map((p) => {
        const ship = p.created as string
        const beforeMean = meanInWindow(convergence, shiftDate(ship, -DELTA_WINDOW_DAYS), ship)
        const afterMean = meanInWindow(convergence, ship, shiftDate(ship, DELTA_WINDOW_DAYS))
        const delta = beforeMean != null && afterMean != null
          ? Math.round((afterMean - beforeMean) * 10) / 10
          : null
        return { id: p.id, number: p.number, title: p.title, shipDate: ship, beforeMean, afterMean, delta }
      })
      .sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.number - b.number)
  } catch {
    proposals = []
  }

  const topMovers = proposals
    .filter((p) => p.delta != null)
    .sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number))
    .slice(0, 10)

  return Response.json({
    slug,
    convergence,
    goal,
    proposals,
    topMovers,
    windowDays: WINDOW_DAYS,
    deltaWindowDays: DELTA_WINDOW_DAYS,
  } satisfies ImpactResponse)
}
