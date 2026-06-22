import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

export interface ScheduleRow {
  id: string
  chatId: string
  slug: string
  at: string
  interval: string | null
  prompt: string
  type: 'prompt' | 'inject'
  templateId: string | null
  enabled: boolean
  lastRunAt: string | null
  runCount: number
  maxRuns: number | null
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
  if (!mcdDir) return Response.json([])

  // Read channels.json to build chatId → slug map
  const channels = readJson<{ projects?: Record<string, { slug?: string }> }>(
    path.join(mcdDir, 'channels.json')
  )
  const chatIdToSlug = new Map<string, string>()
  if (channels?.projects) {
    for (const [chatId, proj] of Object.entries(channels.projects)) {
      if (proj.slug) chatIdToSlug.set(chatId, proj.slug)
    }
  }

  // Read schedules.json
  const data = readJson<{ schedules?: Array<Record<string, unknown>> }>(
    path.join(mcdDir, 'schedules.json')
  )
  if (!data?.schedules || !Array.isArray(data.schedules)) {
    return Response.json([])
  }

  const rows: ScheduleRow[] = data.schedules.map((s) => {
    const chatId = String(s['chatId'] ?? '')
    const rawType = s['type']
    const type: 'prompt' | 'inject' = rawType === 'inject' ? 'inject' : 'prompt'
    return {
      id: String(s['id'] ?? ''),
      chatId,
      slug: chatIdToSlug.get(chatId) ?? chatId,
      at: String(s['at'] ?? ''),
      interval: s['interval'] != null ? String(s['interval']) : null,
      prompt: String(s['prompt'] ?? ''),
      type,
      templateId: s['templateId'] != null ? String(s['templateId']) : null,
      enabled: s['enabled'] === true,
      lastRunAt: s['lastRunAt'] != null ? String(s['lastRunAt']) : null,
      runCount: typeof s['runCount'] === 'number' ? s['runCount'] : 0,
      maxRuns: typeof s['maxRuns'] === 'number' ? s['maxRuns'] : null,
    }
  })

  return Response.json(rows)
}
