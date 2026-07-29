# Design: Mission Control performance hardening

**Change:** mission-control-perf-hardening
**Created:** 2026-07-29

## Technical Approach

Introduce a `src/fact-index.ts` module that owns three concerns: (1) the fact-table schema (created idempotently at import, same pattern as `src/db.ts`), (2) a pure transcript-line parser that turns jsonl records into fact rows, and (3) an incremental, offset-based ingester. The ingester runs on an interval started from `instrumentation.ts` at server boot; the first run naturally backfills because every file's offset starts unset. The seven hot routes and the SSE tick are rewritten to query the fact tables. The auth hole is closed by calling the already-existing `requireSession()` at the top of each hot route. The duplicate systemd unit is disabled at deploy and the single-unit setup documented.

Granular event rows (one per turn, one per tool call) rather than pre-aggregated daily tables: at 539 MB / ~2090 files the row counts are modest, indexed `GROUP BY` is sub-millisecond, and granular rows support any time window the routes ask for without a rollup-invalidation problem.

## Architecture

**Ingest path (off the request path):**
```
instrumentation.ts register()  → startIngester()
   every INGEST_INTERVAL_MS (default 30s), if not already in-flight:
      ingestOnce(mcdDir):
        slugs = read channels.json
        for each slug (bounded concurrency, fs/promises):
           transcriptDir = ~/.claude/projects/<realpath-encoded cwd>
           for each *.jsonl file:
              off = mc_ingest_state[file]?.byte_offset ?? 0
              if fileSize < off  → off = 0            (truncation reset)
              read bytes [off .. EOF]  → split lines
              parseTranscriptLines(slug, file, lines) → {turns[], toolCalls[]}
              INSERT rows in one transaction
              upsert mc_ingest_state[file] = {byte_offset: EOF, mtime, slug}
```

**Read path (request time):**
```
GET /api/tool-heatmap → requireSession() → SELECT tool_name, COUNT(*) FROM mc_tool_call
                                            WHERE ts_ms >= ? GROUP BY slug, tool_name  → same JSON shape
```

**SSE tick:** `checkToolEvents` / `computeMonthlyTokensUsed` become index queries; the broadcaster no longer opens transcripts.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `apps/mission-control/src/fact-index.ts` | Create | Schema (`mc_turn`, `mc_tool_call`, `mc_ingest_state` + indexes), `parseTranscriptLines()` (pure), `ingestOnce()`, `startIngester()`, and query helpers (`toolCounts()`, `turnBuckets()`, `monthlyTokens()`, etc.) |
| `apps/mission-control/src/fact-index.test.ts` | Create | Unit tests: parser correctness, offset resume/idempotency, truncation reset, malformed-line skip, count-vs-scan parity |
| `apps/mission-control/instrumentation.ts` | Modify | Call `startIngester()` in `register()` (node runtime only) |
| `apps/mission-control/app/api/tool-heatmap/route.ts` | Modify | `requireSession()` + query `mc_tool_call` instead of scanning transcripts |
| `apps/mission-control/app/api/turn-heatmap/route.ts` | Modify | `requireSession()` + query `mc_turn` (hour×dow buckets) |
| `apps/mission-control/app/api/metrics/momentum-index/route.ts` | Modify | `requireSession()` + tokens/turns from index |
| `apps/mission-control/app/api/metrics/[slug]/route.ts` | Modify | `requireSession()` + per-project 7-day metrics from index |
| `apps/mission-control/app/api/turn-duration/route.ts` | Modify | `requireSession()` + durations from `mc_turn` |
| `apps/mission-control/app/api/capability-map/route.ts` | Modify | `requireSession()` + tool blocks from `mc_tool_call` |
| `apps/mission-control/app/api/health-scorecard/route.ts` | Modify | `requireSession()` + activity/token portions from index (memory/specclaw fs reads may remain) |
| `apps/mission-control/src/sse.ts` | Modify | `checkToolEvents` / `computeMonthlyTokensUsed` (in `fleet-compute.ts`) read the index |
| `apps/mission-control/src/fleet-compute.ts` | Modify | `computeMonthlyTokensUsed` sources tokens from the index |
| `apps/mission-control/scripts/backfill.ts` | Create | Standalone `bun run` entry that calls `ingestOnce()` once for an observable manual/first backfill |
| `apps/mission-control/package.json` | Modify | Add `"ingest:backfill"` script |
| `apps/mission-control/.gitignore` | Modify | Ignore the stray app-dir `mc.db*` |
| `apps/mission-control/MISSION-CONTROL-OPS.md` | Create | Document the single systemd unit (`mc-dashboard`), the `mc-web` disable, and `MC_DB_PATH` |

## Data Model Changes

