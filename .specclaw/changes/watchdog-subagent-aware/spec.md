# Spec: Subagent-aware stuck-watchdog

**Change:** watchdog-subagent-aware
**Created:** 2026-05-13
**Status:** 🟡 Draft

## Overview

The pool's stuck-watchdog kills a project subprocess after `STUCK_THRESHOLD_MS` (5 min) of "no reply since last delivered message". This spec extends the kill condition to also require **no transcript activity** in the same window, eliminating false-positive kills of agents busy with parallel subagents or other long internal work.

## Requirements

### Functional Requirements

- **FR1.** `ProjectProcess` interface gains an optional method `transcriptMtimeMs(): number | null` returning the wall-clock ms of the most recent write to the agent's session transcript `.jsonl`, or `null` if unknown / unavailable.
- **FR2.** `ClaudeProjectProcess.transcriptMtimeMs()` returns `statSync(transcriptPath).mtimeMs` where `transcriptPath` is computed using the same `homedir() / .claude / projects / encodeProjectCwd(projectDir(slug)) / <sessionId>.jsonl` recipe already present at `src/claude-process.ts:823–828`. Returns `null` when the session id is not yet persisted, the file does not exist, or `statSync` throws.
- **FR3.** `MockProjectProcess.transcriptMtimeMs()` returns `null` (preserves existing test semantics — watchdog falls back to current pendingDeliver-only behavior).
- **FR4.** `ProjectPool.evictIdle()` modifies its stuck check at `src/project-pool.ts:178–184` to:
  - Compute `sincePending = now - pendingAt` as today.
  - **Only if** `sincePending > STUCK_THRESHOLD_MS`, additionally call `proc.transcriptMtimeMs()`. If it returns a number AND `now - mtime < STUCK_THRESHOLD_MS`, **skip** the stuck event and continue (do not kill, do not fall through to idle-evict on this tick).
  - Otherwise (transcript stale, null, or method absent) — fire `stuck` and kill, identical to today.
- **FR5.** A new `pool: { kind: 'progress-skip', chatId, slug, sinceLastReplyMs, sinceTranscriptMs }` event is fired in the skip path so operators can see false-positives prevented. Reuses the same `fireEvent` dispatcher.

### Non-Functional Requirements

- **NFR1.** `transcriptMtimeMs()` must be cheap (single `statSync`, no I/O beyond the inode). Called at most once per process per 30 s sweep — overhead bounded by pool size × sweep frequency.
- **NFR2.** No new module dependencies. `fs.statSync`, `path.join`, `os.homedir` already imported in `claude-process.ts`.
- **NFR3.** Backwards compatible: backends that don't implement `transcriptMtimeMs` (Mock and any third-party impls) get unchanged watchdog behavior.

## Acceptance Criteria

1. Existing `src/project-pool.test.ts` suite passes unchanged (`bun test src/project-pool.test.ts`).
2. New test in `src/project-pool.test.ts`: pool with a `MockProjectProcess` extended to return a recent `transcriptMtimeMs` while `pendingDeliverAtMs` is older than `STUCK_THRESHOLD_MS` ⇒ **no** `stuck` event emitted, process remains alive.
3. New test: same setup but `transcriptMtimeMs` returns `null` ⇒ `stuck` event IS emitted (parity with today).
4. New test: same setup but `transcriptMtimeMs` returns an mtime older than `STUCK_THRESHOLD_MS` ⇒ `stuck` event IS emitted.
5. Manual repro: replay the 07:35–07:40 academy-videos scenario in a test harness — subagent spawn writes to transcript every ~30s for 10 min — watchdog never kills.
6. `bun build` (or equivalent typecheck via `tsc --noEmit`) passes; no `any` introduced.

## Edge Cases

- **EC1.** Session id not yet persisted (`pre-sessionIdCapture` window, first ~5–10s of spawn). `transcriptMtimeMs` returns `null` ⇒ watchdog uses today's logic. Acceptable: agent has barely started; 5min ceiling is fine.
- **EC2.** Transcript file rotated/renamed mid-run (size-cap rotation at `src/claude-process.ts:840–844`). Next stat throws ENOENT ⇒ returns `null` ⇒ stuck event fires. Correct — rotated session is effectively dead.
- **EC3.** Disk under contention pushing mtime updates ≥ 5 min apart on a healthy agent. Mitigation: monitor `progress-skip` events; if absent over a tracer-bullet run, bump threshold. Out of scope for first cut.
- **EC4.** Clock skew between `now()` and filesystem mtime. Both are wall-clock from the same kernel; skew is `<1 ms`. Ignored.

## Dependencies

- No external. Touches `src/project-pool.ts`, `src/project-process.ts`, `src/claude-process.ts`, `src/project-pool.test.ts`.

## Notes

- Stops at "skip the kill"; does not introduce per-project tuning, watchdog metrics, or replacing the tmux backend.
- Future follow-up (separate change): expose `progress-skip` count in `!project usage`.
