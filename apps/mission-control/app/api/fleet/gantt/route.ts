import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getAlertEvents } from '../../../../src/db'

export const dynamic = 'force-dynamic'

export interface GanttEvent {
  type: 'turn' | 'stall' | 'inject'
  ts: string
  description: string
}

export interface GanttProject {
  slug: string
  events: GanttEvent[]
  firstSeenMs: number | null
  lastSeenMs: number | null
}

export interface GanttResponse {
  projects: GanttProject[]
  windowMs: number
  generatedAt: string
}

function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, '-')
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
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
  } catch { return [] }
}

interface AssistantRecord {
  type: string
  timestamp?: string
  message?: {
    content?: Array<{ type: string; name?: string }>
  }
}

function extractTurnEvents(slug: string, mcdDir: string, cutoffMs: number): GanttEvent[] {
  const files = findAllJsonl(slug, mcdDir)
  const events: GanttEvent[] = []

  for (const file of files) {
    let raw = ''
    try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      let rec: AssistantRecord
      try { rec = JSON.parse(line) as AssistantRecord } catch { continue }
      if (rec.type !== 'assistant') continue
      const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
      if (!ts) continue
      const tsMs = new Date(ts).getTime()
      if (isNaN(tsMs) || tsMs < cutoffMs) continue

      const toolUses = (rec.message?.content ?? []).filter((c) => c.type === 'tool_use')
      const hasInject = toolUses.some((c) => c.name?.includes('reply'))
      events.push({
        type: hasInject ? 'inject' : 'turn',
        ts,
        description: `${toolUses.length} tool call${toolUses.length !== 1 ? 's' : ''}`,
      })
    }
  }

  return events
}

export async function GET(request: Request): Promise<Response> {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) {
    return Response.json({ projects: [], windowMs: 0, generatedAt: new Date().toISOString() } satisfies GanttResponse)
  }

  const url = new URL(request.url)
  const daysParam = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '7', 10), 1), 30)
  const windowMs = daysParam * 24 * 60 * 60 * 1000
  const cutoffMs = Date.now() - windowMs

  const channels = readJson<{
    projects?: Record<string, { slug?: string }>
  }>(path.join(mcdDir, 'channels.json'))

  const projects: GanttProject[] = []

  if (channels?.projects) {
    for (const [, proj] of Object.entries(channels.projects)) {
      const slug = proj.slug
      if (!slug) continue

      const turnEvents = extractTurnEvents(slug, mcdDir, cutoffMs)

      // Get stall alerts from DB
      let stallEvents: GanttEvent[] = []
      try {
        const alerts = getAlertEvents({ slug, alert_type: 'stall', limit: 200 })
        stallEvents = alerts
          .filter((a) => a.ts * 1000 >= cutoffMs)
          .map((a) => ({
            type: 'stall' as const,
            ts: new Date(a.ts * 1000).toISOString(),
            description: a.description ?? 'stall detected',
          }))
      } catch { /* db may not exist */ }

      const allEvents = [...turnEvents, ...stallEvents].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      )

      const tsMsList = allEvents.map((e) => new Date(e.ts).getTime()).filter((t) => !isNaN(t))

      projects.push({
        slug,
        events: allEvents,
        firstSeenMs: tsMsList.length > 0 ? Math.min(...tsMsList) : null,
        lastSeenMs: tsMsList.length > 0 ? Math.max(...tsMsList) : null,
      })
    }
  }

  // Sort: most active first
  projects.sort((a, b) => (b.events.length) - (a.events.length))

  return Response.json({
    projects,
    windowMs,
    generatedAt: new Date().toISOString(),
  } satisfies GanttResponse)
}
