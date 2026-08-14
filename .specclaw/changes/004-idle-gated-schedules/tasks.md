# Tasks: Idle-Gated Schedules

**Change:** idle-gated-schedules
**Created:** 2026-07-12
**Total Tasks:** 4

## Summary

Core plumbing first (schema + gate + pool probe, parallelizable), then tests for the decision matrix, then the operator-facing command surface with its tests and the full gate.

## Tasks

### Wave 1 — Core plumbing

- [x] `T1` — Schema fields (`onlyWhenIdle`, `idleGraceMinutes`, `lastSkippedAt`) in `ScheduleSchema`; `SchedulerDeps.isBusy?` + busy-gate in `Scheduler.tick()` (skip path: diag log, `appendScheduleLog` with `reason: "busy"`, `lastSkippedAt` stamp, no `lastRunAt`/`runCount` mutation); optional `reason` param on `appendScheduleLog`
  - Files: src/schedules-config.ts, src/scheduler.ts
  - Estimate: medium
- [x] `T2` — `ProjectPool.isBusy(chatId, graceMs)` (alive + pendingDeliver-or-fresh-transcript, per design) + wire `isBusy` dep into `new Scheduler({...})` in server.ts
  - Files: src/project-pool.ts, server.ts
  - Estimate: small

### Wave 2 — Tests + command surface

- [x] `T3` — Create `src/scheduler.test.ts`: tick decision matrix (AC2: gated+busy / gated+idle / non-gated+busy / no-dep fail-open; AC4: skip-then-fire two-tick; AC1: schema round-trip) with tmp `MCD_CHANNELS_DIR`; add `isBusy` matrix (AC3 incl. grace boundary) to `src/project-pool.test.ts` using `MockProjectProcess`
  - Files: src/scheduler.test.ts, src/project-pool.test.ts
  - Estimate: medium
  - Depends: T1, T2
- [x] `T4` — `scheduleAdd`: `--only-when-idle` + `--idle-grace` (reject `--idle-grace` alone); `scheduleList`: `⏸ idle-gated` + `⏸ skipped (busy)` indicators; help text; tests for AC5/AC6 in `src/master-commands.test.ts`; run full gate (all suites + `bun tsc --noEmit`)
  - Files: src/master-commands.ts, src/master-commands.test.ts
  - Estimate: medium
  - Depends: T1

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
