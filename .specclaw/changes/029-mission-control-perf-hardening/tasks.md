# Tasks: Mission Control performance hardening

**Change:** mission-control-perf-hardening
**Created:** 2026-07-29
**Total Tasks:** 10

## Summary

Build a materialized fact index in `mc.db` (schema + pure parser + incremental offset-based ingester), migrate the seven heaviest transcript-scanning routes and the SSE tick to query it, close the auth hole with the existing `requireSession()`, and disable the duplicate `mc-web` systemd unit. Four waves: foundation → ingester → migrate+secure → ops/cleanup. Verify is handled by `/specclaw:verify`.

## Tasks

### Wave 1 — Foundation (schema + parser)

- [x] `T1` — Fact-index schema + query helpers
  - Files: `apps/mission-control/src/fact-index.ts`
  - Estimate: medium
  - Kind: impl
  - Notes: Create `mc_turn`, `mc_tool_call`, `mc_ingest_state` tables + indexes idempotently against the `src/db.ts` singleton (honors `MC_DB_PATH`). Add read helpers the routes need: `toolCounts({sinceMs})`, `turnDurations({slug, sinceMs})`, `turnHourDowBuckets({sinceMs})`, `monthlyTokens({slug, yearMonth})`. Follow `src/db.ts` prepared-statement style.

- [x] `T2` — Pure transcript-line parser
  - Files: `apps/mission-control/src/fact-index.ts`, `apps/mission-control/src/fact-index.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: `parseTranscriptLines(slug, sessionFile, lines[]) → { turns[], toolCalls[] }` — pure, no IO, injectable. Extract turn ts/duration/tokens from `assistant` records + `turn_duration` system events; tool calls from `tool_use` blocks excluding `mcp__mcd__*` (mirror `sse.ts:133`). Tests: correct extraction, malformed-line skip, empty input. Plain `bun` PASS/FAIL test per context.md.

### Wave 2 — Ingester

- [x] `T3` — Incremental offset-based ingester
  - Files: `apps/mission-control/src/fact-index.ts`
  - Estimate: large
  - Kind: impl
  - Depends: T1, T2
  - Notes: `ingestOnce(mcdDir, {now})` — read channels.json slugs, realpath-encode each transcript dir (invariant `7b99786`), for each `.jsonl` read bytes from `mc_ingest_state.byte_offset` to EOF via `fs/promises` with bounded concurrency, parse, INSERT rows + upsert offset in one transaction per file. Truncation (size < offset): DELETE prior rows for that `session_file`, reset offset 0. In-flight guard to prevent overlapping runs. First run (no offsets) backfills.

- [x] `T4` — Ingester tests (resume, idempotency, truncation, parity)
  - Files: `apps/mission-control/src/fact-index.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T3
  - Notes: temp dir + fake transcripts + temp `MC_DB_PATH`. Assert: double-run leaves counts stable (AC5), appended lines ingested on next run (AC6), truncation/rotation no double-count, index tool counts == direct-scan counts for a window (AC2).

- [x] `T5` — Boot wiring + backfill script
  - Files: `apps/mission-control/instrumentation.ts`, `apps/mission-control/scripts/backfill.ts`, `apps/mission-control/package.json`
  - Estimate: small
  - Kind: config
  - Depends: T3
  - Notes: `register()` starts a `setInterval(ingestOnce, INGEST_INTERVAL_MS ?? 30_000)` guarded by `process.env.NEXT_RUNTIME === 'nodejs'`; kick one immediate run at boot in the background. `scripts/backfill.ts` = observable one-shot `ingestOnce`; add `"ingest:backfill"` to package.json scripts.

### Wave 3 — Migrate routes + secure

- [x] `T6` — Migrate the 7 hot routes to the index + `requireSession()`
  - Files: `apps/mission-control/app/api/tool-heatmap/route.ts`, `app/api/turn-heatmap/route.ts`, `app/api/metrics/momentum-index/route.ts`, `app/api/metrics/[slug]/route.ts`, `app/api/turn-duration/route.ts`, `app/api/capability-map/route.ts`, `app/api/health-scorecard/route.ts`
  - Estimate: large
  - Kind: refactor
  - Depends: T1, T3
  - Notes: Each route: call `requireSession()` first (return the 401 if non-null), then replace transcript scans with `fact-index` query helpers. **Preserve exact response JSON shape** (diff against current output). health-scorecard: only the activity/token portions move to the index; memory-dir/specclaw fs reads may remain.

- [x] `T7` — SSE tick + `computeMonthlyTokensUsed` read the index
  - Files: `apps/mission-control/src/sse.ts`, `apps/mission-control/src/fleet-compute.ts`
  - Estimate: medium
  - Kind: refactor
  - Depends: T3
  - Notes: `checkToolEvents` emits tool events from recent `mc_tool_call` rows (drop the full-file read + in-memory `toolLineTracker`); `computeMonthlyTokensUsed` sums `mc_turn` tokens for the current year-month. No transcript opens in the broadcaster (AC10).

### Wave 4 — Ops & cleanup

- [x] `T8` — Disable duplicate service + ops doc
  - Files: `apps/mission-control/MISSION-CONTROL-OPS.md`
  - Estimate: small
  - Kind: docs
  - Notes: Document that `mc-dashboard.service` is the single unit on port 3003, the `systemctl --user disable --now mc-web.service` step, and `MC_DB_PATH`. The disable command itself is an operator/Hermes deploy action (can't restart from inside MCD), recorded here so it survives rebuilds.

- [x] `T9` — Remove + gitignore stray app-dir mc.db
  - Files: `apps/mission-control/.gitignore`, (delete) `apps/mission-control/mc.db*`
  - Estimate: small
  - Kind: config
  - Notes: Ensure app never writes a second DB when `MC_DB_PATH` is set; ignore `mc.db`, `mc.db-shm`, `mc.db-wal` in the app dir. Confirm nothing imports a hardcoded `./mc.db`.

- [x] `T10` — Typecheck + full app test pass
  - Files: (verification only)
  - Estimate: small
  - Kind: test
  - Depends: T6, T7
  - Notes: `bun tsc --noEmit` clean; run existing `apps/mission-control` tests + the new `fact-index.test.ts`. Gate for `/specclaw:verify` (AC9).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Kind: docs | test | config | refactor | impl | migration   (optional)
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
