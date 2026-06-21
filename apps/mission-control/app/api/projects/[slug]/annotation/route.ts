import { NextRequest } from 'next/server'
import { getAnnotation, upsertAnnotation } from '../../../../../src/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  const note = getAnnotation(slug)
  return Response.json({ slug, note })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  let body: { note?: string }
  try {
    body = await req.json() as { note?: string }
  } catch {
    return new Response('Bad Request', { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note : ''
  upsertAnnotation(slug, note)
  return Response.json({ slug, note })
}
