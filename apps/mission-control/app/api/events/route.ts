import { NextRequest } from 'next/server'
import { getEvents, countEvents, insertEvent, insertAuditLog, updateLastSeen, type McEvent } from '../../../src/db'
import { validateApiKey } from '../../../src/auth'
import { broadcast } from '../../../src/sse'

const AUDIT_EVENT_VERB: Record<string, string> = {
  session_start: 'spawn',
  session_stop: 'stop',
  session_killed_watchdog: 'kill',
  scheduler_fired: 'schedule-fire',
  circuit_open: 'circuit-open',
  circuit_reset: 'circuit-reset',
  command_executed: 'command',
  context_warning: 'context-warning',
}

function maybeAudit(event: McEvent): void {
  const verb = AUDIT_EVENT_VERB[event.type]
  if (!verb) return
  const p = event.payload as Record<string, unknown>
  insertAuditLog({
    actor: (p.actor as string | undefined) ?? event.user,
    actor_id: (p.actor_id as string | undefined) ?? '',
    verb: (p.verb as string | undefined) ?? verb,
    target: (p.slug as string | undefined) ?? (p.target as string | undefined) ?? '',
    payload: p,
  })
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl
  const rawLimit = parseInt(searchParams.get('limit') ?? '', 10)
  const limit = isNaN(rawLimit) ? 100 : Math.min(rawLimit, 500)
  const rawCursor = parseInt(searchParams.get('cursor') ?? '', 10)
  const cursor = isNaN(rawCursor) ? undefined : rawCursor
  const slug = searchParams.get('slug') ?? undefined
  const type = searchParams.get('type') ?? undefined
  const filters = {
    instance_id: searchParams.get('instance_id') ?? undefined,
    type,
    since: searchParams.get('since') ?? undefined,
    slug,
    cursor,
    limit,
  }
  const rows = getEvents(filters)
  const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id : null
  // Only include total when caller requests it (counts are expensive on large tables)
  const includeTotal = searchParams.get('total') === '1'
  const total = includeTotal ? countEvents({ type, slug }) : undefined
  return Response.json({ events: rows, nextCursor, ...(includeTotal ? { total } : {}) })
}

export async function POST(req: NextRequest): Promise<Response> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token || !validateApiKey(token)) {
    return new Response('Unauthorized', { status: 401 })
  }

  let event: McEvent
  try {
    event = (await req.json()) as McEvent
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  insertEvent(event)
  updateLastSeen(event)
  maybeAudit(event)
  broadcast(event)

  return new Response('OK', { status: 200 })
}
