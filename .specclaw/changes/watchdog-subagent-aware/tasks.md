# Tasks: Subagent-aware stuck-watchdog

**Change:** watchdog-subagent-aware
**Created:** 2026-05-13
**Total Tasks:** 5

## Summary

Five tasks across two waves. Wave 1 lands the interface and backends; Wave 2 lands the watchdog gate and tests. Wave 1 is parallelizable (3 files, no inter-dependencies); Wave 2 must follow.

## Tasks

### Wave 1 — Interface + backend plumbing

- [x] `T1` — Add `transcriptMtimeMs?()` to `ProjectProcess` interface; null impl in `MockProjectProcess`
  - Files: `src/project-process.ts`
  - Estimate: small
  - Depends: —
  - Notes: Optional method per ARCH conventions (see `pendingDeliverAtMs?()`). Doc comment matches spec FR1.

- [x] `T2` — Implement `transcriptMtimeMs()` on `ClaudeProjectProcess`
  - Files: `src/claude-process.ts`
  - Estimate: small
  - Depends: T1
  - Notes: Reuse the transcript-path recipe at `:823–828`. Read sessionId from in-memory state (do not re-read `.session-id` file on every call; cache via existing `sessionIdPersisted` path). Return `null` on any throw or missing sessionId.

- [x] `T3` — Add `progress-skip` to `PoolEvent` union and event-handler types
  - Files: `src/project-pool.ts` (event union near `:9`)
  - Estimate: small
  - Depends: —
  - Notes: Mirror existing `evict` / `stuck` event shape. Search for other call sites of `PoolEvent` and ensure exhaustive matches still compile (likely just `fireEvent` consumers in `server.ts`).

### Wave 2 — Watchdog gate + tests

- [x] `T4` — Gate `stuck` event on transcript-mtime check
  - Files: `src/project-pool.ts` (inside `evictIdle()` around `:178–184`)
  - Estimate: small
  - Depends: T1, T2, T3
  - Notes: Implement exactly per the FR4 + Architecture diagram. Wrap the `transcriptMtimeMs()` call in `try { ... } catch { return null }` to harden against backend bugs. Fire `progress-skip` before `continue`.

- [x] `T5` — Test cases for the gate
  - Files: `src/project-pool.test.ts`
  - Estimate: medium
  - Depends: T4
  - Notes:
    1. Extend `MockProjectProcess` test-only with a `setTranscriptMtimeMs(n)` hook.
    2. Three new sub-cases under §7:
       a. `pendingAt` stale + `transcriptMtimeMs` recent ⇒ no `stuck`, one `progress-skip`, process alive.
       b. `pendingAt` stale + `transcriptMtimeMs` returns `null` ⇒ `stuck` fires, process killed.
       c. `pendingAt` stale + `transcriptMtimeMs` returns stale ⇒ `stuck` fires, process killed.
    3. Run `bun test src/project-pool.test.ts` — all pass.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
