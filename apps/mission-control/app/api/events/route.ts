import { NextRequest } from 'next/server'
import { getEvents, insertEvent, updateLastSeen, type McEvent } from '../../../src/db'
import { validateApiKey } from '../../../src/auth'
import { broadcast } from '../../../src/sse'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = req.nextUrl
  const filters = {
    instance_id: searchParams.get('instance_id') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    since: searchParams.get('since') ?? undefined,
  }
  const rows = getEvents(filters)
  return Response.json(rows)
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
  updateLastSeen(event.instance_id, event.ts)
  broadcast(event)

  return new Response('OK', { status: 200 })
}
