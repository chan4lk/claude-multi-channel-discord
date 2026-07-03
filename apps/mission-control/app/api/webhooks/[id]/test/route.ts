import { NextRequest } from 'next/server'
import { getWebhook, insertWebhookDelivery } from '../../../../../src/db'
import { assertSafeWebhookUrl } from '../../../../../src/security'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const webhookId = Number(id)
  if (isNaN(webhookId)) return new Response('Bad Request', { status: 400 })

  const hook = getWebhook(webhookId)
  if (!hook) return new Response('Not Found', { status: 404 })

  // Re-validate at fetch time: rows may predate the store-time guard, and the
  // host could re-resolve to a private address (DNS rebinding).
  const urlError = await assertSafeWebhookUrl(hook.url)
  if (urlError) return new Response(urlError, { status: 400 })

  const ts = new Date().toISOString()
  const payload = hook.use_slack_format
    ? JSON.stringify({ text: '🔔 [test] test: Test webhook delivery' })
    : JSON.stringify({ event: 'test', slug: 'test', timestamp: ts, detail: 'Test webhook delivery' })

  let status = 'error'
  let responseCode: number | null = null
  let error: string | null = null
  try {
    const res = await Promise.race([
      fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }),
      new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5_000)),
    ]) as Response
    responseCode = res.status
    status = res.ok ? 'success' : 'error'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    status = error === 'timeout' ? 'timeout' : 'error'
  }

  insertWebhookDelivery(webhookId, 'test', 'test', status, responseCode, error)
  return Response.json({ status, responseCode, error })
}
