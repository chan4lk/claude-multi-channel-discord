import { execSync } from 'child_process'
import { NextRequest } from 'next/server'
import { insertBroadcast } from '../../../src/db'

export const dynamic = 'force-dynamic'

function sessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(name)}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function buildEnvelope(slug: string, message: string): string {
  const ts = new Date().toISOString()
  const msgId = `mc-broadcast-${Date.now().toString(36)}-${slug}`
  return `<channel source="mc-broadcast" chat_id="${slug}" message_id="${msgId}" user="operator" user_id="__mc_broadcast__" ts="${ts}">${message}</channel>`
}

function injectSlug(slug: string, rawMessage: string): { slug: string; status: 'sent' | 'error'; error?: string } {
  const message = rawMessage.replace(/\{\{slug\}\}/g, slug)
  const session = `mcd-${slug}`

  if (!sessionExists(session)) {
    return { slug, status: 'error', error: `No active session for "${slug}"` }
  }

  try {
    const envelope = buildEnvelope(slug, message)
    execSync(`tmux send-keys -t ${JSON.stringify(session)} -l ${JSON.stringify(envelope)}`, { stdio: 'ignore' })
    execSync(`tmux send-keys -t ${JSON.stringify(session)} C-m`, { stdio: 'ignore' })
    return { slug, status: 'sent' }
  } catch (err) {
    return { slug, status: 'error', error: (err as Error).message }
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  let slugs: string[]
  let message: string

  try {
    const body = await req.json()
    slugs = Array.isArray(body.slugs) ? body.slugs.map((s: unknown) => String(s).trim()).filter(Boolean) : []
    message = String(body.message ?? '').trim()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!slugs.length) return Response.json({ error: 'slugs array required' }, { status: 400 })
  if (!message) return Response.json({ error: 'message required' }, { status: 400 })

  const invalidSlug = slugs.find((s) => !/^[a-zA-Z0-9_-]+$/.test(s))
  if (invalidSlug) return Response.json({ error: `Invalid slug: "${invalidSlug}"` }, { status: 400 })

  const results = await Promise.all(slugs.map((slug) => Promise.resolve(injectSlug(slug, message))))

  const sent = results.filter((r) => r.status === 'sent').length
  const errors = results.filter((r) => r.status === 'error').length

  try {
    insertBroadcast(new Date().toISOString(), message, slugs, sent, errors)
  } catch { /* non-fatal */ }

  return Response.json({ sent, errors, results })
}
