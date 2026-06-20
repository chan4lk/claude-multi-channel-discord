import { Database } from 'bun:sqlite'

export type MemoryType = 'channel_summary' | 'decision' | 'pattern' | 'coordination' | 'general'

export interface Memory {
  id: string
  channel_slug: string | null
  type: MemoryType
  content: string
  created_at: string
  last_accessed_at: string
  access_count: number
}

export interface MemoryStats {
  total: number
  byType: Record<string, number>
  bySlug: Record<string, number>
}

export class MemoryStore {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true })
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        channel_slug TEXT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_memories_slug ON memories(channel_slug);
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    `)
  }

  async remember(slug: string | null, type: MemoryType, content: string): Promise<string> {
    const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO memories (id, channel_slug, type, content, created_at, last_accessed_at, access_count)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, slug, type, content, now, now)
    return id
  }

  async recall(
    query: string,
    opts?: { slug?: string; type?: MemoryType; limit?: number }
  ): Promise<Memory[]> {
    const limit = opts?.limit ?? 10
    const conditions: string[] = [`content LIKE '%' || ? || '%'`]
    const params: unknown[] = [query]

    if (opts?.slug !== undefined) {
      conditions.push(`channel_slug = ?`)
      params.push(opts.slug)
    }
    if (opts?.type !== undefined) {
      conditions.push(`type = ?`)
      params.push(opts.type)
    }

    params.push(limit)

    const rows = this.db
      .prepare(
        `SELECT id, channel_slug, type, content, created_at, last_accessed_at, access_count
         FROM memories
         WHERE ${conditions.join(' AND ')}
         ORDER BY last_accessed_at DESC
         LIMIT ?`
      )
      .all(...params) as Memory[]

    if (rows.length > 0) {
      const now = new Date().toISOString()
      const update = this.db.prepare(
        `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`
      )
      for (const row of rows) {
        update.run(now, row.id)
      }
    }

    return rows
  }

  forget(id: string): void {
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id)
  }

  stats(): MemoryStats {
    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number }
    ).count

    const typeRows = this.db
      .prepare(`SELECT type, COUNT(*) as count FROM memories GROUP BY type`)
      .all() as Array<{ type: string; count: number }>

    const slugRows = this.db
      .prepare(
        `SELECT COALESCE(channel_slug, '__global__') as slug, COUNT(*) as count FROM memories GROUP BY channel_slug`
      )
      .all() as Array<{ slug: string; count: number }>

    const byType: Record<string, number> = {}
    for (const row of typeRows) {
      byType[row.type] = row.count
    }

    const bySlug: Record<string, number> = {}
    for (const row of slugRows) {
      bySlug[row.slug] = row.count
    }

    return { total, byType, bySlug }
  }

  close(): void {
    this.db.close()
  }
}
