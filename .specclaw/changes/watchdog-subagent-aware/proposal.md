# Proposal: Subagent-aware stuck-watchdog

**Created:** 2026-05-13
**Status:** 🟡 Draft

## Problem

`ProjectPool.STUCK_THRESHOLD_MS = 5 * 60_000` (`src/project-pool.ts:52`) hardcodes a 5-minute timeout that starts ticking on every delivered message and resets only when the agent calls the `reply` tool. The watchdog assumes "no reply in 5 min ⇒ hung", which is correct for crashed TUIs and infinite-loop bash, but produces **false-positive kills** when the agent is legitimately busy doing long internal work.

Concrete incident, 2026-05-13 07:35–07:40 UTC, `academy-videos`:

- 07:35:14 user message delivered
- 07:37:02 + 07:37:06 agent spawned **two parallel `Agent` subagents** to generate `SESSION.md` + `CHALLENGE.md` for IRP weeks 7–1 of a curriculum
- Subagents kept running; the parent agent emitted no `reply` tool call
- 07:40:18 watchdog declared `stuck` at `sinceLastReplyMs=303334` → `tmux kill-session` → user sees `⚠️ agent stopped responding`

Transcript `.jsonl` mtime kept advancing the whole time (subagent tool_uses are appended). A simple "is this process still writing?" check would have prevented the kill.

This bug bites any long-running parallel-subagent task — common for code-gen, docs-gen, multi-file refactor workflows.

## Proposed Solution

Make the stuck-watchdog **transcript-aware**:

1. Keep `STUCK_THRESHOLD_MS = 5 min` as the no-reply ceiling.
2. Before firing the `stuck` event, check whether the session transcript `.jsonl` mtime advanced within `STUCK_THRESHOLD_MS`. If yes, the agent is making progress — skip the kill, wait another tick.
3. Only kill when **both** signals say dead: no reply AND transcript has not been written to for ≥ `STUCK_THRESHOLD_MS`.

Add a new optional method `transcriptMtimeMs(): number | null` on the `ProjectProcess` interface. `ClaudeProjectProcess` resolves it via `statSync(transcriptPath)`. `MockProjectProcess` returns null (watchdog falls back to current behavior).

## Scope

### In Scope
- `src/project-pool.ts` — gate `stuck` event on transcript-mtime check
- `src/project-process.ts` — add optional `transcriptMtimeMs()` to interface; null in `MockProjectProcess`
- `src/claude-process.ts` — implement `transcriptMtimeMs()` using the existing `transcriptPath` computation (already used at `:823–828`)
- `src/project-pool.test.ts` — new test case: pending deliver + advancing transcript ⇒ no stuck event
- README / inline comment on `STUCK_THRESHOLD_MS` updated to describe the AND-of-signals semantics

### Out of Scope
- Per-project threshold configuration
- Bumping the threshold itself
- Replacing tmux backend
- Watchdog telemetry / metrics export

## Impact

- **Files affected:** 4 (3 src + 1 test)
- **Complexity:** small
- **Risk:** low — change is additive (extra condition before existing kill path). Worst case is identical behavior if mtime read fails (falls back to existing logic).

## Open Questions

1. Should `transcriptMtimeMs()` return a coarse-grained "recently active" boolean instead, hiding the path concern from the pool? — Lean **no**; raw mtime is simpler to test.
2. Should we also skip the kill when there are visible subagent tool_uses without resolution? — Out of scope; transcript-mtime is a strict superset (subagents write to the same .jsonl).
3. Failure mode if transcript is on a slow disk and mtime is stale for spurious reasons? — Accept; same outcome as today.

---

**To proceed:** approve and run `specclaw plan watchdog-subagent-aware`.
