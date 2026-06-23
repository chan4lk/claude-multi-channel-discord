import { NextRequest } from 'next/server'
import { getAlertEvents } from '../../../src/db'

export const dynamic = 'force-dynamic'

/**
 * P147 — mini audit/event log for a single project (Focus Mode right column).
 * Returns recent alert/lifecycle events (stall, budget, circuit, watchdog…)
 * scoped to one slug, newest first.
 */

export interface AuditEvent {
  id: number
  ts: number
  alertType: string
  description: string
}

export interface AuditResponse {
  slug: string
  events: AuditEvent[]
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') ?? ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '10', 10) || 10, 50)
  if (!slug) return Response.json({ slug, events: [] } satisfies AuditResponse)

  const events: AuditEvent[] = getAlertEvents({ slug, limit }).map((e) => ({
    id: e.id,
    ts: e.ts,
    alertType: e.alert_type,
    description: e.description,
  }))

  return Response.json({ slug, events } satisfies AuditResponse)
}
