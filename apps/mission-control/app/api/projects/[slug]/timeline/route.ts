import { NextRequest } from 'next/server'
import { getEvents, getAuditLog, type EventRow, type AuditRow } from '../../../../../src/db'

export const dynamic = 'force-dynamic'

export type TimelineEventType =
  | 'spawn'
  | 'kill'
  | 'crash'
  | 'stuck'
  | 'budget-alert'
  | 'scheduler-fire'
  | 'distillation'
  | 'reply'
  | 'audit'
  | 'other'

export interface TimelineEntry {
  id: string
  ts: number
  eventType: TimelineEventType
  rawType: string
  source: 'event' | 'audit'
  snippet?: string
  payload?: Record<string, unknown>
  auditVerb?: string
  auditActor?: string
}

const EVENT_TYPE_MAP: Record<string, TimelineEventType> = {
  session_start:            'spawn',
  spawn:                    'spawn',
  session_stop:             'kill',
  stop:                     'kill',
  session_killed_watchdog:  'kill',
  watchdog:                 'stuck',
  budget_alert:             'budget-alert',
  budget_threshold:         'budget-alert',
  scheduler_fired:          'scheduler-fire',
  distillation:             'distillation',
  memory_distillation:      'distillation',
  reply:                    'reply',
  error:                    'crash',
  error_event:              'crash',
}

function classifyEvent(rawType: string): TimelineEventType {
  return EVENT_TYPE_MAP[rawType] ?? 'other'
}

function snippetFromPayload(raw: string): string | undefined {
  try {
    const p = JSON.parse(raw)
    if (typeof p?.text === 'string' && p.text.length > 0) return p.text.slice(0, 300)
    if (typeof p?.snippet === 'string' && p.snippet.length > 0) return p.snippet.slice(0, 300)
    if (typeof p?.message === 'string' && p.message.length > 0) return p.message.slice(0, 300)
  } catch {}
  return undefined
}

export interface TimelineResponse {
  entries: TimelineEntry[]
  nextCursor: string | null
  slug: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params
  const { searchParams } = req.nextUrl
  const limitParam = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit = isNaN(limitParam) ? 50 : Math.min(limitParam, 100)
  const cursorParam = searchParams.get('cursor')

  // Parse cursor: "e:<id>" for events, "a:<id>" for audit
  let eventCursor: number | undefined
  let auditCursor: number | undefined
  if (cursorParam) {
    if (cursorParam.startsWith('e:')) eventCursor = parseInt(cursorParam.slice(2), 10)
    else if (cursorParam.startsWith('a:')) auditCursor = parseInt(cursorParam.slice(2), 10)
  }

  // Fetch more than needed so we can interleave
  const fetchN = limit * 2 + 10

  const eventRows: EventRow[] = getEvents({
    instance_id: slug,
    cursor: eventCursor,
    limit: fetchN,
  })

  const auditRows: AuditRow[] = getAuditLog({
    target: slug,
    cursor: auditCursor,
    limit: fetchN,
  })

  // Convert to unified entries
  const eventEntries: TimelineEntry[] = eventRows.map((row) => ({
    id: `e:${row.id}`,
    ts: new Date(row.ts).getTime(),
    eventType: classifyEvent(row.type),
    rawType: row.type,
    source: 'event' as const,
    snippet: classifyEvent(row.type) === 'reply' ? snippetFromPayload(row.payload) : undefined,
    payload: (() => { try { return JSON.parse(row.payload) } catch { return undefined } })(),
  }))

  const auditEntries: TimelineEntry[] = auditRows.map((row) => ({
    id: `a:${row.id}`,
    ts: row.ts,
    eventType: classifyEvent(row.verb) === 'other' ? 'audit' : classifyEvent(row.verb),
    rawType: row.verb,
    source: 'audit' as const,
    auditVerb: row.verb,
    auditActor: row.actor || undefined,
  }))

  // Merge and sort descending by ts
  const all = [...eventEntries, ...auditEntries].sort((a, b) => b.ts - a.ts)

  // Take limit entries
  const page = all.slice(0, limit)

  // Build next cursor from the last entry
  let nextCursor: string | null = null
  if (all.length > limit) {
    const last = page[page.length - 1]
    nextCursor = last.id
  }

  return Response.json({ entries: page, nextCursor, slug } satisfies TimelineResponse)
}
