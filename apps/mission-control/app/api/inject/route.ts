import { spawnSync } from 'child_process'
import { NextRequest } from 'next/server'
import { insertAlertEvent } from '../../../src/db'
import { requireSession } from '../../../src/security'

export const dynamic = 'force-dynamic'

function sessionExists(name: string): boolean {
  return spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' }).status === 0
}

function buildEnvelope(slug: string, text: string): string {
  const ts = new Date().toISOString()
  const msgId = `mc-inject-${Date.now().toString(36)}`
  return `<channel source="mc-inject" chat_id="${slug}" message_id="${msgId}" user="operator" user_id="__mc_inject__" ts="${ts}">${text}</channel>`
}

export async function POST(req: NextRequest): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

  let slug: string
  let message: string
  try {
    const body = await req.json()
    slug = String(body.slug ?? '').trim()
    message = String(body.message ?? '').trim()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!slug || !message) {
    return Response.json({ error: 'slug and message required' }, { status: 400 })
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const session = `mcd-${slug}`
  if (!sessionExists(session)) {
    return Response.json({ error: `No active session for "${slug}"` }, { status: 404 })
  }

  const envelope = buildEnvelope(slug, message)

  const lit = spawnSync('tmux', ['send-keys', '-t', session, '-l', envelope], { stdio: 'ignore' })
  const enter = spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
  if (lit.status !== 0 || enter.status !== 0) {
    return Response.json({ error: 'tmux send-keys failed' }, { status: 500 })
  }

  try {
    insertAlertEvent(slug, 'inject', `Inject sent: "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`, { message: message.slice(0, 200), session })
  } catch {}

  return Response.json({ ok: true, slug, session })
}
