# Spec: Idle-Gated Schedules

**Change:** idle-gated-schedules
**Created:** 2026-07-12
**Status:** 🟡 Draft

## Overview

Interval and daily schedules currently fire on a blind timer. When a fire lands while the target project's Claude session is mid-turn, the injected prompt queues as the *next* prompt and a second logical iteration starts immediately on top of state the first just changed (observed 2026-07-12: dstm-apps every-30m `/specclaw:loop` job double-picked a backlog item). This change adds an opt-in `onlyWhenIdle` gate: before firing, the scheduler asks the pool whether the target project is busy; if so, the fire is skipped and logged, and the schedule re-evaluates on subsequent ticks.

## Requirements

### Functional Requirements

- **FR1** — `Schedule` schema accepts optional `onlyWhenIdle: boolean` and `idleGraceMinutes: number` (positive integer). Both absent by default; existing `schedules.json` files load unchanged.
- **FR2** — `ProjectPool.isBusy(chatId, graceMs)` returns `true` iff the chat has a live process AND (an in-flight turn exists (`pendingDeliverAtMs() != null`) OR the session transcript was written within the last `graceMs`). No live process → `false`. Transcript mtime unknown and no in-flight turn → `false`.
- **FR3** — On a due tick, a schedule with `onlyWhenIdle: true` whose target is busy is **skipped**: `'skipped'` status appended to `schedule-log.jsonl` with `reason: "busy"`, `lastRunAt` NOT updated, `runCount` NOT incremented. The scheduler records `lastSkippedAt` on the schedule entry (persisted) so `schedule list` can surface it.
- **FR4** — A skipped interval job fires on a later tick once the target is idle (natural re-evaluation — `lastRunAt` untouched means it stays due). A skipped `at:` daily job retries every tick for the rest of the calendar day and fires on the first idle tick; if never idle that day, it skips to the next day.
- **FR5** — `!project schedule add` accepts `--only-when-idle` (boolean flag) and `--idle-grace <minutes>` (optional, requires `--only-when-idle`). The confirmation output mentions the gate.
- **FR6** — `!project schedule list` marks gated schedules (`⏸ idle-gated`) and shows `⏸ skipped (busy)` when the schedule's last outcome was a busy-skip (`lastSkippedAt` set and newer than `lastRunAt`).
- **FR7** — Default grace window is 5 minutes when `idleGraceMinutes` is unset.
- **FR8** — `SchedulerDeps` gains optional `isBusy?: (chatId: string, graceMs: number) => boolean`; when the dep is absent (e.g. tests, other embedders), gated schedules fire as if idle (fail-open).

### Non-Functional Requirements

- **NFR1** — Busy check is cheap: one map lookup + at most one `statSync` per gated due schedule per tick. No busy check for non-gated schedules.
- **NFR2** — Opt-in only: zero behavior change for existing schedules and for `schedule add` calls without the new flag.
- **NFR3** — Skip decisions are observable: scheduler diag log line, `schedule-log.jsonl` entry with reason, `schedule list` indicator.

## Acceptance Criteria

- **AC1** — `loadSchedules()` on a pre-existing `schedules.json` without the new fields parses successfully; a file with `onlyWhenIdle: true, idleGraceMinutes: 10` round-trips through save/load.
- **AC2** — Decision matrix (scheduler tick with mocked `isBusy`):
  - gated + busy → no deliver, `lastRunAt` unchanged, `runCount` unchanged, `lastSkippedAt` set
  - gated + idle → delivers, `lastRunAt`/`runCount` updated
  - non-gated + busy → delivers (gate not consulted)
  - gated + no `isBusy` dep → delivers (fail-open)
- **AC3** — `ProjectPool.isBusy`: returns false with no process; false with live process, no pending deliver, stale transcript; true with live process + fresh transcript mtime (< grace); true with live process + pending in-flight deliver; boundary — mtime exactly at grace → not busy (strict `<`).
- **AC4** — Skipped interval job delivers on the next tick where `isBusy` returns false (two-tick test: busy tick skips, idle tick fires).
- **AC5** — `schedule add <slug> --interval "every 30m" --prompt "x" --only-when-idle --idle-grace 10` persists `onlyWhenIdle: true, idleGraceMinutes: 10`; `schedule list` output contains `idle-gated`.
- **AC6** — After a busy-skip, `schedule list` row contains `skipped (busy)`; after a subsequent successful fire it no longer does.
- **AC7** — `bun tsc --noEmit` clean; all existing test suites stay green.

## Edge Cases

- Process alive but transcript mtime `null` (session id not yet captured, pre-first-turn) and no pending deliver → treated as idle (fire). The pending-deliver clause covers the just-delivered-not-yet-written window.
- `idleGraceMinutes` set without `onlyWhenIdle` → schema-valid but inert (documented; `schedule add` rejects `--idle-grace` without `--only-when-idle`).
- Busy-skip persists `lastSkippedAt` → schedules.json write on skip ticks; atomic save already handles concurrent safety.
- `autoSchedule` interval override composes: the gate reads `onlyWhenIdle` off the effective schedule (same entry, only interval overridden).
- Circuit-open / budget-exhausted chats: `deliver` already handles those downstream; the idle gate is independent and runs first.

## Dependencies

- `ClaudeProjectProcess.transcriptMtimeMs()` / `pendingDeliverAtMs()` — already implemented (`src/claude-process.ts:567-600`).
- `appendScheduleLog` `'skipped'` status — already in the union (`src/scheduler.ts:35`); gains an optional `reason` field.

## Notes

Resolves the proposal's open question: `at:` daily jobs retry every tick until idle for the remainder of the calendar day (no 2h cutoff — simpler, and `hasFiredToday` already prevents double-fires once it lands).
