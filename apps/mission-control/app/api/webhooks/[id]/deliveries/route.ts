import { NextRequest } from 'next/server'
import { getWebhookDeliveries } from '../../../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const webhookId = Number(id)
  if (isNaN(webhookId)) return new Response('Bad Request', { status: 400 })
  const rows = getWebhookDeliveries(webhookId, 20)
  return Response.json({ deliveries: rows })
}
