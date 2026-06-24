import { NextRequest } from 'next/server'
import { auth } from '@/src/auth'
import { headers } from 'next/headers'
import { acknowledgeAlert, unacknowledgeAlert, getAlertEvent, insertAuditLog } from '@/src/db'

export const dynamic = 'force-dynamic'

// POST /api/alerts/[id]/ack — acknowledge an alert
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const alertId = Number(id)
  if (!Number.isInteger(alertId)) return Response.json({ error: 'Bad Request' }, { status: 400 })
  if (!getAlertEvent(alertId)) return Response.json({ error: 'Not Found' }, { status: 404 })

  const actor = session.user?.name || session.user?.email || 'unknown'
  acknowledgeAlert(alertId, actor)
  insertAuditLog({
    actor,
    actor_id: session.user?.id ?? '',
    verb: 'alert.ack',
    target: String(alertId),
  })
  return Response.json({ alert: getAlertEvent(alertId) })
}

// DELETE /api/alerts/[id]/ack — re-open (unacknowledge) an alert
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const alertId = Number(id)
  if (!Number.isInteger(alertId)) return Response.json({ error: 'Bad Request' }, { status: 400 })
  if (!getAlertEvent(alertId)) return Response.json({ error: 'Not Found' }, { status: 404 })

  const actor = session.user?.name || session.user?.email || 'unknown'
  unacknowledgeAlert(alertId)
  insertAuditLog({
    actor,
    actor_id: session.user?.id ?? '',
    verb: 'alert.unack',
    target: String(alertId),
  })
  return Response.json({ alert: getAlertEvent(alertId) })
}
