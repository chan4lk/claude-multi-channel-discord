import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface ScheduleLogEntry {
  slug: string
  scheduledAt: string
  firedAt: string
  status: 'ok' | 'stalled' | 'skipped'
  durationMs: number
}

export interface HistoryResponse {
  entries: ScheduleLogEntry[]
  slugs: string[]
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ entries: [], slugs: [] } satisfies HistoryResponse)

  // Build chatId → slug map
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const chatIdToSlug = new Map<string, string>()
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) chatIdToSlug.set(chatId, proj.slug)
    }
  }

  const logFile = path.join(mcdDir, 'schedule-log.jsonl')
  let raw = ''
  try {
    raw = fs.readFileSync(logFile, 'utf-8')
  } catch {
    return Response.json({ entries: [], slugs: [] } satisfies HistoryResponse)
  }

  const cutoff = Date.now() - 30 * 24 * 60 * 60_000
  const entries: ScheduleLogEntry[] = []

  for (const line of raw.trim().split('\n').filter(Boolean)) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const chatId = String(obj['chatId'] ?? '')
      const firedAt = String(obj['firedAt'] ?? '')
      if (!firedAt || new Date(firedAt).getTime() < cutoff) continue

      const slug = chatIdToSlug.get(chatId) ?? chatId
      const status = obj['status'] === 'ok' || obj['status'] === 'stalled' || obj['status'] === 'skipped'
        ? (obj['status'] as 'ok' | 'stalled' | 'skipped')
        : 'ok'

      entries.push({
        slug,
        scheduledAt: String(obj['scheduledAt'] ?? firedAt),
        firedAt,
        status,
        durationMs: typeof obj['durationMs'] === 'number' ? obj['durationMs'] : 0,
      })
    } catch {
      // Skip malformed lines
    }
  }

  const slugSet = new Set(entries.map((e) => e.slug))
  return Response.json({ entries, slugs: [...slugSet].sort() } satisfies HistoryResponse)
}
