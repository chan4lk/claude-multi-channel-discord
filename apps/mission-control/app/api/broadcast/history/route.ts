import { NextRequest } from 'next/server'
import { getBroadcastHistory, deleteBroadcast } from '../../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor')
  const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '50', 10))

  const rows = getBroadcastHistory(limit, cursor ? parseInt(cursor, 10) : undefined)
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null

  const items = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    message: r.message,
    targets: JSON.parse(r.targets) as string[],
    sentCount: r.sent_count,
    errorCount: r.error_count,
  }))

  return Response.json({ items, nextCursor })
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const id = parseInt(url.searchParams.get('id') ?? '', 10)
  if (!id || isNaN(id)) return Response.json({ error: 'id required' }, { status: 400 })
  deleteBroadcast(id)
  return Response.json({ ok: true })
}
