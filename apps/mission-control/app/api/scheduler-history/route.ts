import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export const dynamic = 'force-dynamic'

export interface SchedulerHistoryEvent {
  ts: string
  scheduleId: string
  slug: string
  interval: string | null
  message: string
  injected: boolean
  error: string | null
}

export interface ScheduleStats {
  scheduleId: string
  slug: string
  interval: string | null
  fireCount: number
  errorCount: number
  lastFired: string | null
  lastError: string | null
}

export interface SchedulerHistoryResponse {
  events: SchedulerHistoryEvent[]
  scheduleStats: ScheduleStats[]
  totalFires: number
  totalErrors: number
  page: number
  pageSize: number
  total: number
  generatedAt: string
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') ?? '50', 10)))
  const filterSlug = url.searchParams.get('slug') ?? null
  const filterScheduleId = url.searchParams.get('schedule_id') ?? null

  const mcdDir = process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
  const logPath = path.join(mcdDir, 'scheduler-history.jsonl')

  const allEvents: SchedulerHistoryEvent[] = []
  let raw = ''
  try { raw = fs.readFileSync(logPath, 'utf-8') } catch { /* empty */ }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as SchedulerHistoryEvent
      if (!e.ts || !e.scheduleId) continue
      if (filterSlug && e.slug !== filterSlug) continue
      if (filterScheduleId && e.scheduleId !== filterScheduleId) continue
      allEvents.push(e)
    } catch { continue }
  }

  allEvents.sort((a, b) => b.ts.localeCompare(a.ts))

  // Compute per-schedule stats (from all events, ignoring slug/id filter for stats)
  const allForStats: SchedulerHistoryEvent[] = []
  let rawFull = ''
  try { rawFull = fs.readFileSync(logPath, 'utf-8') } catch { /* empty */ }
  for (const line of rawFull.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as SchedulerHistoryEvent
      if (e.ts && e.scheduleId) allForStats.push(e)
    } catch { continue }
  }

  const statsMap = new Map<string, ScheduleStats>()
  for (const e of allForStats) {
    let s = statsMap.get(e.scheduleId)
    if (!s) {
      s = { scheduleId: e.scheduleId, slug: e.slug, interval: e.interval, fireCount: 0, errorCount: 0, lastFired: null, lastError: null }
      statsMap.set(e.scheduleId, s)
    }
    s.fireCount++
    if (!e.injected) {
      s.errorCount++
      s.lastError = e.error
    }
    if (!s.lastFired || e.ts > s.lastFired) s.lastFired = e.ts
  }
  const scheduleStats = [...statsMap.values()].sort((a, b) => (b.lastFired ?? '').localeCompare(a.lastFired ?? ''))

  const total = allEvents.length
  const events = allEvents.slice((page - 1) * pageSize, page * pageSize)
  const totalFires = allForStats.length
  const totalErrors = allForStats.filter((e) => !e.injected).length

  return Response.json({
    events,
    scheduleStats,
    totalFires,
    totalErrors,
    page,
    pageSize,
    total,
    generatedAt: new Date().toISOString(),
  } satisfies SchedulerHistoryResponse)
}
