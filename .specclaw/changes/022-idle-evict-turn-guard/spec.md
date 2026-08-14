# Spec: Idle-evict turn guard — don't kill sessions mid-turn or post-turn

**Change:** idle-evict-turn-guard
**Created:** 2026-07-25

## Functional Requirements

**FR1 — Turn-completion clears the pending-deliver flag.**
When the session transcript records a completed turn (`type: "system", subtype: "turn_duration"` event) while `_pendingDeliverAt` is set, `ClaudeProjectProcess` must treat the turn as answered: clear `_pendingDeliverAt`, push the observed turn duration into `turnHistory` (feeding the adaptive threshold), and bump `_lastActivity`. A session that finishes its turn without calling the reply tool is idle-by-choice, not stuck.

**FR2 — Turn-completion detection is independent of progress handlers.**
The transcript watcher currently early-returns when no tool-progress/limit handlers are subscribed. Turn-completion detection (FR1) must run whenever a deliver is pending, regardless of handler subscriptions (i.e. also for projects with `progressMode: "off"`).

**FR3 — Idle-evict transcript veto.**
`ProjectPool.evictIdle()` must not idle-evict a process whose transcript was written within the idle window: when `proc.transcriptMtimeMs()` returns a value `>= idleCutoff`, skip the kill and emit an `evict-skip` pool event (`{ kind: 'evict-skip', chatId, slug, sinceActivityMs, sinceTranscriptMs }`).

**FR4 — Null/stale transcript preserves existing behavior.**
When `transcriptMtimeMs` is absent, throws, or returns null or a value older than the idle cutoff, idle-evict proceeds exactly as today.

**FR5 — Watchdog behavior for genuinely stuck sessions unchanged.**
A session with a pending deliver, no turn-completion event, and a stale transcript is still watchdog-killed at the effective threshold (including null-kill / kill-loop accounting).

## Non-Functional Requirements

**NFR1 —** No new config surface; no schema changes.
**NFR2 —** Per-sweep cost stays O(1) statSync per process (no new file reads in the pool; turn detection rides the existing 2s transcript poll's incremental read).
**NFR3 —** `MockProjectProcess` gains matching test hooks without changing its public constructor contract.

## Acceptance Criteria

- **AC1:** Transcript records `turn_duration` after a deliver ⇒ `pendingDeliverAtMs()` returns null on next read; watchdog never fires for that episode; turn duration lands in `turnHistory`.
- **AC2:** AC1 holds with zero tool-progress/limit subscribers (progressMode off).
- **AC3:** Idle process (lastActivity older than idleEvictMinutes) with transcript mtime inside the window ⇒ no kill; `evict-skip` event emitted with `sinceActivityMs` and `sinceTranscriptMs`.
- **AC4:** Same idle process with transcript mtime outside the window (or null / method absent) ⇒ `evict` event + kill, as today.
- **AC5:** Pending deliver + no turn-completion + stale transcript past effective threshold ⇒ `stuck` event + watchdog kill, as today.
- **AC6:** Existing suites pass: `bun src/project-pool.test.ts`, `bun src/master-commands.test.ts`, `bun src/master-mcp-server.test.ts`, `bun tsc --noEmit`.

## Edge Cases

- `turn_duration` line from a *resumed* historical transcript must not clear a fresh pending deliver: the watcher already seeks to end-of-file on path change, so only new events are parsed. Covered by existing seek behavior; no extra logic.
- Multiple deliver→turn cycles in one poll window: each `turn_duration` clears the then-pending flag; a deliver arriving after the last completed turn re-arms it (ordering follows transcript append order).
- Session continuously writing transcript never idle-evicts (accepted: watchdog owns stuck-but-writing; `!project stop` / pool-full LRU still available).
- `acceptReply` and turn-completion racing: both clear `_pendingDeliverAt`; double-clear is harmless (turnHistory gets at most one entry per episode because the second observer sees null and records nothing).
