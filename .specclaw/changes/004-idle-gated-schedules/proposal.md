# Proposal: Idle-Gated Schedules

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

Interval schedules fire on a blind timer. On 2026-07-12 the dstm-apps channel ran an every-30m `/specclaw:loop` schedule (job `s_mrh5i44t_11t5ru`) while the previous loop turn was still mid-build. The scheduler injected the next `/specclaw:loop` prompt into tmux mid-turn — the text queues as the *next* prompt, so when the running turn finishes, a second loop iteration starts immediately on top of state the first iteration just changed. Consequences observed and expected:

- Duplicate backlog item pick-up (two loop turns both read BACKLOG.md's first unchecked item)
- Wasted tokens re-planning work already in flight
- Confusing progress output interleaving two logical iterations

The scheduler already has a `'skipped'` status in `appendScheduleLog` (`src/scheduler.ts:35`) and `ClaudeProjectProcess` already exposes `transcriptMtimeMs()` and `lastActivityMs()` (`src/claude-process.ts:567-585`) — the ingredients exist but are not wired together.

## Proposed Solution

Add an optional `onlyWhenIdle` boolean to the schedule schema. When true, the scheduler checks the target project's activity before firing:

1. If the project has a live process in the pool AND its transcript was written within the last `idleGraceMinutes` (default 5), **skip** this fire: log `'skipped'` to the schedule log with reason `busy`, do NOT increment `runCount`, do NOT update `lastRunAt` (so an `at:`-style daily job still fires later that day when idle — for interval jobs the next tick re-evaluates naturally).
2. Otherwise fire as normal.

Surface the flag in `!project schedule add ... --only-when-idle` and show a `⏸ skipped (busy)` line in `schedule list` output when the last log entry was a busy-skip.

## Scope

### In Scope
- `src/schedules-config.ts`: `onlyWhenIdle: z.boolean().optional()`, `idleGraceMinutes: z.number().optional()`
- `src/scheduler.ts`: busy-check hook before fire (injected via `SchedulerDeps` so tests can mock pool state)
- `src/master-commands.ts`: `--only-when-idle` flag on `schedule add`, indicator in `schedule list`
- Tests: fire-vs-skip decision matrix (idle, busy, no process, grace boundary)

### Out of Scope
- Queueing skipped fires for later replay (next interval tick covers it)
- Cross-project busy checks
- Applying the gate by default to existing schedules (opt-in only)

## Impact

- **Files affected:** 4 (estimated)
- **Complexity:** small
- **Risk:** low — opt-in flag, no behavior change for existing schedules

## Open Questions

- Should `at:` (daily HH:MM) jobs retry within a window (e.g. up to 2h after scheduled time) when busy, or just skip to tomorrow? Proposal: retry each tick until fired or window closed.

---

**To proceed:** Review this proposal and approve to begin planning.
