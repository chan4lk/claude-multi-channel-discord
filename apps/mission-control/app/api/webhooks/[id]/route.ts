import { NextRequest } from 'next/server'
import { getWebhook, updateWebhook, deleteWebhook } from '../../../../src/db'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const webhookId = Number(id)
  if (isNaN(webhookId)) return new Response('Bad Request', { status: 400 })

  let body: { name?: string; url?: string; event_filter?: string; use_slack_format?: boolean; enabled?: boolean }
  try { body = await req.json() } catch { return new Response('Bad Request', { status: 400 }) }

  updateWebhook(webhookId, body)
  const row = getWebhook(webhookId)
  if (!row) return new Response('Not Found', { status: 404 })
  return Response.json(row)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const webhookId = Number(id)
  if (isNaN(webhookId)) return new Response('Bad Request', { status: 400 })
  deleteWebhook(webhookId)
  return new Response(null, { status: 204 })
}
