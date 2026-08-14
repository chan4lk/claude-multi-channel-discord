# Spec: Mission Control performance hardening

**Change:** mission-control-perf-hardening
**Created:** 2026-07-29
**Status:** 🟡 Draft

## Overview

Mission Control (`apps/mission-control`) re-derives every metric from raw transcript `.jsonl` files on each request with synchronous IO and no precomputation. On a single-worker Next.js server this blocks the event loop for 4–6s per heavy route (measured: tool-heatmap 5.7s, turn-heatmap 5.2s, momentum-index 4.0s), so concurrent requests and the 5s SSE tick stall behind it and the app reads as crashed. Separately, a duplicate systemd unit (`mc-web`) restart-loops on the same port, and route auth checks cookie presence only.

This change fixes the performance problem at its root by building an incremental **materialized fact index** in the existing SQLite database (`mc.db`), so the hot routes answer from indexed SELECTs instead of scanning transcripts. It also disables the duplicate service and closes the auth hole using the session validator that already exists in the codebase (`src/security.ts` `requireSession`).

Not OOM: corpus is 539 MB / 2090 files (largest 4 MB), zero heap errors in the journal.

## Requirements

### Functional Requirements

- **FR1 — Incremental ingest.** A background ingester parses only *new* content per transcript file, using a persisted per-file offset. Re-running never re-parses already-ingested lines.
- **FR2 — Fact tables.** Granular fact rows are stored in `mc.db`: one row per turn (slug, timestamp, duration, input/output tokens, session file) and one row per non-MCD tool call (slug, timestamp, tool name, session file), indexed on the dimensions the routes query (`slug`, `ts_ms`, `tool_name`).
- **FR3 — Backfill + resume.** On first run (empty offsets) the ingester walks all existing transcripts once to populate history; subsequent runs resume from the stored offset. Ingesting is idempotent — running it twice yields identical row counts.
- **FR4 — Routes read the index.** The seven measured-heaviest routes (`tool-heatmap`, `turn-heatmap`, `metrics/momentum-index`, `metrics/[slug]`, `turn-duration`, `capability-map`, `health-scorecard`) answer from `mc.db` SELECTs and perform **no** transcript reads at request time. Response shapes are unchanged (drop-in for the existing frontends).
- **FR5 — SSE tick reads the index.** The 5s broadcaster's transcript work (`checkToolEvents`, `computeMonthlyTokensUsed`) is served from the index rather than re-reading full transcripts each tick.
- **FR6 — Real auth on hot routes.** The seven routes validate the session via `requireSession()`; an absent/forged/expired cookie returns 401, a valid session returns 200.
- **FR7 — Single service.** The duplicate `mc-web.service` is disabled; `mc-dashboard.service` is the sole listener on port 3003. The correct single-unit setup is documented in the repo.
- **FR8 — One database.** The fact index writes to the `MC_DB_PATH`-configured database (`/home/openclaw/srv/mission-control-hub/mc.db`); the stray default-path `mc.db` in the app directory is removed and git-ignored to prevent split-brain.

### Non-Functional Requirements

- **NFR1 — Latency.** Warm p50 for each of the seven routes < 200 ms (from 4–6 s).
- **NFR2 — Freshness.** Index lag ≤ one ingest interval (target ≤ 30 s); acceptable because the SSE stream still pushes live fleet deltas.
- **NFR3 — Non-blocking ingest.** Ingester uses async IO (`fs/promises`) with bounded concurrency and never holds the event loop long enough to stall request serving; a single in-flight guard prevents overlapping ticks.
- **NFR4 — No new infra.** SQLite (`better-sqlite3`) remains the only store; no external graph/vector DB, no new services.
- **NFR5 — No behavior regressions.** `bun tsc --noEmit` clean; existing app tests still pass; existing response JSON shapes preserved.

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

- **AC1** — A warm `GET /api/tool-heatmap` (and turn-heatmap, momentum-index) returns in < 200 ms and with the same JSON shape as before.
- **AC2** — Fact-index counts for tool-heatmap / momentum tokens match a direct transcript scan of the same window within a documented tolerance (exact for tool counts; tokens exact).
- **AC3** — Each of the seven routes returns 401 for a request with a forged cookie (`Cookie: better-auth.session_token=bogus`) and for no cookie.
- **AC4** — Each of the seven routes returns 200 with data for a valid logged-in session.
- **AC5** — Running the ingester twice over the same transcripts leaves row counts unchanged (idempotent; offsets resume).
- **AC6** — Appending new turns/tool calls to a transcript makes them queryable in the index within one ingest interval.
- **AC7** — After deploy, `mc-web.service` is disabled and `ss -tlnp` shows only `mc-dashboard` on port 3003.
- **AC8** — Only the `MC_DB_PATH` database is written by the app; the app-dir `mc.db` is gone and git-ignored.
- **AC9** — `bun tsc --noEmit` passes and existing `bun` tests pass.
- **AC10** — The SSE broadcaster tick no longer calls the full-transcript scan functions; verified by code inspection + a test asserting it queries the index.

## Edge Cases

- **Session resume creates a new `.jsonl`.** Offsets are keyed by file path; a new session file starts at offset 0 and is ingested fresh. The old file keeps its final offset.
- **Transcript truncated / shrinks** (offset > current size): reset that file's offset to 0 and re-ingest.
- **Symlinked project dirs**: realpath before encoding the transcript directory (existing invariant, commit `7b99786`).
- **Malformed jsonl line**: skip the line, continue the file — never abort ingest on one bad record.
- **Project deleted**: stale index rows remain (harmless for aggregates); pruning is out of scope.
- **Master project**: excluded from stall/heatmap sets exactly where current logic excludes it.
- **Overlapping ingest ticks** (slow tick still running when the next fires): an in-flight guard skips the new tick.
- **Empty / missing transcript dir**: skip the project, no error.
- **Backfill cost**: the first run reads every transcript once; it must run with bounded concurrency and off the request path so it cannot stall page serving.

## Dependencies

- Existing `mc.db` SQLite via `src/db.ts` (respects `MC_DB_PATH`).
- Existing `requireSession()` in `src/security.ts` (uses `auth.api.getSession`).
- Existing offset-tracking pattern in `src/sse.ts` (`toolLineTracker`).
- Next.js `instrumentation.ts` `register()` hook (node runtime) to start the ingester at boot.
- Operator action at deploy to disable the `mc-web` systemd unit (documented in the change).

## Notes

- The frontend components are untouched; this is a data-layer + auth + ops change.
- Only the seven hot routes migrate this round; the remaining ~211 routes keep their current transcript-reading helpers and follow the same index pattern in later changes (out of scope).
- Granular event rows (not pre-rolled daily aggregates) are stored because SQLite `GROUP BY` over indexed `(slug, ts_ms)` is millisecond-fast at this corpus size and keeps the schema minimal while supporting arbitrary windows.
