# Design: Cross-Channel Memory Integration for MCD

**Change:** mcd-memory-integration  
**Created:** 2026-06-20

---

## Architecture

```
master Claude session
    │
    ├─ mcp__mcd__remember(slug, type, content)
    ├─ mcp__mcd__recall(query, slug?, type?, limit?)
    ├─ mcp__mcd__forget(id)
    └─ mcp__mcd__memory_stats()
         │
         ▼
MasterMcpServer (HTTP MCP)
         │
         ▼
MemoryStore (src/memory-store.ts)
    ├─ bun:sqlite → memory.db ($MCD_CHANNELS_DIR/memory.db)
    └─ EmbeddingProvider (lazy, @xenova/transformers)
              │
              ▼
         local model: Xenova/all-MiniLM-L6-v2
         cached at: $MCD_CHANNELS_DIR/.embedding-model/

scheduler → MemoryBackup (src/memory-backup.ts)
    └─ @aws-sdk/client-s3 (S3-compatible) → Cloudflare R2
```

---

## File Changes Map

| File | Change | Notes |
|------|--------|-------|
| `src/memory-store.ts` | CREATE | MemoryStore class: SQLite schema, CRUD, cosine sim recall, keyword fallback |
| `src/memory-backup.ts` | CREATE | R2 upload via S3 client; exported `backupMemory(config, dbPath)` |
| `src/master-mcp-server.ts` | MODIFY | Add 4 memory tools to ListTools + CallTool switch; pass `memoryStore` via opts |
| `src/channels-config.ts` | MODIFY | Add `MemoryConfigSchema` to `DefaultsSchema` |
| `src/master-commands.ts` | MODIFY | Add `memory` verb → `handleMemory()` with stats/backup/clear subverbs |
| `src/paths.ts` | MODIFY | Export `memoryDbFile()` → `join(channelsDir(), 'memory.db')` |
| `server.ts` | MODIFY | Instantiate `MemoryStore`, pass to `MasterMcpServer`; wire backup to scheduler |
| `templates/master.CLAUDE.md` | MODIFY | Add `# Memory` section |
| `package.json` | MODIFY | Add `@xenova/transformers`, `@aws-sdk/client-s3` |

---

## Key Decisions

### D1: `bun:sqlite` not `better-sqlite3`
Already used in `voice-db.ts`. No npm dep. Bun native. Consistent with existing patterns.

### D2: `MemoryStore` as a singleton passed via opts
`MasterMcpServer` already accepts optional deps via `MasterMcpServerOptions`. Add `memoryStore?: MemoryStore`. Same pattern as `getPool`, `executeMasterCommand`. Avoids global state.

### D3: Embeddings lazy, non-blocking
`@xenova/transformers` pipeline initialized on first `remember` call, not at bot startup. Stored as a promise to avoid double-init. If init fails, store without embedding.

### D4: Cosine similarity in JS (no native extension)
MiniLM produces 384-dim float32 vectors. Stored as BLOB (Float32Array.buffer). Similarity computed in pure JS — for up to 10K memories, worst case ~10ms. Acceptable for recall latency.

### D5: R2 backup uses existing scheduler
Add an interval schedule entry to `schedules.json` at bot startup if `defaults.memory.r2` is configured and no heartbeat backup schedule exists yet. Alternatively: wired directly in `server.ts` via a `setInterval`. Simpler: wire in `server.ts` directly — no schedule entry needed, no user-visible side effect.

### D6: No memory TTL in v1
Simple. Operator clears manually via `!project memory clear`. Add TTL in v2 if store grows unwieldy.

---

## MemoryStore API (TypeScript)

```typescript
class MemoryStore {
  constructor(dbPath: string, embeddingModelDir: string)

  async remember(slug: string | null, type: MemoryType, content: string): Promise<string> // returns id
  async recall(query: string, opts?: { slug?: string; type?: MemoryType; limit?: number }): Promise<Memory[]>
  forget(id: string): void
  stats(): MemoryStats  // { total, byType, bySlug }
  close(): void
}
```

## SQLite Schema

```sql
CREATE TABLE IF NOT EXISTS memories (
  id              TEXT PRIMARY KEY,
  channel_slug    TEXT,
  type            TEXT NOT NULL,
  content         TEXT NOT NULL,
  embedding       BLOB,
  created_at      TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  access_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memories_slug ON memories(channel_slug);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
```

---

## R2 Config Schema (channels.json)

```jsonc
"defaults": {
  "memory": {
    "backupIntervalHours": 6,  // 0 = disabled
    "r2": {
      "bucket": "mcd-memory",
      "endpoint": "https://<account>.r2.cloudflarestorage.com",
      "accessKeyIdEnv": "R2_ACCESS_KEY_ID",
      "secretAccessKeyEnv": "R2_SECRET_ACCESS_KEY"
    }
  }
}
```

---

## MCP Tool Schemas

```typescript
// remember
{ slug: z.string().optional(), type: MemoryTypeSchema, content: z.string().min(1) }

// recall
{ query: z.string().min(1), slug: z.string().optional(), type: MemoryTypeSchema.optional(), limit: z.number().int().min(1).max(50).default(10) }

// forget
{ id: z.string().min(1) }

// memory_stats — no args
```

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `@xenova/transformers` download fails in air-gapped env | Low | Keyword fallback, non-fatal |
| `memory.db` grows large (100K+ entries) | Low | No TTL v1, but recall stays fast with index; warn in stats if >5K |
| R2 credentials leak via channels.json | Medium | credentials stored as env var names, not values — same pattern as git-credentials |
| Cosine sim JS perf at 10K entries | Low | Benchmarked ~10ms — acceptable |
