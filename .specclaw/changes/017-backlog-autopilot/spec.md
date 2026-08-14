# Spec: Backlog autopilot

**Change:** backlog-autopilot
**Created:** 2026-07-18
**Status:** 🟡 Draft

## Overview

Per-project autopilot mode where MCD itself drives the "create a backlog, then loop through all items" workflow. Enabling autopilot on a project makes MCD (1) seed a backlog via the project's own Claude session if none exists, (2) periodically inject "work the next item" nudges while unchecked items remain, (3) detect stalls and guardrail halts and escalate to the master channel, and (4) announce completion and disarm — re-arming automatically when new items appear. Implemented as a config-driven sweep (behaviour-mirror-sweep pattern), not a schedules.json entry, because the schedule schema is Discord-snowflake-only and autopilot needs a dynamic state machine.

## Requirements

### Functional Requirements

- **FR1 — Config:** `autopilot` object on project entries in `channels.json`: `{ enabled, file?, intervalMinutes?, stallThreshold?, respectHeartbeatWindow? }` plus runtime fields maintained by MCD (`state`, `seededAt`, `lastFireAt`, `zeroDeltaCount`, `lastSnapshot`). `defaults.autopilot` carries limits-only defaults (`intervalMinutes`, `stallThreshold`). Built-in fallbacks: interval 30 min, stallThreshold 3, file `BACKLOG.md`, respectHeartbeatWindow true.
- **FR2 — Toggle:** `!project set <target> --autopilot on|off [--seed "<goal>"] [--autopilot-interval <min>] [--backlog-file <path>]` (allowFrom-gated, like other `set` flags). `on` resets runtime counters and enters the state machine; `off` clears runtime state and stops the sweep for that project. Config changes are picked up on the next sweep tick without restart (sweep reads `channels.json` per tick).
- **FR3 — Backlog source auto-detection:** specclaw project (`.specclaw/STATUS.md` present) → backlog = pending proposals + active changes with incomplete tasks (parsed from `STATUS.md` + per-change `tasks.md` checkboxes). Otherwise → markdown checkboxes (`- [ ]` / `- [x]`) in the configured backlog file. Specclaw wins when both exist.
- **FR4 — Seed phase (MCD-owned backlog creation):** when autopilot is enabled and no backlog source exists (or the file has zero task lines), MCD injects a one-shot backlog-authoring prompt into the project session — goal text from `--seed`, else derived instruction referencing the project's CLAUDE.md. Next sweep verifies a backlog appeared: found → `running`; still absent after the seed-verification window (2 intervals) → escalate to master and disable.
- **FR5 — Nudge loop:** in `running`, when the fire interval has elapsed, the project is idle (`isBusy` gate with grace, same semantics as `onlyWhenIdle` schedules), the specclaw halt probe is clear, and the time window permits, inject a nudge envelope: "work the next unchecked backlog item, check it off when done" (file flavor) or "advance the specclaw lifecycle for the next pending change / incomplete task" (specclaw flavor). Nudge prompts carry the same reply-required footer as scheduled prompts.
- **FR6 — Progress tracking & stall halt:** each fire snapshots `{done, total}`. `stallThreshold` consecutive fires with zero delta → state `halted`, one-time escalation to master ("backlog stalled at X/Y"). Specclaw guardrail halt (existing `detectSpecclawHalt`) also suspends the loop with the existing 🛑 escalation shape.
- **FR7 — Completion & re-arm:** `total > 0 && done == total` → announce completion to the project channel + master, state `complete`. Sweep keeps watching a completed project (cheap snapshot only); when new unchecked items appear, transition back to `running` and announce re-arm.
- **FR8 — Status verb:** `!project backlog <target>` shows: source (specclaw / file / none), X/Y done, autopilot state, last fire time, zero-delta count, effective interval/threshold. Read-only, works even when autopilot is off.
- **FR9 — Window:** when `respectHeartbeatWindow` is true and the project has `heartbeat.window`, nudges fire only inside the window (seed exempt — it is operator-initiated).

