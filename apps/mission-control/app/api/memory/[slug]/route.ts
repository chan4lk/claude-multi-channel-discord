import * as fs from 'fs'
import * as path from 'path'

export const dynamic = 'force-dynamic'

function slugOk(slug: string): boolean {
  return /^[a-z0-9_-]+$/i.test(slug) && slug.length <= 64
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params
  if (!slugOk(slug)) return Response.json({ error: 'invalid slug' }, { status: 400 })

  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return Response.json({ error: 'MCD_CHANNELS_DIR not set' }, { status: 500 })

  const memPath = path.join(mcdDir, 'projects', slug, 'MEMORY.md')
  try {
    const content = fs.readFileSync(memPath, 'utf-8')
    const stat = fs.statSync(memPath)
    return Response.json({
      content,
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
    })
  } catch {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
}
