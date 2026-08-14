# Verification Report: backlog-autopilot

**Verified:** 2026-07-18
**Model:** claude-sonnet-4-6
**Verdict:** PASS

## Acceptance Criteria

- ✅ **AC-1:** `set <slug> --autopilot on` persists `autopilot.enabled: true` to `channels.json`, replies with confirmation including state `seeding` or `running`; `--autopilot off` clears runtime state. Non-allowFrom user is refused. — `master-commands.ts:858–876` builds `newAutopilot` with `enabled: true` and omits all runtime fields (clearing them); `stateHint` set to `'seeding'` or `'running'` based on `detectBacklogSource`. Off path (`879–887`) also clears runtime fields. Auth gate is at `handleMasterCommand:129`; `master-commands.test.ts` Tests 1–5 pass (including "autopilot on master channel: refused" and "backlog verb unauthorized user: blocked at auth gate").

- ✅ **AC-2:** Enabling on a project with no BACKLOG.md and no `.specclaw/` triggers a seed injection whose prompt contains the `--seed` goal verbatim (or the CLAUDE.md-derived instruction when omitted). — `buildSeedPrompt()` in `backlog.ts:155–166` embeds the goal verbatim when provided, falls back to `"derive the goals from this project's CLAUDE.md"`. Seed is injected by `runAutopilotSweep` at `scheduler.ts:607–623` when `action.kind === 'seed'`. AP-3 test in `scheduler.test.ts:869–883` confirms seed envelope is delivered with `userId: '__mcd_autopilot__'`. `backlog.test.ts` checks 15–18 verify prompt content.

- ✅ **AC-3:** Seed verification: sweep transitions `seeding → running` once a backlog with ≥1 task line exists; after 2 intervals with none, master channel gets an escalation and autopilot disables. — `nextAutopilotAction` in `backlog.ts:291–308` handles the seeding state: transitions to `running` when `source !== 'none' && snap.total >= 1` (test fsm-37); fires `verify-failed` (state `halted`) after `2 * intervalMs` elapsed (test fsm-38). `runAutopilotSweep` calls `onEscalate` for `verify-failed` (`scheduler.ts:624–625`); server.ts wires escalation to master channel (`server.ts:1604–1616`). AP-4 and AP-5 tests pass.

- ✅ **AC-4:** In `running`, a due sweep on an idle project injects exactly one nudge envelope; a busy project (isBusy true) is skipped without state change; a specclaw-halted project is suspended with the 🛑 escalation. — Busy gate at `scheduler.ts:563–567` skips with log only (no patch), verified AP-2. Specclaw halt probe at `scheduler.ts:569–588` sets state `halted` and calls `onEscalate`. Due nudge path delivers exactly one envelope via `pool.deliver`, verified AP-6, AP-10.

- ✅ **AC-5:** Snapshot math: file flavor counts `- [x]` vs total task lines; specclaw flavor counts done/total across pending proposals + active-change tasks.md. Verified by unit tests with fixtures. — `countCheckboxes()` at `backlog.ts:100–116` handles `- [ ]`, `- [x]`, `* [ ]`, `* [x]`, and indented variants via `TASK_LINE_RE`. `snapshotSpecclaw()` at `119–144` skips `archive` dir, counts `tasks.md` checkboxes, and adds 1 total per `proposal.md`-only change dir. Tests snap-file-6 through snap-file-11 and snap-specclaw-12 through snap-specclaw-14 all pass.

- ✅ **AC-6:** 3 consecutive zero-delta fires (default) → state `halted` + single master escalation; a subsequent `set --autopilot on` re-arms with counters reset. — `nextAutopilotAction:361–369` computes `newZeroDeltaCount` and triggers `stall` when it hits `stallThreshold` (default 3). `set --autopilot on` at `master-commands.ts:858–870` constructs a fresh `newAutopilot` without runtime fields (including `zeroDeltaCount`), confirming counter reset. Tests fsm-43 through fsm-45 and master-commands.test.ts "autopilot off: zeroDeltaCount cleared" pass.

- ✅ **AC-7:** All items done → completion announcement (project + master), state `complete`; adding a new unchecked item flips it back to `running` on the next sweep and it nudges again. — Completion check in `nextAutopilotAction:338–343` returns `complete` action when `snap.total > 0 && snap.done === snap.total`. Re-arm at `322–329` returns `rearm` when `state === 'complete'` and `snap.done < snap.total`. Server wires `onAnnounce` to both project channel and master channel (`server.ts:1618–1627`). AP-8 (complete) and AP-9 (rearm) tests pass.

- ✅ **AC-8:** `!project backlog <slug>` renders source, X/Y, state, last fire, and effective settings; unknown slug → error string. — `handleBacklog` at `master-commands.ts:2189–2226` emits all required fields: source, progress (`done/total`), autopilot enabled/disabled, state, last fire, zeroDeltaCount, effectiveIntervalMinutes, stallThreshold, respectHeartbeatWindow. Unknown slug returns `no project found for "${target}"`. Tests in master-commands.test.ts: Tests 7–10 all pass (file-source, specclaw-source, none-source, unknown slug, unauthorized).

- ✅ **AC-9:** `heartbeat.window` outside-hours sweep does not nudge when `respectHeartbeatWindow` is true (unit-tested with injected clock). — `nextAutopilotAction:346–348` gates on `withinWindow()` when `respectWindow && heartbeatWindow`. `withinWindow()` uses `Date.getHours()/getMinutes()` (local time), tested with `localDate()` helper at `backlog.test.ts:196–213`. Window gate tests fsm-41 (outside → none) and fsm-42 (respectHeartbeatWindow=false → nudge) pass. Sweep passes `heartbeatWindow: project.heartbeat?.window` at `scheduler.ts:601`.

- ✅ **AC-10:** `bun tsc --noEmit` clean; new `src/backlog.test.ts` plus extended `master-commands.test.ts` pass alongside existing suites. — `bun tsc --noEmit` produced no output (exit 0). `bun src/backlog.test.ts` outputs "All 50 checks passed." `bun src/master-commands.test.ts` outputs "all checks passed" (includes autopilot and backlog Tests 1–10). `bun src/scheduler.test.ts` outputs "All scheduler checks passed" (AP-1 through AP-10). All other suites (`project-pool.test.ts`, `bot-peers.test.ts`, `shared-learnings.test.ts`, `master-mcp-server.test.ts`) also pass.

## Test Results

```
bun src/backlog.test.ts        → All 50 checks passed.
bun src/master-commands.test.ts → all checks passed (autopilot + backlog Tests 1–10)
bun src/scheduler.test.ts      → All scheduler checks passed (AP-1 … AP-10)
bun tsc --noEmit               → exit 0, no output
project-pool / bot-peers / shared-learnings / master-mcp-server → all checks passed
```

## Issues Found

No issues found.

## Summary

**Passed:** 10/10 criteria
**Failed:** 0/10 criteria
**Verdict:** PASS