### Non-Functional Requirements

- **NFR1:** No new external dependencies; zod schema + node fs only.
- **NFR2:** Sweep is cheap when idle — per tick per project: one config read (already loaded once per sweep), at most one snapshot (fs reads) for enabled projects only.
- **NFR3:** All state transitions and fires logged (`[autopilot]` prefix) and appended to `scheduler-history.jsonl` shape for observability.
- **NFR4:** Injection uses the existing pool `deliver()` path (synthetic envelope, `userId: '__mcd_autopilot__'`) — agent-agnostic, same as scheduler.
- **NFR5:** `bun tsc --noEmit` clean; all existing test suites stay green.

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

- **AC1:** `set <slug> --autopilot on` persists `autopilot.enabled: true` to `channels.json`, replies with confirmation including state `seeding` or `running`; `--autopilot off` clears runtime state. Non-allowFrom user is refused.
- **AC2:** Enabling on a project with no BACKLOG.md and no `.specclaw/` triggers a seed injection whose prompt contains the `--seed` goal verbatim (or the CLAUDE.md-derived instruction when omitted).
- **AC3:** Seed verification: sweep transitions `seeding → running` once a backlog with ≥1 task line exists; after 2 intervals with none, master channel gets an escalation and autopilot disables.
- **AC4:** In `running`, a due sweep on an idle project injects exactly one nudge envelope; a busy project (isBusy true) is skipped without state change; a specclaw-halted project is suspended with the 🛑 escalation.
- **AC5:** Snapshot math: file flavor counts `- [x]` vs total task lines; specclaw flavor counts done/total across pending proposals + active-change tasks.md. Verified by unit tests with fixtures.
- **AC6:** 3 consecutive zero-delta fires (default) → state `halted` + single master escalation; a subsequent `set --autopilot on` re-arms with counters reset.
- **AC7:** All items done → completion announcement (project + master), state `complete`; adding a new unchecked item flips it back to `running` on the next sweep and it nudges again.
- **AC8:** `!project backlog <slug>` renders source, X/Y, state, last fire, and effective settings; unknown slug → error string.
- **AC9:** `heartbeat.window` outside-hours sweep does not nudge when `respectHeartbeatWindow` is true (unit-tested with injected clock).
- **AC10:** `bun tsc --noEmit` clean; new `src/backlog.test.ts` plus extended `master-commands.test.ts` pass alongside existing suites.

## Edge Cases

- Backlog file with checkboxes inside code fences — counted (documented limitation; regex-based, no markdown AST).
- Project deleted / archived while autopilot enabled → sweep skips missing project dirs silently.
- channels.json edited by hand to `enabled: true` with no runtime state → sweep treats as fresh `on` (enters seeding/running by detection).
- Seed fires but Claude writes an empty-section BACKLOG.md (0 task lines) → still `seeding`; escalates after the verification window.
- done > total impossible by construction (done counted from same parse).
- Clock skew / restart mid-interval: `lastFireAt` persisted in channels.json, so restart does not double-fire (same contract as scheduler `lastRunAt`).
- Master project: autopilot refused on the master channel (like other per-project features).

## Dependencies

- Existing: `ProjectPool.deliver` + `isBusy`, `detectSpecclawHalt`, `routeNotification`, channels-config atomic IO, behaviour-mirror sweep registration pattern in `Scheduler`.
- No changes to the specclaw plugin; its files are read-only inputs.

## Notes

- Deliberately NOT a schedules.json entry: `ScheduleSchema.chatId` is Discord-snowflake-regex-bound, prompts are static, and the autopilot state machine (seed/verify/stall/re-arm) has no home there. The sweep pattern (`registerBehaviourMirrorSweep`) is the established precedent for config-driven periodic behavior.
- Operator ritual replaced: previously "ask Claude to write BACKLOG.md, then nudge continue repeatedly" — now one `set --autopilot on --seed "..."` command.