New tables in `mc.db` (created idempotently, WAL already on):

```sql
CREATE TABLE IF NOT EXISTS mc_turn (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  session_file TEXT NOT NULL,
  ts_ms        INTEGER NOT NULL,
  duration_ms  INTEGER,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mc_turn_slug_ts ON mc_turn(slug, ts_ms);

CREATE TABLE IF NOT EXISTS mc_tool_call (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  session_file TEXT NOT NULL,
  ts_ms        INTEGER NOT NULL,
  tool_name    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mc_tool_slug_ts   ON mc_tool_call(slug, ts_ms);
CREATE INDEX IF NOT EXISTS idx_mc_tool_slug_name ON mc_tool_call(slug, tool_name);

CREATE TABLE IF NOT EXISTS mc_ingest_state (
  file        TEXT PRIMARY KEY,   -- absolute transcript path
  slug        TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  mtime_ms    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

De-dup safety: ingest keys off `byte_offset` per file (only ever reads past the last byte). No natural unique key is needed on the fact tables because a line is parsed at most once. Truncation (fileSize < offset) resets that file to 0; because the whole file is re-read, its previously-ingested rows would double — so a truncation reset also DELETEs prior rows for that `session_file` before re-ingesting (keeps AC5 idempotency under rotation).

## API Changes

No new endpoints and no response-shape changes — the seven routes keep their exact output contracts (verified against current `Response.json({...})` bodies). The only externally-visible behavior change is that unauthenticated calls now get 401 instead of 200 (FR6 / AC3), which is the intended fix.

## Key Decisions

1. **Fact index over TTL cache.** A per-request TTL cache (the v1 proposal) only masks the cost and still pays it every TTL expiry with a full scan. The index removes transcript reads from the request path entirely and stays ≤ one interval fresh. (Operator directive 2026-07-29: "rewrite" around the knowledge-graph/index idea.)
2. **Granular rows, not daily rollups.** Simpler schema, arbitrary windows, no rollup invalidation; justified by small corpus. (context.md — "Simplicity First": "if three tasks could be one, make it one.")
3. **Offset-based incremental ingest reusing the proven `toolLineTracker` idea**, promoted from in-memory (`src/sse.ts:18`) to a persisted table so it survives restarts and drives backfill for free.
4. **Boot via `instrumentation.ts`.** `register()` runs once, node runtime — correct place to start the interval; keeps ingest out of request handlers.
5. **Auth via existing `requireSession()`.** `src/security.ts:15` already validates `auth.api.getSession`; wiring it into the hot routes is the minimal correct fix. Middleware stays a coarse gate (edge runtime can't run better-auth's node validation). (context.md — "Defense in depth on MCP tools: tool listing AND call handler check the same gate independently" — same principle: the route validates, not just the edge.)
6. **Single `mc.db`.** Import the `src/db.ts` singleton everywhere so `MC_DB_PATH` is honored; delete + gitignore the stray app-dir copy (open question 1).

## Risks & Mitigations

- **Ingester miscounts vs transcripts** → AC2 parity test compares index counts to a direct scan for a sample window before merge; parser is pure and unit-tested.
- **Backfill first-run is heavy** → bounded concurrency + `fs/promises`, run from `instrumentation` in the background (non-blocking) and/or the explicit `ingest:backfill` script; page serving is unaffected because ingest never runs in a request handler.
- **Session rotation double-counts on truncation** → truncation reset DELETEs prior `session_file` rows before re-ingest (see Data Model).
- **Auth change locks out real users** → live login smoke test in verify (AC4) before merge; middleware login redirect unchanged.
- **`instrumentation.ts` runs in both edge and node** → guard `startIngester()` behind `process.env.NEXT_RUNTIME === 'nodejs'`.
- **Disabling `mc-web` is low risk** — it never successfully binds 3003; the only effect is stopping the crash loop.

## Grounding sources

- `.specclaw/context.md` — "Coding Style & Conventions: tests are plain `bun src/<name>.test.ts` scripts with PASS/FAIL check lines (no test framework)" → `fact-index.test.ts` follows that form. "Injectable side effects … clocks (`now`) … so tests never launch real processes" → parser/ingester take an injectable clock + root dir for testability.
- `apps/mission-control/src/security.ts:15` — `requireSession()` docstring: "middleware.ts only checks that a session cookie is *present* — it does not verify the token. Any route that performs a privileged or mutating action must call this" → FR6 wiring.
- `apps/mission-control/src/sse.ts:18` — `toolLineTracker` per-file line-count tracking → promoted to `mc_ingest_state`.
- `apps/mission-control/src/fleet-compute.ts:202` — `computeMonthlyTokensUsed` full-transcript scan → replaced by index query (FR5).
