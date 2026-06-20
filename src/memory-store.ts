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
  private _pipeline: unknown = null
  private _pipelinePromise: Promise<void>

  constructor(dbPath: string, embeddingModelDir: string) {
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

    // Fire-and-forget: initialise the embedding pipeline in the background
    // so bot startup is not blocked.
    this._pipelinePromise = (async () => {
      try {
        const { pipeline, env } = await import('@xenova/transformers')
        env.cacheDir = embeddingModelDir
        this._pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
      } catch (err) {
        process.stderr.write(`[memory-store] embedding pipeline init failed: ${err}\n`)
        this._pipeline = null
      }
    })()
  }

  private async _getEmbedding(text: string): Promise<Float32Array | null> {
    // Ensure the init attempt has finished (may already be resolved)
    await this._pipelinePromise
    if (this._pipeline === null) return null
    try {
      const out = await (this._pipeline as (
        text: string,
        opts: { pooling: string; normalize: boolean }
      ) => Promise<{ data: Float32Array }>)(text, { pooling: 'mean', normalize: true })
      return out.data
    } catch (err) {
      process.stderr.write(`[memory-store] _getEmbedding error: ${err}\n`)
      return null
    }
  }

  private _cosine(a: Float32Array, b: Float32Array): number {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i] }
    return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
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

    // Embedding update is slightly deferred but non-blocking for the caller
    try {
      const emb = await this._getEmbedding(content)
      if (emb) {
        this.db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(
          Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength), id
        )
      }
    } catch (err) {
      process.stderr.write(`[memory-store] remember embedding update failed: ${err}\n`)
    }

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
        `SELECT id, channel_slug, type, content, embedding, created_at, last_accessed_at, access_count
         FROM memories
         WHERE ${conditions.join(' AND ')}
         ORDER BY last_accessed_at DESC
         LIMIT ?`
      )
      .all(...params) as Array<Memory & { embedding: Buffer | null }>

    // Attempt embedding-based re-ranking if the pipeline is ready and at
    // least one result has a stored embedding blob.
    if (this._pipeline !== null && rows.some(r => r.embedding != null)) {
      try {
        const queryEmb = await this._getEmbedding(query)
        if (queryEmb) {
          const withEmb: Array<Memory & { _score: number }> = []
          const withoutEmb: Array<Memory & { _score: number }> = []

          for (const row of rows) {
            const { embedding, ...mem } = row
            if (embedding != null) {
              const arr = new Float32Array(embedding.buffer, embedding.byteOffset, embedding.byteLength / 4)
              const score = this._cosine(queryEmb, arr)
              withEmb.push({ ...mem, _score: score })
            } else {
              withoutEmb.push({ ...mem, _score: 0 })
            }
          }

          withEmb.sort((a, b) => b._score - a._score)
          withoutEmb.sort((a, b) =>
            a.last_accessed_at < b.last_accessed_at ? 1 : a.last_accessed_at > b.last_accessed_at ? -1 : 0
          )

          const merged: Memory[] = [...withEmb, ...withoutEmb].map(({ _score, ...m }) => m as Memory)

          if (merged.length > 0) {
            const now = new Date().toISOString()
            const update = this.db.prepare(
              `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`
            )
            for (const row of merged) {
              update.run(now, row.id)
            }
          }

          return merged
        }
      } catch (err) {
        process.stderr.write(`[memory-store] recall re-ranking failed: ${err}\n`)
        // Fall through to keyword results
      }
    }

    // Keyword fallback (no embedding re-ranking)
    const cleanRows: Memory[] = rows.map(({ embedding, ...m }) => m as Memory)

    if (cleanRows.length > 0) {
      const now = new Date().toISOString()
      const update = this.db.prepare(
        `UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?`
      )
      for (const row of cleanRows) {
        update.run(now, row.id)
      }
    }

    return cleanRows
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
