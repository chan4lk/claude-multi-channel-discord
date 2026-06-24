import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import db from '../../../src/db'

export const dynamic = 'force-dynamic'

export interface SessionHealthCalendarCell {
  slug: string
  date: string   // YYYY-MM-DD
  avgScore: number
  turnCount: number
}

export interface SessionHealthCalendarResponse {
  slugs: string[]
  dates: string[]
  cells: SessionHealthCalendarCell[]
  fleetBest: string | null
  fleetWorst: string | null
  windowDays: number
  generatedAt: string
}

interface TurnQualityRow {
  slug: string
  hour: string
  score: number
  turn_count: number
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function dateRange(start: Date, end: Date): string[] {
  const dates: string[] = []
  const cur = new Date(start)
  cur.setUTCHours(0, 0, 0, 0)
  const endDate = new Date(end)
  endDate.setUTCHours(0, 0, 0, 0)
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawWindow = url.searchParams.get('window')
  const windowDays = rawWindow === '60' ? 60 : rawWindow === '90' ? 90 : 30

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const channelsPath = path.join(mcdDir, 'channels.json')
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(channelsPath)

  const slugs: string[] = []
  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      if (proj.slug && proj.slug !== 'master') slugs.push(proj.slug)
    }
  }
  slugs.sort()

  // Build full date range
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowDays * 24 * 3_600_000)
  const dates = dateRange(windowStart, now)

  // Query DB: cutoff = now minus windowDays days, as ISO hour string "YYYY-MM-DDTHH"
  const cutoffHour = windowStart.toISOString().slice(0, 13)
  const rawRows = db.prepare(
    `SELECT slug, hour, score, turn_count FROM turn_quality WHERE hour >= ? ORDER BY hour ASC`
  ).all(cutoffHour) as TurnQualityRow[]

  // Aggregate: for each (slug, date), compute weighted-average score and sum turn_count
  // Key: "slug:date"
  const aggMap = new Map<string, { scoreSum: number; turnSum: number }>()

  for (const row of rawRows) {
    const date = row.hour.slice(0, 10) // "YYYY-MM-DD"
    const key = `${row.slug}:${date}`
    const existing = aggMap.get(key)
    if (existing) {
      // Weighted sum: score * turn_count
      existing.scoreSum += row.score * row.turn_count
      existing.turnSum += row.turn_count
    } else {
      aggMap.set(key, { scoreSum: row.score * row.turn_count, turnSum: row.turn_count })
    }
  }

  // Build cells (only for dates with data — zero-data handled on front-end)
  const cells: SessionHealthCalendarCell[] = []
  for (const [key, { scoreSum, turnSum }] of aggMap) {
    const colonIdx = key.indexOf(':')
    const slug = key.slice(0, colonIdx)
    const date = key.slice(colonIdx + 1)
    cells.push({
      slug,
      date,
      avgScore: turnSum > 0 ? Math.round(scoreSum / turnSum) : 0,
      turnCount: turnSum,
    })
  }

  // Fleet aggregate per day: average avgScore across all slugs that have data that day
  const fleetByDate = new Map<string, { scoreSum: number; slugCount: number }>()
  for (const cell of cells) {
    const existing = fleetByDate.get(cell.date)
    if (existing) {
      existing.scoreSum += cell.avgScore
      existing.slugCount += 1
    } else {
      fleetByDate.set(cell.date, { scoreSum: cell.avgScore, slugCount: 1 })
    }
  }

  // Identify fleetBest and fleetWorst (worst only from dates with ≥ 2 slugs)
  let fleetBest: string | null = null
  let fleetBestScore = -Infinity
  let fleetWorst: string | null = null
  let fleetWorstScore = Infinity

  for (const [date, { scoreSum, slugCount }] of fleetByDate) {
    if (slugCount === 0) continue
    const avg = scoreSum / slugCount
    if (avg > fleetBestScore) {
      fleetBestScore = avg
      fleetBest = date
    }
    if (slugCount >= 2 && avg < fleetWorstScore) {
      fleetWorstScore = avg
      fleetWorst = date
    }
  }

  return Response.json({
    slugs,
    dates,
    cells,
    fleetBest,
    fleetWorst,
    windowDays,
    generatedAt: new Date().toISOString(),
  } satisfies SessionHealthCalendarResponse)
}
