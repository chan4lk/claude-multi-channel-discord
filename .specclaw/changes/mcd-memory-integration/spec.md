# Spec: Cross-Channel Memory Integration for MCD

**Change:** mcd-memory-integration  
**Created:** 2026-06-20

---

## Functional Requirements

### FR1 — Memory Store
- The bot maintains a persistent SQLite database at `$MCD_CHANNELS_DIR/memory.db`
- The store survives bot restarts
- Uses `bun:sqlite` (no npm dependency)

### FR2 — Memory Schema
Each memory record has:
- `id` — TEXT PRIMARY KEY (nanoid or timestamp-based)
- `channel_slug` — TEXT (null for global memories)
- `type` — TEXT: one of `channel_summary | decision | pattern | coordination | general`
- `content` — TEXT (free-form, written by master Claude)
- `embedding` — BLOB nullable (float32 array, local model)
- `created_at` — TEXT ISO-8601
- `last_accessed_at` — TEXT ISO-8601
- `access_count` — INTEGER default 0

### FR3 — MCP Tools (master channel only)
Four tools exposed exclusively to master Claude:

| Tool | Input | Output |
|------|-------|--------|
| `mcp__mcd__remember` | `slug?`, `type`, `content` | saved memory id |
| `mcp__mcd__recall` | `slug?`, `type?`, `query`, `limit?` (default 10) | array of matching memories |
| `mcp__mcd__forget` | `id` | ok |
| `mcp__mcd__memory_stats` | — | counts by type and slug |

### FR4 — Recall Strategy
- If embedding is available (model loaded): cosine similarity on `query` embedding vs stored embeddings, top-k
- Fallback (no model or no embedding on record): full-text LIKE search on `content`
- Results sorted by: relevance score desc, then `last_accessed_at` desc
- `last_accessed_at` and `access_count` updated on every recall hit

### FR5 — Local Embeddings
- `@xenova/transformers` package, model: `Xenova/all-MiniLM-L6-v2` (23 MB)
- Model downloaded on first use to `$MCD_CHANNELS_DIR/.embedding-model/`
- Embedding generated at write time (`remember`) and at query time (`recall`)
- Embedding errors are non-fatal: memory saved/queried without embedding

### FR6 — R2 Backup
- Backup uploads the raw `memory.db` file to Cloudflare R2
- Key pattern: `memory-backups/memory-{ISO-timestamp}.db`
- Also writes `memory-backups/latest.db` (overwrite) for easy restore
- Backup triggered by: scheduler interval (configurable, default 6h) OR `!project memory backup`
- Restore is manual: operator downloads `latest.db` and places it at `memory.db` path
- R2 config in `channels.json` under `defaults.memory.r2`; missing config = backup silently skipped

### FR7 — Operator Commands
`!project memory stats` — print counts by type and channel slug  
`!project memory backup` — trigger immediate R2 backup  
`!project memory clear [--slug SLUG] [--type TYPE]` — delete matching memories (requires `--yes`)

### FR8 — Master CLAUDE.md guidance
Template updated with a concise `# Memory` section documenting the 4 MCP tools and when to use them (heartbeat writes, inject writes, recall before coordinating).

---

## Non-Functional Requirements

- NFR1: `remember` latency < 100ms (sync write, embedding async)
- NFR2: `recall` latency < 500ms for stores up to 10,000 entries
- NFR3: `memory.db` never blocks bot startup (open lazily on first use)
- NFR4: All memory operations are master-channel-only; project Claude sessions cannot call these tools
- NFR5: R2 backup failure must not propagate to bot crash — log and continue
- NFR6: Embedding model download is lazy and non-blocking to bot startup

---

## Acceptance Criteria

- AC1: Master Claude calls `mcp__mcd__remember` and the memory persists across bot restart
- AC2: Master Claude calls `mcp__mcd__recall` with a query and gets relevant memories back
- AC3: `!project memory stats` shows correct counts
- AC4: `!project memory backup` uploads `memory.db` to R2 (verifiable in R2 dashboard)
- AC5: With no R2 config, backup is skipped silently (no error in Discord)
- AC6: A project Claude session cannot call `mcp__mcd__remember` (tool not listed for non-master sessions)
- AC7: Bot starts normally with no `memory.db` present (first-run creates it)
- AC8: Recall returns results sorted by relevance when embedding available, by recency otherwise

---

## Edge Cases

- `memory.db` corrupted: open fails → log error → memory tools return errors, bot continues
- Embedding model download fails (no internet): `remember` saves without embedding; `recall` uses keyword fallback
- R2 credentials wrong: backup logs error, returns error text to `!project memory backup` caller
- `recall` with empty store: returns empty array, no error
- `forget` with unknown id: returns ok (idempotent)
- Very long `content` (>10KB): stored as-is, embedding truncated to model max tokens (512 tokens for MiniLM)
