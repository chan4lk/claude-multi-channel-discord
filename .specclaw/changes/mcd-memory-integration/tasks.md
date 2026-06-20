# Tasks: Cross-Channel Memory Integration for MCD

**Change:** mcd-memory-integration
**Created:** 2026-06-20
**Total Tasks:** 10

## Summary

4 waves. Wave 1 is foundation (no external deps). Wave 2 adds embeddings and R2 backup. Wave 3 wires MCP tools and operator commands. Wave 4 wires server, updates docs, and adds tests.

## Tasks

### Wave 1 — Foundation

- [x] `T1` — Add memoryDbFile() to paths.ts
  - Files: `src/paths.ts`
  - Estimate: small
  - Depends: —
  - Notes: Export `memoryDbFile()` returning `join(channelsDir(), 'memory.db')`. Follow existing helper pattern (e.g. `channelsFile`, `credsFile`).

- [x] `T2` — Add MemoryConfigSchema to channels-config.ts
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Depends: —
  - Notes: Add `MemoryConfigSchema = z.object({ backupIntervalHours: z.number().int().nonnegative().default(6), r2: z.object({ bucket: z.string(), endpoint: z.string().url(), accessKeyIdEnv: z.string(), secretAccessKeyEnv: z.string() }).optional() }).optional()`. Add `memory: MemoryConfigSchema` to `DefaultsSchema`. All optional, safe defaults.

- [x] `T3` — Create src/memory-store.ts
  - Files: `src/memory-store.ts`
  - Estimate: medium
  - Depends: T1
  - Notes: `MemoryStore` class using `bun:sqlite`. Schema: `memories(id TEXT PK, channel_slug TEXT, type TEXT, content TEXT, embedding BLOB, created_at TEXT, last_accessed_at TEXT, access_count INTEGER DEFAULT 0)`. Indexes on channel_slug and type. Methods: `remember(slug|null, type, content): string` (returns id, id format `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`), `recall(query, opts?:{slug?,type?,limit?}): Memory[]` (keyword LIKE fallback only — no embeddings yet), `forget(id): void`, `stats(): {total,byType,bySlug}`, `close(): void`. `last_accessed_at` and `access_count` updated on recall hits. MemoryType = `'channel_summary'|'decision'|'pattern'|'coordination'|'general'`.

### Wave 2 — Embeddings + Backup

- [x] `T4` — Add embedding support to memory-store.ts
  - Files: `src/memory-store.ts`, `package.json`
  - Estimate: medium
  - Depends: T3
  - Notes: Add `@xenova/transformers` to package.json. Lazy-init pipeline in MemoryStore constructor using dynamic import (avoids startup cost). Model: `Xenova/all-MiniLM-L6-v2`, cache dir: `join(channelsDir(), '.embedding-model')`. On `remember`: generate embedding, store as BLOB (`Buffer.from(Float32Array.of(...embedding).buffer)`). On `recall`: if embedding available, compute cosine similarity for all rows that have embedding, sort desc, return top-k. Fall back to LIKE if model not loaded or query embedding fails. Errors non-fatal: log to stderr, continue without embedding.

- [x] `T5` — Create src/memory-backup.ts
  - Files: `src/memory-backup.ts`, `package.json`
  - Estimate: medium
  - Depends: T1, T2
  - Notes: Add `@aws-sdk/client-s3` to package.json. Export `interface R2Config { bucket: string; endpoint: string; accessKeyId: string; secretAccessKey: string }` and `async function backupMemory(config: R2Config, dbPath: string): Promise<string>` (returns uploaded key). Use `S3Client` with `endpoint` override and `region: 'auto'`. Upload raw db file bytes. Keys: `memory-backups/memory-${new Date().toISOString().replace(/[:.]/g,'-')}.db` and `memory-backups/latest.db`. No-op (return '' early) when config is null. Throws on upload failure so caller can handle.

### Wave 3 — MCP Tools + Operator Commands

