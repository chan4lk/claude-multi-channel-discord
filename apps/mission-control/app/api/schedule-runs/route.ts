import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface ScheduleRunEntry {
  chatId: string
  scheduledAt: string
  firedAt: string
  status: 'ok' | 'stalled' | 'skipped' | string
  durationMs: number
}

export interface ScheduleRunGroup {
  scheduleId: string
  slug: string
  chatId: string
  at: string
  interval: string | null
  enabled: boolean
  runCount: number
  runs: ScheduleRunEntry[]
  successCount: number
  errorCount: number
  successRate: number
  avgDurationMs: number
  lastFiredAt: string | null
}

export interface ScheduleRunsResponse {
  groups: ScheduleRunGroup[]
  totalRuns: number
  totalOk: number
  totalError: number
  calendarDays: string[]
  heatmap: Record<string, Record<string, { ok: number; error: number }>>
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T } catch { return null }
}

function readJsonl<T>(filePath: string): T[] {
  try {
    return fs.readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T)
  } catch { return [] }
}

function isoDay(iso: string): string {
  return iso.slice(0, 10)
}

export async function GET(req: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ groups: [], totalRuns: 0, totalOk: 0, totalError: 0, calendarDays: [], heatmap: {} })

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365)
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  // Load schedules.json for schedule metadata
  type ScheduleFile = { schedules?: Array<Record<string, unknown>> }
  const scheduleFile = readJson<ScheduleFile>(path.join(mcdDir, 'schedules.json'))
  const schedules = scheduleFile?.schedules ?? []

  // Load channels.json for chatId → slug map
  type ChannelsFile = { projects?: Record<string, { slug?: string }> }
  const channels = readJson<ChannelsFile>(path.join(mcdDir, 'channels.json'))
  const chatIdToSlug = new Map<string, string>()
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) chatIdToSlug.set(chatId, proj.slug)
    }
  }

  // Build chatId → schedule metadata map
  type ScheduleMeta = { id: string; at: string; interval: string | null; enabled: boolean; runCount: number }
  const chatIdToSchedule = new Map<string, ScheduleMeta>()
  for (const s of schedules) {
    const cid = String(s['chatId'] ?? '')
    if (!cid) continue
    chatIdToSchedule.set(cid, {
      id: String(s['id'] ?? cid),
      at: String(s['at'] ?? ''),
      interval: s['interval'] != null ? String(s['interval']) : null,
      enabled: s['enabled'] === true,
      runCount: typeof s['runCount'] === 'number' ? s['runCount'] : 0,
    })
  }

  // Load and filter schedule-log.jsonl
  const allRuns = readJsonl<ScheduleRunEntry>(path.join(mcdDir, 'schedule-log.jsonl'))
  const filtered = allRuns.filter((r) => r.firedAt >= cutoff)

  // Group by chatId
  const byChat = new Map<string, ScheduleRunEntry[]>()
  for (const r of filtered) {
    if (!byChat.has(r.chatId)) byChat.set(r.chatId, [])
    byChat.get(r.chatId)!.push(r)
  }

  // Also include chats that have schedules but no runs in window
  for (const cid of chatIdToSchedule.keys()) {
    if (!byChat.has(cid)) byChat.set(cid, [])
  }

  const groups: ScheduleRunGroup[] = []
  for (const [chatId, runs] of byChat) {
    const meta = chatIdToSchedule.get(chatId)
    const ok = runs.filter((r) => r.status === 'ok').length
    const errors = runs.filter((r) => r.status !== 'ok').length
    const durations = runs.map((r) => r.durationMs).filter((d) => d >= 0)
    const sorted = [...runs].sort((a, b) => b.firedAt.localeCompare(a.firedAt))
    groups.push({
      scheduleId: meta?.id ?? chatId,
      slug: chatIdToSlug.get(chatId) ?? chatId,
      chatId,
      at: meta?.at ?? '',
      interval: meta?.interval ?? null,
      enabled: meta?.enabled ?? false,
      runCount: meta?.runCount ?? runs.length,
      runs: sorted.slice(0, 100),
      successCount: ok,
      errorCount: errors,
      successRate: runs.length > 0 ? ok / runs.length : 1,
      avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      lastFiredAt: sorted[0]?.firedAt ?? null,
    })
  }

  groups.sort((a, b) => (b.lastFiredAt ?? '').localeCompare(a.lastFiredAt ?? ''))

  // Build calendar heatmap: day → chatId → { ok, error }
  const daySet = new Set<string>()
  const heatmap: Record<string, Record<string, { ok: number; error: number }>> = {}
  for (const r of filtered) {
    const day = isoDay(r.firedAt)
    daySet.add(day)
    if (!heatmap[day]) heatmap[day] = {}
    if (!heatmap[day][r.chatId]) heatmap[day][r.chatId] = { ok: 0, error: 0 }
    if (r.status === 'ok') heatmap[day][r.chatId].ok++
    else heatmap[day][r.chatId].error++
  }

  // Fill missing days in range
  const calendarDays: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000)
    calendarDays.push(d.toISOString().slice(0, 10))
  }

  const totalRuns = filtered.length
  const totalOk = filtered.filter((r) => r.status === 'ok').length
  const totalError = totalRuns - totalOk

  return Response.json({ groups, totalRuns, totalOk, totalError, calendarDays, heatmap } satisfies ScheduleRunsResponse)
}
