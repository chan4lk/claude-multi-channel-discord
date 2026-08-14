# Proposal: Idle-evict turn guard — don't kill sessions mid-turn

**Created:** 2026-07-25
**Status:** 🟡 Draft

## Problem

`ProjectPool.evictIdle()` kills any session whose `lastActivityMs()` is older than `idleEvictMinutes` (default 15). But `lastActivityMs` only advances on **message deliveries** and **MCP tool calls** (`mcp__mcd__*`). A session in a long *silent* turn — parallel subagent synthesis, a big thinking stretch, a long test run — makes neither, so it looks idle and gets killed **while actively working**.

Observed 2026-07-25 04:26 UTC: the `specclaw` channel was mid-build (T1 committed, T2–T4 subagents finished, main thread synthesizing at 15m7s into the turn, transcript advancing every few seconds). MCD idle-evicted it at spawn+16min, killing the turn and stranding T2–T4 work uncommitted on disk.

The exact same false-positive class was already fixed for the **stuck-watchdog** in `2da3e63`: it AND-gates the "no reply in 5 min" signal with transcript `.jsonl` freshness before killing. Idle-evict never got the same veto — it's the last remaining kill path that ignores turn activity.

**Second false-positive (same day, dstm-apps):** the watchdog's freshness veto only protects a turn *in progress*. A session that receives a delivery, completes its turn quickly, and legitimately decides **no reply is needed** (hourly heartbeat → "Still 7 active PRs, no merges. No reply.", turn over in 7s) goes transcript-stale and gets watchdog-killed 5 min later. Observed as an **hourly kill/respawn loop** on dstm-apps all of 2026-07-25 (8+ cycles: heartbeat delivery → clean turn end → `progress-skip` at ~304s → `stuck` kill 30s later). The session was healthy and idle, not stuck — "stuck" must mean *turn never finished*, not *no reply tool fired*.

## Proposed Solution

Two guards, one per kill path:

**A. Watchdog: turn-completion exemption.** Before a `stuck` kill, check whether the session transcript's last substantive event after the most recent delivery is a completed turn (`type: "system", subtype: "turn_duration"` tail entry — Claude Code appends it when a turn ends). If the turn completed, the session is idle-by-choice, not stuck: skip the kill, emit `stuck-skip` (reason `turn-complete`), and reset the episode so the next delivery starts a fresh watch window. Cheap: read the last few lines of the `.jsonl` we already stat.

**B. Idle-evict: transcript-freshness veto.** Add the same veto the watchdog got in `2da3e63` to the idle-evict branch of `evictIdle()` (`src/project-pool.ts:425`):

- Before firing `idle-evict`, call `proc.transcriptMtimeMs()` (already on the `ProjectProcess` interface, already used by the watchdog branch ~40 lines above).
- If the transcript was written within the idle window (`mtime >= idleCutoff`), the session is **not idle**: skip the kill, emit a pool event (`{kind: 'evict-skip', reason: 'transcript-fresh'}` or a log line consistent with the watchdog's `progress-skip`), and leave it for the next sweep.
- If `transcriptMtimeMs()` returns `null` (no session id yet / no transcript), fall through to today's behavior — a session that never produced a transcript and has had no deliveries for 15 min is genuinely dead weight.

No new state, no config change. `MockProjectProcess` already implements `transcriptMtimeMs()` (`src/project-process.ts:166`), so pool tests can drive both branches.

## Scope

### In Scope
- Transcript-freshness veto in the idle-evict branch of `evictIdle()`.
- Turn-completion exemption in the watchdog stuck branch (transcript tail check, e.g. `lastTurnCompletedMs()` on `ClaudeProjectProcess` + interface).
- `evict-skip` / `stuck-skip` pool events so skips are observable.
- Unit tests in `src/project-pool.test.ts`: fresh transcript ⇒ idle-evict skipped; stale/null ⇒ evicted; completed turn ⇒ watchdog skipped; incomplete turn + stale transcript ⇒ killed (existing behavior preserved).
- Doc touch-ups: CLAUDE.md / ARCHITECTURE.md watchdog + idle-evict sections.

### Out of Scope
- Changing what bumps `lastActivityMs` (e.g. counting transcript writes as activity) — the veto is sufficient and keeps eviction semantics simple.
- Pool-full (LRU) eviction — capacity pressure may still need to kill a busy session; different trade-off, separate change if ever needed.
- The stuck-watchdog — already gated.
- Progress-reporting / interactivity improvements (handled behaviorally via project CLAUDE.md rules).

## Impact

- **Files affected:** 5–6 (`src/project-pool.ts`, `src/claude-process.ts`, `src/project-process.ts`, `src/project-pool.test.ts`, CLAUDE.md, ARCHITECTURE.md)
- **Complexity:** small-medium
- **Risk:** low — additive guard on one branch; worst case a genuinely idle session with a spuriously fresh transcript survives until the next sweep

## Open Questions

- Should the skip event reuse the watchdog's existing skip-event shape (`progress-skip`) or get its own `evict-skip` kind? (Lean: own kind, clearer telemetry.)
- Hard cap? A session continuously writing its transcript never idle-evicts — acceptable, since a genuinely stuck-but-writing session is the watchdog's job, and operators have `!project stop`.

---

**To proceed:** Review this proposal and approve to begin planning.
