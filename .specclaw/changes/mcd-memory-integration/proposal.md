# Proposal: Cross-Channel Memory Integration for MCD

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

Master Claude has no persistent memory across sessions. Each restart starts cold — it has no recall of:
- What other channels have been working on
- Decisions made in previous sessions
- Patterns of stalls or recurring issues per channel
- Context it injected into channels and whether it worked

This limits the heartbeat watchdog and coordinator role: master can observe and inject, but can't learn from history or coordinate intelligently across channels over time.

## Proposed Solution

Add a lightweight, zero-cost, self-hosted memory layer that persists cross-channel observations across bot restarts. Master Claude reads and writes memory via new MCP tools exposed by the master MCP server.

### Architecture

**Storage:** SQLite (already on disk, zero infra cost) with a `memories` table.  
- Schema: `(id, channel_slug, type, content, embedding BLOB, created_at, last_accessed_at, access_count)`  
- Types: `channel_summary` | `decision` | `pattern` | `coordination`  
- Optional vector embeddings via `@xenova/transformers` (runs locally, zero API cost) for semantic search — graceful degradation to keyword search if not available.

**Backup:** Periodic export of the SQLite DB to Cloudflare R2 via the official `@aws-sdk/client-s3` SDK (R2 exposes an S3-compatible API). Configurable interval (default: every 6 hours). Triggered by the scheduler. R2 free tier: 10 GB storage, 1M Class A ops/month — ample for memory blobs.

**MCP tools added to master MCP server:**
- `mcp__mcd__remember` — save a memory (`slug`, `type`, `content`)
- `mcp__mcd__recall` — retrieve memories (`slug?`, `type?`, `query?`, `limit`)
- `mcp__mcd__forget` — delete a memory by id
- `mcp__mcd__memory_stats` — count/summary of stored memories

**Where memory gets written:**
- Heartbeat: after each scan, master saves per-channel summaries (`channel_summary` type)
- Inject: after injecting into a channel, master saves what it injected and why (`coordination` type)
- Manual: master Claude can call `mcp__mcd__remember` any time the operator shares context

**Where memory gets read:**
- On each heartbeat prompt, the scheduled prompt is augmented: "First call mcp__mcd__recall to check prior context for stalled channels, then run the heartbeat scan."
- On manual operator questions about a channel's history

### mem0 evaluation

mem0 open-source (`mem0ai/mem0`) is a Python library that wraps vector DBs with an opinionated memory API. It adds significant setup complexity (Python runtime, qdrant/chroma/pgvector backend). For this use case — structured per-channel summaries, not semantic document search — a direct SQLite approach is simpler, zero-dependency, and equally capable. mem0 is ruled out for v1; revisit if semantic search across large memory corpora becomes needed.

### R2 backup config

```jsonc
// channels.json defaults
"defaults": {
  "memory": {
    "backupIntervalHours": 6,
    "r2": {
      "bucket": "<bucket-name>",
      "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
      "accessKeyIdEnv": "R2_ACCESS_KEY_ID",
      "secretAccessKeyEnv": "R2_SECRET_ACCESS_KEY"
    }
  }
}
```

R2 credentials loaded from env at bot startup. Backup is fire-and-forget; failures log but don't crash.

## Scope

### In Scope
- `src/memory-store.ts` (CREATE) — SQLite-backed memory store; CRUD + keyword search; optional embedding support
- `src/memory-backup.ts` (CREATE) — R2 backup/restore via `@aws-sdk/client-s3`
- `src/master-mcp-server.ts` — add `remember`, `recall`, `forget`, `memory_stats` tools (master-only)
- `src/channels-config.ts` — add `memory` config section to zod schema
- `src/master-commands.ts` — add `!project memory stats/clear/backup` operator commands
- `src/scheduler.ts` — trigger R2 backup on interval schedule
- `templates/master.CLAUDE.md` — document memory tools and when to use them
- `package.json` — add `@aws-sdk/client-s3` (R2 backup); optionally `better-sqlite3` if not already present
- Memory DB path: `~/.claude/channels/discord-multi/memory.db`

### Out of Scope
- mem0, qdrant, chroma, or any external vector DB
- Semantic embedding search in v1 (keyword search only; embedding is additive)
- Memory across different MCD instances / shared memory between operators
- Per-project Claude memory (only master has memory tools in v1)
- R2 restore-on-startup (manual restore via `!project memory restore` operator command)
- Memory TTL / auto-expiry in v1

## Impact

| Area | Estimate |
|------|----------|
| New files | 2 (`memory-store.ts`, `memory-backup.ts`) |
| Modified files | 4 (`master-mcp-server.ts`, `channels-config.ts`, `master-commands.ts`, `templates/master.CLAUDE.md`) |
| Complexity | Medium |
| Risk | Low — additive only; no existing paths modified destructively |
| Cost | $0 (SQLite local, R2 free tier for backup) |

## Open Questions

1. **Embedding support:** Include `@xenova/transformers` for local embeddings in v1 or defer? Adds ~50MB model download on first use but enables semantic recall.
2. **Memory DB location:** Co-locate with `channels.json` at `MCD_CHANNELS_DIR/memory.db` or separate configurable path?
3. **R2 backup format:** Upload raw `.db` file or export to JSON for human readability? Raw `.db` is trivially restorable; JSON is inspectable but requires import logic.
4. **Master CLAUDE.md guidance:** How prescriptive should the instructions be about when master MUST write vs MAY write memories?
