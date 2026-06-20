import { execSync } from 'child_process'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function buildEnvelope(slug: string, text: string): string {
  const ts = new Date().toISOString()
  const msgId = `mc-inject-${Date.now().toString(36)}`
  return `<channel source="mc-inject" chat_id="${slug}" message_id="${msgId}" user="operator" user_id="__mc_inject__" ts="${ts}">${text}</channel>`
}

export async function POST(req: NextRequest): Promise<Response> {
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

  try {
    execSync(`tmux send-keys -t ${JSON.stringify(session)} -l ${JSON.stringify(envelope)}`, { stdio: 'ignore' })
    execSync(`tmux send-keys -t ${JSON.stringify(session)} C-m`, { stdio: 'ignore' })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }

  return Response.json({ ok: true, slug, session })
}
