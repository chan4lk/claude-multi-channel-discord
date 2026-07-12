# Spec: MCD Reliability Fixes

**Change:** mcd-reliability-fixes
**Created:** 2026-07-08
**Status:** 🟡 Draft

## Overview

Four targeted fixes to eliminate silent failure loops, improve session resume continuity, reduce heartbeat noise, and add stall detection for autonomous holding-pattern channels. All changes are additive or guard-only; no existing behavior is removed.

## Requirements

### Functional Requirements

**FR1 — Kill-loop detector and master alert**
- Pool tracks consecutive watchdog kills per `chatId` where no tool calls were made during that session's lifetime.
- After 3 consecutive such kills within a 2-hour sliding window, auto-respawn for that `chatId` is permanently paused.
- The master channel receives an alert: `⚠️ <slug>: killed 3× in a row with no tool calls — auto-respawn paused. Use \`!project start <slug>\` to resume.`
- Paused channels accept no further spawns until the operator sends `!project start <slug>` (existing verb clears the pause).
- Pause persists across server restarts (written to disk in `projects/<slug>/kill-loop-paused`).

**FR2 — Session UUID capture at watchdog-kill time**
- When `kill('watchdog')` fires, `ClaudeProjectProcess` attempts to resolve the session UUID from the transcript diff (same logic as `persistSessionAndRename`) before tearing down the tmux session.
- If a UUID is found and `.session-id` does not yet exist (i.e., `persistSessionAndRename` hadn't completed), write it to `.session-id`.
- This is best-effort: failures are non-fatal. Does not overwrite an already-persisted `.session-id`.

**FR3 — Heartbeat injection suffix guard**
- `buildInjectionMessage` skips the `Stay ${encouragement}` suffix when `contextSummary` is shorter than 20 characters.
- A short contextSummary produces: `Keep going with: <contextSummary>.` (no suffix).
- An empty contextSummary produces: `Keep making progress.` (no suffix, unchanged).

**FR4 — Stall detection for ScheduleWakeup holding-pattern loops**
- `classifyChannel` in `heartbeat.ts` gains a new stall reason: `'schedule-wakeup-loop'`.
- A channel is classified as stalled with this reason when the last N (≥3) tool_use entries in the transcript are all `ScheduleWakeup`, with no `mcp__mcd__reply` tool_use between any of them, AND the most recent user message (if any) is older than 2 hours.
- The master heartbeat scan surfaces this as an existing stall (same `state: 'stalled'` path already reported to master).

### Non-Functional Requirements

- NFR1: All fixes must be backward-compatible — no config schema changes required.
- NFR2: Kill-loop pause persists across restarts via a sentinel file (not in-memory only).
- NFR3: UUID capture at kill time must not add observable latency to the kill path (sync read, no retries, max 5ms).
- NFR4: Fix 3 must not change behavior when `contextSummary` is ≥ 20 characters.

## Acceptance Criteria

- **AC1:** After 3 watchdog kills with null tool calls for the same channel within 2h, a 4th inbound message does not spawn a new process — it is dropped (or queued per existing queue logic), and the master channel has received an alert.
- **AC2:** After a watchdog kill of a session that made no tool calls, if the transcript dir contains a new `.jsonl` file that appeared after spawn, that file's UUID is written to `.session-id` before the tmux session is torn down.
- **AC3:** `buildInjectionMessage` with `contextSummary = "done?"` (5 chars) produces a message without `Stay ` in it.
- **AC4:** `buildInjectionMessage` with `contextSummary = "implement the login endpoint"` (28 chars) still appends `Stay ${encouragement}` as before.
- **AC5:** A transcript whose last 3 tool_use calls are all `ScheduleWakeup` with no `mcp__mcd__reply` between them and last user message > 2h ago is classified as `state: 'stalled', reason: 'schedule-wakeup-loop'`.
- **AC6:** `!project start <slug>` on a kill-loop-paused channel clears the pause and allows the next message to spawn normally.
- **AC7:** Kill-loop pause sentinel file exists at `projects/<slug>/kill-loop-paused` after AC1 condition fires; removed after AC6 condition fires.

## Edge Cases

- **EC1 (Fix 1):** If operator manually kills a session 3 times (via `!project stop`), this should NOT count toward the kill-loop counter. Only watchdog kills count.
- **EC2 (Fix 1):** A session that makes one tool call resets the consecutive-null counter for that channel.
- **EC3 (Fix 2):** If `.session-id` already exists (written by `persistSessionAndRename` during a slow TUI-ready), do not overwrite. Check existence before writing.
- **EC4 (Fix 2):** If `preSpawnSessionIds` is empty (fresh project, no prior transcripts), don't attempt — `findNewSessionId` would match the very first session which may not be related.
- **EC5 (Fix 3):** Empty `encouragement` string (empty vocabulary) already falls through silently — no change needed.
- **EC6 (Fix 4):** A transcript with 3 `ScheduleWakeup` calls but a `mcp__mcd__reply` between the 1st and 2nd should NOT trigger the stall. The 3 consecutive ones must have no `mcp__mcd__reply` between them.
- **EC7 (Fix 4):** Channel with no transcript files returns `no-transcript` state — Fix 4 stall check is only reached when transcript exists.

## Dependencies

- Fix 1 requires access to `config.master.chatId` inside `ProjectPool` (already available via `opts.getConfig()`).
- Fix 2 requires access to `preSpawnSessionIds` and `projectCwd` at kill time — both are instance fields already populated.
- Fix 4 is purely additive to `classifyChannel` — no new dependencies.

## Notes

- Fix 1's "permanent pause" is cleared by the existing `!project start` verb, which calls `killChat()` and allows fresh spawning. The pause mechanism needs to gate `spawn()` in the pool — simplest: add `killLoopPaused: Set<string>` to pool state, check in `deliver()` before spawn.
- Fix 2 is intentionally sync (no retries) at kill time, unlike `persistSessionAndRename` which retries 6× with 500ms sleeps. We don't have time to wait at kill. If the transcript hasn't appeared yet, the kill-time capture misses and the session is lost — acceptable, same as today's behavior.
