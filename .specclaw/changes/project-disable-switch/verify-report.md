# Verify Report: project-disable-switch
**Date:** 2026-07-26
**Verdict:** PASS

## Command evidence

```
bun src/project-pool.test.ts      — all checks passed (includes tests 28–29 for AC1/AC2)
bun src/master-commands.test.ts   — all checks passed (includes set --disabled on/off, list, show)
bun src/scheduler.test.ts         — all checks passed (PD-1/PD-2, AP-disabled, BW-disabled, AC12a/b, AC13a–d, AC14a/b, enabledAt baseline)
bun src/master-mcp-server.test.ts — all checks passed (AC6-disabled: ask_project to disabled target)
bun src/bot-peers.test.ts         — all checks passed (regression)
bun src/shared-learnings.test.ts  — all checks passed (regression)
bun src/backlog.test.ts           — all 81 checks passed (regression)
bun tsc --noEmit                  — clean (zero output)
```

## Acceptance criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | MET | `channels-config.ts:333` `disabled: z.boolean().optional()`; `:340` `enabledAt`; `:458` `defaults.autoDisable` `.strict().optional()`. Pool test 29 parse checks pass |
| AC2 | MET | `project-pool.ts:151–157`: disabled gate before killLoopPaused (159), circuit (165), budget (180), dedup (195). Pool test 28: no spawn, event fired with correct chatId+slug, no rejected event |
| AC3 | MET | `master-commands.ts:952–968`: `on` sets `disabled: true`, removes `enabledAt`, calls `ctx.mutator.killProject` (same path as `stop`); `off` removes key, stamps ISO `enabledAt`. All 5 related test checks pass |
| AC4 | MET | `master-commands.ts:764–767`: master target → `'master channel cannot be disabled'`, config unchanged (tested) |
| AC5 | MET | `master-commands.ts:760–761`: non-on/off value → usage error (tested) |
| AC6 | MET | `scheduler.ts:241–248`: skip + `appendScheduleLog(..., 'skipped', 0, 'project disabled')` + `lastSkippedAt`; dep optional/fail-open (`:139`). Tests PD-1/PD-2 pass |
| AC7 | MET | `scheduler.ts:579–580` (autopilot) + `:707–708` (backlog-watch): `if (project.disabled) continue`. AP-disabled/BW-disabled tests pass |
| AC8 | MET | `master-mcp-server.ts:674–675`: `errorResult('target project is disabled')`; AC6-disabled tests pass (isError, nothing delivered) |
| AC9 | MET | `master-commands.ts:276` (`⛔` in list) + `:303` (`disabled: yes` in show); 4 test checks pass |
| AC10 | MET (code-inspected) | `server.ts:1836–1837` throttle map + `:1473` 5-min gate; no server test harness exists — logic self-contained and structurally correct |
| AC11 | MET | tsc clean; all 7 suites green |
| AC12 | MET | `scheduler.ts:837–853`: idle 8d > 7d → save with `disabled: true`, `enabledAt` removed, `onAutoDisable` called; idle 2d → no save (AC12a/b tests) |
| AC13 | MET | `scheduler.ts:813–827`: skips master / already-disabled / `autoDisable: false` / no transcript (AC13a–d tests) |
| AC14 | MET | `scheduler.ts:804–805`: `if (!auto?.enabled) return` (AC14a/b tests) |
| AC15 | MET (code-inspected) | Auto-disable writes the identical `disabled: true` flag (no `disabledBy` field exists); same `set --disabled off` path re-enables both. Off-path tests pass |

## Context-rules compliance

- All new project fields `.optional()` (opt-in convention, NFR1); `defaults.autoDisable` `.strict().optional()` like backlogWatch.
- Injectable side effects respected: `transcriptMtimeFor` + `nowMs` injectors on the sweep; `isProjectDisabled` optional fail-open scheduler dep.
- Master audit pattern: `onAutoDisable` → master notice via `routeNotification`.
- Gate is O(1), no extra IO (NFR2).

## Gaps / notes

- AC10 throttle verified by code inspection only (no server.ts test harness exists in repo).
- FR14 notice text is `idle <idleDays>d+` (threshold with `+`) rather than exact elapsed days — at-least semantics, accepted.
- AC15 covered structurally (single-flag design), no dedicated end-to-end auto-disable→re-enable test.

## Summary

**Passed:** 15/15 criteria
**Failed:** 0/15
**Verdict:** PASS
