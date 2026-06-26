import { NextRequest } from 'next/server'
import { getAlertEvents, markAlertDelivered, getAlertEvent } from '../../../src/db'
import type { AlertEventRow } from '../../../src/db'

export const dynamic = 'force-dynamic'

type DeliveryStatus = 'delivered' | 'failed' | 'pending'

export interface AlertDeliveryRow {
  id: number
  ts: number
  slug: string
  alert_type: string
  description: string
  ack_ts: number | null
  delivered_ts: number | null
  delivery_channel: string
  delivery_message_id: string
  delivery_error: string
  status: DeliveryStatus
}

export interface AlertDeliveryStats {
  successRate: number         // 0-100
  avgLatencyS: number | null  // avg seconds from ts to delivered_ts
  undelivered24h: number
}

export interface AlertDeliveryResponse {
  alerts: AlertDeliveryRow[]
  stats: AlertDeliveryStats
  nextCursor: number | null
  generatedAt: string
}

function rowToDelivery(r: AlertEventRow): AlertDeliveryRow {
  let status: DeliveryStatus = 'pending'
  if (r.delivered_ts !== null && r.delivered_ts > 0) {
    status = r.delivery_error ? 'failed' : 'delivered'
  }
  return {
    id: r.id,
    ts: r.ts,
    slug: r.slug,
    alert_type: r.alert_type,
    description: r.description,
    ack_ts: r.ack_ts,
    delivered_ts: r.delivered_ts ?? null,
    delivery_channel: r.delivery_channel ?? '',
    delivery_message_id: r.delivery_message_id ?? '',
    delivery_error: r.delivery_error ?? '',
    status,
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const sp = req.nextUrl.searchParams
  const filterStatus = sp.get('status') ?? ''
  const filterType = sp.get('type') ?? ''
  const cursor = sp.get('cursor') ? Number(sp.get('cursor')) : undefined
  const limit = Math.min(200, Number(sp.get('limit') ?? '100'))

  const rows = getAlertEvents({ alert_type: filterType || undefined, cursor, limit, includeAcked: true })
  const deliveries = rows.map(rowToDelivery)

  // Apply status filter
  const filtered = filterStatus
    ? deliveries.filter((d) => d.status === filterStatus)
    : deliveries

  // Stats
  const cutoff24h = Math.floor(Date.now() / 1000) - 86400
  const withDelivery = deliveries.filter((d) => d.delivered_ts !== null && d.delivered_ts > 0)
  const successCount = withDelivery.filter((d) => !d.delivery_error).length
  const successRate = deliveries.length > 0
    ? Math.round((successCount / deliveries.length) * 100)
    : 100

  const latencies = withDelivery
    .filter((d) => d.delivered_ts !== null)
    .map((d) => d.delivered_ts! - d.ts)
    .filter((l) => l >= 0 && l < 3600)
  const avgLatencyS = latencies.length > 0
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null

  const undelivered24h = deliveries.filter(
    (d) => d.ts >= cutoff24h && d.status === 'pending'
  ).length

  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null

  return Response.json({
    alerts: filtered,
    stats: { successRate, avgLatencyS, undelivered24h },
    nextCursor,
    generatedAt: new Date().toISOString(),
  } satisfies AlertDeliveryResponse)
}

/** POST body: { id: number, channel: string, messageId?: string, error?: string } */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json() as { id?: number; channel?: string; messageId?: string; error?: string }
    const { id, channel = '', messageId = '', error = '' } = body
    if (!id || typeof id !== 'number') {
      return Response.json({ error: 'id required' }, { status: 400 })
    }
    const existing = getAlertEvent(id)
    if (!existing) return Response.json({ error: 'alert not found' }, { status: 404 })
    markAlertDelivered(id, channel, messageId, error)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
