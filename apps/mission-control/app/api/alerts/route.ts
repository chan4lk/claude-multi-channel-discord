import { NextRequest } from 'next/server'
import { getAlertEvents } from '../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug') ?? undefined
  const alert_type = searchParams.get('type') ?? undefined
  const cursor = searchParams.get('cursor') ? Number(searchParams.get('cursor')) : undefined
  const limit = searchParams.get('limit') ? Math.min(Number(searchParams.get('limit')), 200) : 100
  // Default to open-only (unacknowledged); ?includeAcked=1 shows the full history.
  const includeAcked = searchParams.get('includeAcked') === '1'

  const rows = getAlertEvents({ slug, alert_type, cursor, limit, includeAcked })
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null

  return Response.json({ alerts: rows, nextCursor })
}
