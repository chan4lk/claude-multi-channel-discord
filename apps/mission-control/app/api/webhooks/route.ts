import { NextRequest } from 'next/server'
import { getWebhooks, insertWebhook } from '../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const rows = getWebhooks()
  return Response.json({ webhooks: rows })
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { name?: string; url?: string; event_filter?: string; use_slack_format?: boolean }
  try { body = await req.json() } catch { return new Response('Bad Request', { status: 400 }) }

  const { name = '', url = '', event_filter = 'all', use_slack_format = false } = body
  if (!url) return new Response('url required', { status: 400 })

  const id = insertWebhook(name, url, event_filter, Boolean(use_slack_format))
  return Response.json({ id }, { status: 201 })
}
