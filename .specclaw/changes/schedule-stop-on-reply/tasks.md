# Tasks: Schedule Auto-Pause on Reply Pattern (stopOnReply)

**Change:** schedule-stop-on-reply
**Created:** 2026-07-12
**Total Tasks:** 4

## Summary

Schema + scheduler core first, then the server tap and the CLI surface (parallel), then tests + full gate.

## Tasks

### Wave 1 — Core

- [x] `T1` — `stopOnReply` field with regex-compile validation in `ScheduleSchema`; `Scheduler.noteReply(chatId, text)` + `SchedulerDeps.onAutoPause?` (match → `enabled=false`, persist, diag log, hook; skip when `lastRunAt` null, disabled, or pattern fails to compile at runtime)
  - Files: src/schedules-config.ts, src/scheduler.ts
  - Estimate: medium

### Wave 2 — Wiring + surface + tests

- [x] `T2` — server.ts: `scheduler?.noteReply(...)` tap in pool `onReply` (before platform branch, text replies only); `onAutoPause` dep posting `⏸ schedule <id> (<slug>) auto-paused — reply matched /<pattern>/` to master channel (reuse existing master-notice helper if one exists)
  - Files: server.ts
  - Estimate: small
  - Depends: T1
- [x] `T3` — `noteReply` test matrix in `src/scheduler.test.ts`: AC2 case-insensitive match → disabled+persisted+hook once; AC3 no-match; AC4 never-fired ignored; AC5 already-disabled ignored; AC1 schema round-trip + invalid-regex rejection; FR8 runtime bad pattern skips without throw
  - Files: src/scheduler.test.ts
  - Estimate: medium
  - Depends: T1
- [x] `T4` — `scheduleAdd`: `--stop-on-reply` flag (compile-validate, usage error on bad regex); `scheduleList`: `⏹ stop-on-reply /<pattern>/` suffix; help text; AC6 tests in `src/master-commands.test.ts`; run full gate (all suites + `bun tsc --noEmit`)
  - Files: src/master-commands.ts, src/master-commands.test.ts
  - Estimate: medium
  - Depends: T1

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
