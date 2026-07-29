# Proposal: Mission Control performance hardening

**Created:** 2026-07-29
**Status:** 🟡 Draft (rewritten 2026-07-29 around the materialized fact index, per operator)

## Problem

The Mission Control dashboard (`apps/mission-control`, Next.js 15) is largely unusable: pages hang or appear to crash on load. The operator suspected OOM from reading a large number of files, but investigation shows the corpus is small (539 MB across 2090 transcript `.jsonl` files, largest 4 MB) with **zero** OOM/heap errors in the journal. The real causes are three distinct problems:

1. **Duplicate zombie service.** Two systemd user units target port 3003: `mc-dashboard.service` (the real one, stable since 2026-07-23) and `mc-web.service` (points at a stale copy under `/home/openclaw/srv/mission-control`). `mc-web` loses the port race every time and restart-loops every 5s — **12,000+ restarts** — spamming the journal and burning CPU with a `node` spawn + `EADDRINUSE :::3003` crash on each tick.

2. **Every request re-derives everything from raw transcripts.** Heavy API routes read hundreds of transcript `.jsonl` files with synchronous `readFileSync` + full `.split('\n')` parse on **every request, with no caching or precomputation** (~218 routes, all `force-dynamic`). Measured live: `/api/tool-heatmap` 5.7s, `/api/turn-heatmap` 5.2s, `/api/metrics/momentum-index` 4.0s. Next.js serves from a single worker, so each slow request freezes every other request — including the SSE broadcaster's 5s tick, which *also* re-scans all transcripts. Concurrent page loads stack behind these multi-second blocks and the app reads as hung/crashed. The same raw lines are re-parsed thousands of times to answer the same questions.

3. **Auth is presence-only.** `middleware.ts` gates routes by checking that a `better-auth.session_token` cookie *exists*, never validating it. A request with a forged cookie (`Cookie: better-auth.session_token=test`) returns 200 with full fleet data on every endpoint — confirmed live. Anyone who reaches the origin can scrape the whole fleet's state.

Why it matters: the dashboard is the operator's window into the fleet; today it is effectively down, and it leaks fleet data to unauthenticated callers.

## Proposed Solution

Fix the ops and auth problems directly, and fix the performance problem at the root with a **materialized fact index** (knowledge-graph-style) inside the existing SQLite database — not per-request TTL caching.

1. **Kill the zombie.** `systemctl --user disable --now mc-web.service`. Confirm `mc-dashboard` remains the sole listener on 3003. Document the single-unit setup in the repo so the fix survives a rebuild.

2. **Materialized fact index in mc.db.** Half the plumbing already exists: `mc.db` is a 73 MB WAL-mode SQLite with 25 tables and an event pipeline, and `src/sse.ts` already tracks per-transcript read position (`toolLineTracker`). Build on that:
   - **Incremental ingester.** A background loop (extending the existing SSE tick) reads only *new* jsonl lines per transcript using persisted per-file offsets, and extracts facts: turns (start/end/duration), tool_use events (tool name, duration, outcome), token usage, session/project linkage, per-project per-day aggregates.
   - **Graph-ish schema.** Typed fact tables with foreign keys acting as edges — `mc_sessions` (project → session), `mc_turns` (session → turn), `mc_tool_calls` (turn → tool), plus pre-rolled `mc_daily_agg` (project × day × metric). Offsets in `mc_ingest_state`. Indexed on the query dimensions the routes actually use.
   - **One-time backfill.** On first boot after migration, walk all existing transcripts once (bounded concurrency, async IO) to populate history, then hand off to incremental mode.
   - **Migrate the hot routes.** tool-heatmap, turn-heatmap, momentum-index, metrics/[slug], turn-duration, capability-map, health-scorecard (and the SSE tick itself) become single indexed SELECTs. Expected: 4–6 s → single-digit ms, always ≤ one ingest-tick behind live. Routes stop touching transcripts entirely; no TTL staleness tradeoff.

3. **Validate the session.** Replace the presence-only check with real `better-auth` session validation — shared guard the API routes call (node runtime, guaranteed to work), middleware upgrade if the edge runtime allows.

## Scope

### In Scope
- Disable the `mc-web` duplicate systemd unit; document the correct single-unit setup.
- Fact-index schema + incremental ingester + one-time backfill in `apps/mission-control` (extends `src/db.ts` / `src/sse.ts` patterns).
- Migrate the ~7 measured-heaviest transcript-scanning routes + the SSE broadcaster tick onto the index.
- Real session validation (shared guard; middleware if runtime-compatible).
- Verify step: re-measure the same endpoints cold + warm, confirm forged-cookie → 401, confirm ingester keeps up (index lag ≤ tick interval) and backfill correctness (spot-check counts vs a direct transcript scan).

### Out of Scope
- Migrating all ~218 routes — the ~7 hot paths move now; the rest follow the established pattern in later changes.
- External graph/vector databases or new infra — SQLite stays the store.
- UI/UX changes to the dashboard pages.
- Auth provider changes beyond validating the existing `better-auth` session.
- Deleting the old transcript-reading helpers used by unmigrated routes.

## Impact

- **Files affected:** ~15–20 (estimated) — new `src/fact-index.ts` (schema + ingest + backfill), `src/db.ts`, `src/sse.ts`, `middleware.ts` + new shared auth guard, the ~7 hot route files, systemd/ops doc.
- **Complexity:** large (was medium with TTL cache; fact index is more work but a permanent fix)
- **Risk:** medium — ingester bugs would show stale/wrong metrics (mitigate: verify-step count spot-checks vs direct scan); backfill is a one-time heavy pass (mitigate: bounded concurrency, async); auth change could lock out sessions if wired wrong (mitigate: live login test before merge); zombie-kill is low-risk (it never successfully serves).

## Open Questions

1. **Which mc.db?** The unit sets `MC_DB_PATH=/home/openclaw/srv/mission-control-hub/mc.db`, but a second `mc.db` sits in the app dir (default path when env unset). Fact index should land in the env-configured one; worth deleting/ignoring the stray to avoid split-brain.
2. **Ingest cadence:** ride the existing 5s SSE tick, or a separate slower interval (15–30s) so ingest never competes with broadcast? Lean: separate interval, SSE reads the index.
3. **Schema shape:** typed tables (proposed) vs generic `nodes`/`edges` EAV. Lean typed — the query patterns are known and indexes matter more than flexibility.
4. **Backfill trigger:** automatic on first boot vs explicit migrate script (`bun run backfill`). Lean explicit — predictable, observable, re-runnable.
5. **Auth guard location:** confirm whether `better-auth` session validation runs on the edge runtime; if not, shared guard in hot routes now + follow-up for the rest.

---

**To proceed:** Review this proposal and approve to begin planning.
