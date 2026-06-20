# Verification Report: mcd-memory-integration

**Verified:** 2026-06-20
**Model:** claude-sonnet-4-6
**Verdict:** PASS

## Acceptance Criteria

- ✅ **AC-1:** Master Claude calls `mcp__mcd__remember` and the memory persists across bot restart — `MemoryStore` opens SQLite with `{ create: true }` at `memoryDbFile()`; the INSERT in `remember()` is synchronous and committed before the method resolves; `server.ts` constructs a new `MemoryStore` at the same path on restart.

- ✅ **AC-2:** Master Claude calls `mcp__mcd__recall` with a query and gets relevant memories back — `recall()` performs `LIKE '%query%'` keyword search with optional cosine similarity re-ranking when the embedding pipeline is ready; results returned as JSON array via the `recall` MCP tool handler.

- ✅ **AC-3:** `!project memory stats` shows correct counts — `stats()` runs three SQL queries (`COUNT(*)`, `GROUP BY type`, `GROUP BY channel_slug`) and returns formatted reply; `if (!ctx.memoryStore)` guard is present.

- ✅ **AC-4:** `!project memory backup` uploads `memory.db` to R2 — two keys written (`memory-backups/memory-<timestamp>.db` and `memory-backups/latest.db`) via `@aws-sdk/client-s3`. `checkpoint()` called before read to flush WAL. *(Fixed: added `MemoryStore.checkpoint()` + call site in both manual and scheduled paths.)*

- ✅ **AC-5:** With no R2 config, backup is skipped silently — `handleMemory` checks `cfg.defaults.memory?.r2`; if absent, returns informational string with no exception thrown.

- ✅ **AC-6:** A project Claude session cannot call `mcp__mcd__remember` — double-guarded: (1) `ListToolsRequestSchema` only pushes memory tools when `chatId === getMasterChatId()`; (2) each `CallTool` case checks `getMasterChatId() !== chatId` and returns error.

- ✅ **AC-7:** Bot starts normally with no `memory.db` present — `new Database(dbPath, { create: true })` creates the file; schema uses `CREATE TABLE IF NOT EXISTS`; embedding pipeline init is fire-and-forget with errors caught.

- ✅ **AC-8:** Recall returns results sorted by relevance when embedding available, by recency otherwise — embedding path sorts by cosine similarity desc, fallback path uses `ORDER BY last_accessed_at DESC`.

## Test Results

14/14 memory-store tests PASS. All existing suite tests PASS (master-commands, project-pool, master-mcp-server). Typecheck clean.

## Issues Found

No blocking issues. Minor non-blocking notes for follow-up:
1. **Silent scheduled backup failures** — interval backup logs to stderr only; operator has no Discord notification on failure. Low priority; manual `!project memory backup` does surface errors.
2. **`recall('')` as list-all** — `memory clear` uses empty-string recall to enumerate records; works via `LIKE '%%'` but undocumented. Low priority.
3. **LIKE wildcard passthrough** — `%` and `_` in recall query act as SQL wildcards (not a security issue, parameters are bound). Low priority.

## Summary

**Passed:** 8/8 criteria
**Failed:** 0/8 criteria
**Verdict:** PASS
