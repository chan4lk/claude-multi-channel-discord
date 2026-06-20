import Database from 'better-sqlite3'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export const dynamic = 'force-dynamic'

function memoryDb(): Database.Database | null {
  const channelsDir = process.env.MCD_CHANNELS_DIR ?? join(process.env.HOME ?? '/root', '.claude', 'channels', 'discord-multi')
  const dbPath = join(channelsDir, 'memory.db')
  if (!existsSync(dbPath)) return null
  return new Database(dbPath, { fileMustExist: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  const db = memoryDb()
  if (!db) return Response.json({ ok: false, error: 'memory.db not found' }, { status: 404 })
  try {
    db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    return Response.json({ ok: true })
  } finally {
    db.close()
  }
}
