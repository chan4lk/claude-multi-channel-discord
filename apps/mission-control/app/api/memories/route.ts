import Database from 'better-sqlite3'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

function memoryDb(): Database.Database | null {
  const channelsDir = process.env.MCD_CHANNELS_DIR ?? join(process.env.HOME ?? '/root', '.claude', 'channels', 'discord-multi')
  const dbPath = join(channelsDir, 'memory.db')
  if (!existsSync(dbPath)) return null
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const slug = url.searchParams.get('slug') ?? undefined
  const type = url.searchParams.get('type') ?? undefined
  const q = url.searchParams.get('q') ?? undefined
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 500)

  const db = memoryDb()
  if (!db) return Response.json([])

  try {
    const conditions: string[] = []
    const params: unknown[] = []

    if (slug) { conditions.push('channel_slug = ?'); params.push(slug) }
    if (type) { conditions.push('type = ?'); params.push(type) }
    if (q) { conditions.push("content LIKE '%' || ? || '%'"); params.push(q) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(limit)

    const rows = db.prepare(
      `SELECT id, channel_slug, type, content, created_at, last_accessed_at, access_count
       FROM memories ${where}
       ORDER BY last_accessed_at DESC LIMIT ?`
    ).all(...params)

    return Response.json(rows)
  } finally {
    db.close()
  }
}
