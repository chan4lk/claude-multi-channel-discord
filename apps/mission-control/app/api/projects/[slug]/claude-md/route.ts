import * as fs from 'fs'
import * as path from 'path'
import { requireSession, isSafeSlug } from '@/src/security'

export const dynamic = 'force-dynamic'

function claudeMdPath(slug: string): string | null {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return null
  if (!isSafeSlug(slug)) return null
  return path.join(mcdDir, 'projects', slug, 'CLAUDE.md')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth
  const { slug } = await params
  if (!isSafeSlug(slug)) return Response.json({ error: 'Invalid slug' }, { status: 400 })
  const filePath = claudeMdPath(slug)
  if (!filePath) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const stat = fs.statSync(filePath)
    return Response.json({ content, sizeBytes: stat.size, lastModified: stat.mtime.toISOString() })
  } catch {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth
  const { slug } = await params
  if (!isSafeSlug(slug)) return Response.json({ error: 'Invalid slug' }, { status: 400 })
  const filePath = claudeMdPath(slug)
  if (!filePath) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })
  try {
    const body = await req.json() as { content?: string }
    if (typeof body.content !== 'string') {
      return Response.json({ error: 'content required' }, { status: 400 })
    }
    const tmp = `${filePath}.tmp`
    fs.writeFileSync(tmp, body.content, 'utf-8')
    fs.renameSync(tmp, filePath)
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
