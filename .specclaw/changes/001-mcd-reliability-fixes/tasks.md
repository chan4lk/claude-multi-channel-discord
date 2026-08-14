# Tasks: MCD Reliability Fixes

**Change:** mcd-reliability-fixes
**Created:** 2026-07-08
**Total Tasks:** 5

## Summary

5 tasks across 3 waves. Waves 1–2 are independent (fix 3 + fix 2 have no shared state). Wave 3 is fix 1 (largest, needs pool state additions) + fix 4 (heartbeat extension). Tests for each fix are included in the same task.

## Tasks

### Wave 1 — Quick wins (no interface changes)

- [x] `T1` — Guard heartbeat injection suffix against short contextSummary
  - Files: `src/behaviour-mirror.ts`
  - Estimate: small
  - Depends: —
  - Notes: Change the `Stay ${encouragement}` suffix so it only appends when `contextSummary.length >= 20`. Also remove the suffix from the empty-contextSummary path (`Keep making progress.` should never get `Stay X, Y`). See design.md Fix 3 for exact code. Add/update unit test in `behaviour-mirror` (inline or new file).

- [x] `T2` — Capture session UUID at watchdog-kill time
  - Files: `src/claude-process.ts`
  - Estimate: small
  - Depends: —
  - Notes: In `kill('watchdog')`, before the `spawnSync('tmux', ['kill-session', ...])` call, attempt `findNewSessionId(this.projectCwd, this.preSpawnSessionIds)`. If found and `.session-id` does not yet exist, write it (mode 0600). Guard: only run when `!this.sessionIdPersisted && this.projectCwd && this.preSpawnSessionIds.size > 0`. Set `this.sessionIdPersisted = true` and `this.observedSessionId = sid` on success. See design.md Fix 2.

### Wave 2 — Heartbeat stall detection

- [x] `T3` — Add ScheduleWakeup holding-pattern stall reason to heartbeat classifier
  - Files: `src/heartbeat.ts`
  - Estimate: small
  - Depends: —
  - Notes: Add `'schedule-wakeup-loop'` to `ChannelState['reason']` union. In `classifyChannel`, after the tool-incomplete check (around line 148), add the wakeup-loop detection: scan entries in reverse for tool_use blocks, count consecutive `ScheduleWakeup` with no `mcp__mcd__reply` between them; if count ≥ 3 and `ageMins >= 120`, set `stalledReason = 'schedule-wakeup-loop'`. See design.md Fix 4 for algorithm. No changes to caller — `scanChannels` already surfaces `stalled` entries to master.

### Wave 3 — Kill-loop detector

- [x] `T4` — Add kill-loop detector, deliver gate, and master alert to pool
  - Files: `src/project-pool.ts`
  - Estimate: medium
  - Depends: —
  - Notes: Full implementation per design.md Fix 1. Steps:
    1. Add private fields: `spawnedAtMs: Map<string, number>`, `lastToolProgressMs: Map<string, number>`, `nullKillTracker: Map<string, { count: number; windowStart: number }>`, `killLoopPaused: Set<string>`.
    2. In `spawn()`: set `spawnedAtMs.set(chatId, this.now())`.
    3. In `spawn()` cleanup callback (where `offToolProgress` is wired): update `lastToolProgressMs.set(chatId, this.now())` on each tool-progress event.
    4. In `evictIdle()`, before `proc.kill('watchdog')`: check null-tool-call condition, increment counter, maybe pause + alert. See full logic in design.md.
    5. In `deliver()`, after project lookup: check `killLoopPaused.has(chatId)` → log + return early.
    6. In `killChat()`: call `this.clearKillLoopPause(chatId)`.
    7. Add private `clearKillLoopPause(chatId)`: deletes from set + removes sentinel file.
    8. Add private `setKillLoopPause(chatId, slug)`: adds to set + writes sentinel + posts master alert.
    9. In constructor: scan existing `kill-loop-paused` sentinel files to restore paused state on restart.
    10. Add `kill-loop-paused` and `kill-loop-resumed` to `PoolEvent` union.
    11. Fire `kill-loop-paused` event from `setKillLoopPause`, fire `kill-loop-resumed` from `clearKillLoopPause`.

- [x] `T5` — Tests for kill-loop detector
  - Files: `src/project-pool.test.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Depends: T4
  - Notes: In `project-pool.test.ts`:
    - Test: 3 watchdog kills with no tool calls → `killLoopPaused` set, `kill-loop-paused` event fired, master alert sent via onReply.
    - Test: Kill with a tool call resets the counter.
    - Test: 4th deliver after pause is dropped (onReply not called for that chatId).
    - Test: `killChat('requested')` on a paused channel clears the pause.
    Use existing `MockProjectProcess` pattern. Override `now()` to control the 2h window.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
