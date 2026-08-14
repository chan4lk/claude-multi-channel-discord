# Tasks: Idle-evict turn guard

**Change:** idle-evict-turn-guard
**Created:** 2026-07-25
**Total Tasks:** 4

## Summary

Two waves. Wave 1 implements the two guards in parallel (different files, no contention). Wave 2 adds tests + docs on top.

## Tasks

### Wave 1 — Guards

- [x] `T1` — Guard A: turn-completion clears pending deliver in ClaudeProjectProcess
  - Files: src/claude-process.ts
  - Estimate: small
  - Kind: impl
  - Notes: Private `noteTurnComplete(durationMs: number | null)`: no-op when `_pendingDeliverAt === null`; else push `durationMs ?? Date.now() - _pendingDeliverAt` into `turnHistory` (respect MAX_TURN_HISTORY), clear `_pendingDeliverAt`, bump `_lastActivity`, `this.log('turn-complete (no reply)')`. In transcript watcher per-line loop (before the `obj.message` guard): `type === 'system' && subtype === 'turn_duration'` ⇒ `noteTurnComplete(durationMs ?? null)`, continue. Relax the watcher early-return `toolProgressHandlers.size === 0 && limitHitHandlers.size === 0` to also require `_pendingDeliverAt === null` before skipping, so detection works with progressMode off (FR2). Existing seek-to-end-on-path-change already guards against replayed historical events.

- [x] `T2` — Guard B: idle-evict transcript veto + evict-skip event
  - Files: src/project-pool.ts
  - Estimate: small
  - Kind: impl
  - Notes: Extend PoolEvent union with `{ kind: 'evict-skip'; chatId: string; slug: string; sinceActivityMs: number; sinceTranscriptMs: number }`. In `evictIdle()` idle branch (~line 425): read `proc.transcriptMtimeMs()` defensively (feature-detect + try/catch, same style as watchdog branch above it); `mtime !== null && mtime >= idleCutoff` ⇒ fire `evict-skip` with both deltas, `continue`; else evict exactly as today. Check server.ts pool-event sink handles unknown kinds generically (it logs JSON) — adjust only if an exhaustive switch breaks.

### Wave 2 — Tests + docs

- [x] `T3` — Mock hook + unit tests
  - Files: src/project-process.ts, src/project-pool.test.ts
  - Estimate: medium
  - Kind: test
  - Depends: T1, T2
  - Notes: `MockProjectProcess.completeTurn(durationMs?: number)` mirroring noteTurnComplete semantics (clear `_pendingDeliverAt`, push into turnHistory, bump `_lastActivity`). Tests following existing check style in project-pool.test.ts: AC1 completeTurn ⇒ `pendingDeliverAtMs()` null + no `stuck` event on next `evictIdle()` sweep + turnHistory fed (assert via `adaptiveThresholdMs(base)` change); AC3 idle-past-cutoff + fresh transcript mtime ⇒ `evict-skip` fired, no kill; AC4 idle + stale/null transcript ⇒ `evict` + kill as before; AC5 pending deliver + stale transcript past threshold ⇒ `stuck` + kill unchanged. AC2 (watcher early-return with zero handlers) is claude-process-internal: document verified-by-review in a comment near the new tests.

- [x] `T4` — Docs: watchdog + idle-evict sections
  - Files: CLAUDE.md, ARCHITECTURE.md
  - Estimate: small
  - Kind: docs
  - Depends: T1, T2
  - Notes: Watchdog section gains Guard A (turn_duration clears pending deliver → completed no-reply turns are never "stuck"). Idle-evict/pool docs gain Guard B (transcript-freshness veto + evict-skip event). Mention observed incidents (2026-07-25 specclaw mid-build evict, dstm-apps hourly heartbeat kill-loop) briefly as rationale.
