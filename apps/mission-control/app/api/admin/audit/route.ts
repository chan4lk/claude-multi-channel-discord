import { NextRequest } from 'next/server'
import { auth } from '@/src/auth'
import { headers } from 'next/headers'
import { getAuditLog, type AuditRow } from '@/src/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const format = searchParams.get('format') ?? 'json'
  const rawLimit = parseInt(searchParams.get('limit') ?? '100', 10)
  const limit = isNaN(rawLimit) ? 100 : Math.min(rawLimit, 500)
  const rawCursor = parseInt(searchParams.get('cursor') ?? '', 10)
  const cursor = isNaN(rawCursor) ? undefined : rawCursor
  const rawSince = parseInt(searchParams.get('since') ?? '', 10)
  const since = isNaN(rawSince) ? undefined : rawSince
  const rawUntil = parseInt(searchParams.get('until') ?? '', 10)
  const until = isNaN(rawUntil) ? undefined : rawUntil

  const rows = getAuditLog({
    actor_id: searchParams.get('actor_id') ?? undefined,
    verb: searchParams.get('verb') ?? undefined,
    target: searchParams.get('target') ?? undefined,
    since,
    until,
    cursor,
    limit,
  })

  if (format === 'ndjson') {
    const body = rows.map((r: AuditRow) => JSON.stringify(r)).join('\n') + '\n'
    return new Response(body, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="audit.ndjson"',
      },
    })
  }

  const nextCursor = rows.length === limit ? rows[rows.length - 1]?.id : null
  return Response.json({ rows, nextCursor })
}