- [x] `T6` — Add memory MCP tools to master-mcp-server.ts
  - Files: `src/master-mcp-server.ts`
  - Estimate: medium
  - Depends: T3
  - Notes: Add `memoryStore?: MemoryStore` to `MasterMcpServerOptions`. In `ListToolsRequestSchema` handler, when `memoryStore` present AND session is master channel, add 4 tools: `remember` (args: slug? string, type string, content string), `recall` (args: query string, slug? string, type? string, limit? number default 10), `forget` (args: id string), `memory_stats` (no args). In `CallToolRequestSchema` switch, add cases for all 4. Guard each with master-only check (same pattern as `inject` and `run_master_command`). Return JSON-stringified results.

- [x] `T7` — Add memory verb to master-commands.ts
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Depends: T3, T5
  - Notes: Add `'memory'` to MUTATION_VERBS. Add `case 'memory': return { kind: 'reply', text: await handleMemory(rest, ctx) }`. Implement `handleMemory(rest, ctx)`: subverbs: `stats` (calls `ctx.memoryStore?.stats()`, formats output), `backup` (resolves R2 config from channels.json defaults, calls `backupMemory()`, reports key or error), `clear [--slug S] [--type T] --yes` (deletes matching rows via direct SQL, requires --yes flag). Add `memoryStore?: MemoryStore` and `backupMemory?: () => Promise<string>` to `MasterContext`. Update help text.

### Wave 4 — Wiring, Docs, Tests

- [x] `T8` — Wire MemoryStore in server.ts
  - Files: `server.ts`
  - Estimate: medium
  - Depends: T3, T5, T6, T7
  - Notes: Import `MemoryStore` from `./src/memory-store.ts` and `backupMemory` from `./src/memory-backup.ts`. After channels dir is confirmed (after `loadChannelsConfig()` succeeds), instantiate `const memoryStore = new MemoryStore(memoryDbFile(), join(channelsDir(), '.embedding-model'))`. Pass `memoryStore` to `MasterMcpServer` opts and to `buildMutator()` / `MasterContext`. Start R2 backup interval: if `defaults.memory?.backupIntervalHours > 0` and `defaults.memory?.r2` present, call `setInterval(() => backupMemory(r2Config, memoryDbFile()).catch(err => process.stderr.write(...)), hours * 60 * 60 * 1000)` — fire-and-forget. In shutdown handler: `memoryStore.close()`. Update `buildMutator` to pass `memoryStore` and a `backupFn` closure into `MasterContext`.

- [x] `T9` — Update templates/master.CLAUDE.md and deploy
  - Files: `templates/master.CLAUDE.md`, `projects/master/CLAUDE.md`
  - Estimate: small
  - Depends: T6
  - Notes: Add concise `# Memory` section after the `# Heartbeat` section. Document: `mcp__mcd__remember(slug?, type, content)` — save a memory; `mcp__mcd__recall(query, slug?, type?, limit?)` — retrieve relevant memories; `mcp__mcd__forget(id)` — delete; `mcp__mcd__memory_stats()` — counts. When to use: after heartbeat scan save channel summaries (type=channel_summary); after inject save what and why (type=coordination); before coordinating a channel recall its history. Deploy: copy template to `projects/master/CLAUDE.md` (overwrite).

- [x] `T10` — Tests for memory-store.ts
  - Files: `src/memory-store.test.ts`
  - Estimate: medium
  - Depends: T3, T4
  - Notes: Create `src/memory-store.test.ts`. Use a temp db path (`/tmp/test-memory-${Date.now()}.db`). Tests: (1) remember returns an id, recall finds it by keyword; (2) forget removes the record, subsequent recall returns empty; (3) stats returns correct counts by type and slug; (4) recall with slug filter only returns matching slug; (5) remember with null slug works; (6) store opens cleanly on first run (no db file). Close and delete temp db after each test. Follow pattern from existing test files (bun test runner, `import { test, expect } from 'bun:test'`).
