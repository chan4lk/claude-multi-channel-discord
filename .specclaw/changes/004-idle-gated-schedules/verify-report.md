# Verify Report: idle-gated-schedules

**Date:** 2026-07-12
**Verdict:** PASS

## Acceptance Criteria

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 — `loadSchedules()` on legacy file parses; new fields round-trip through save/load | ✅ | scheduler.test.ts AC1a/AC1b checks (7) all PASS. Schema at `src/schedules-config.ts:61-65`. |
| AC2 — Decision matrix: gated+busy→skip; gated+idle→deliver; non-gated+busy→deliver; gated+no-dep→fail-open | ✅ | scheduler.test.ts AC2a–AC2d checks (10) all PASS. Gate at `src/scheduler.ts:165-173`. |
| AC3 — `ProjectPool.isBusy` matrix incl. strict `<` grace boundary | ✅ | project-pool.test.ts tests 19–23 all PASS. Implementation `src/project-pool.ts:462-468`. |
| AC4 — Skipped interval job fires on next idle tick (two-tick test) | ✅ | scheduler.test.ts AC4 checks (6) all PASS; `lastRunAt` untouched on skip keeps schedule due. |
| AC5 — `--only-when-idle --idle-grace 10` persists; list shows `idle-gated`; `--idle-grace` alone rejected | ✅ | master-commands.test.ts idle-gated checks (8) all PASS. |
| AC6 — `skipped (busy)` shown after busy-skip, absent after later successful fire | ✅ | master-commands.test.ts AC6 checks (2) all PASS. |
| AC7 — `bun tsc --noEmit` clean; all existing suites green | ✅ | tsc zero errors; all suites below pass. |

## Test Results

```
bun src/scheduler.test.ts         → PASS  23/23 checks
bun src/project-pool.test.ts      → PASS  61/61 checks  (isBusy: tests 19-23)
bun src/master-commands.test.ts   → PASS  82/82 checks  (idle-gated: 10 new checks)
bun src/master-mcp-server.test.ts → PASS  11/11 checks
bun src/specclaw-status.test.ts   → PASS  25/25 checks
bun src/memory-store.test.ts      → PASS  9/9 checks    (sharp warning: pre-existing, non-blocking)
bun tsc --noEmit                  → PASS  (zero errors)
```

## Notes

- Default 5-min grace (FR7) confirmed at `src/scheduler.ts:166`.
- `SchedulerDeps.isBusy` optional; absent dep fail-opens at `src/scheduler.ts:165`.
- `appendScheduleLog` optional `reason` field at `src/scheduler.ts:35,169`.
- `lastSkippedAt` persisted via existing atomic `saveSchedules` on skip ticks.
- `sharp` native module warning in memory-store tests is pre-existing infrastructure noise.
