import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const NUDGE_MESSAGE = 'What are you working on? Summarize your current status and next planned action.'

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: string }
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 })
  }

  // Delegate to /api/inject
  const baseUrl = req.nextUrl.origin
  const res = await fetch(`${baseUrl}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, message: NUDGE_MESSAGE }),
  })

  const data = await res.json()
  if (!res.ok) return Response.json(data, { status: res.status })
  return Response.json({ ok: true, slug, nudgeMessage: NUDGE_MESSAGE })
}
