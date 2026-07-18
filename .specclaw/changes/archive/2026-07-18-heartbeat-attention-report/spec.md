# Spec: Actionable Heartbeat — Attention Report Instead of Idle Spam

**Change:** heartbeat-attention-report
**Created:** 2026-07-12
**Status:** ✅ Approved

## Overview

Rework `!project heartbeat` from a flat idle/stalled dump into a severity-sorted **attention report**: each item names the channel (Discord `<#chatId>` mention), explains what's wrong in one line, and gives a copy-pasteable suggested action. Add detectors for states the bot already knows about but never surfaces (schedule firing into a completed backlog, circuit-open channels, idle specclaw changes), include the full pending question text so the operator can answer without opening the channel, and add a `--quiet` sentinel mode so the 30-minute scheduled run posts nothing when everything is healthy.

**Assumptions locked from proposal open questions (operator approved without overrides):**
1. schedule-noop-loop threshold = 5 consecutive scheduler-originated inbound messages with no operator message after them.
2. `--quiet` is an explicit flag; scheduled prompt guidance updated to use it. Not auto-detected.
3. `question-unanswered` severity = 🔴 (agent fully blocked).

## Requirements

### Functional Requirements

- **FR1** — New `AttentionItem` model in `src/heartbeat.ts`: `{ slug, chatId, severity: 'blocked'|'review'|'info', kind, summary, action?, detail? }`. `buildAttentionReport(config, deps)` returns `AttentionItem[]` sorted 🔴 → 🟡 → 🔵, stable by slug within a severity.
- **FR2** — Existing stall detection maps to attention items:
  - `question-unanswered` → 🔴, `detail` = full question text up to 300 chars (extend `ChannelState` with a `detail` field; keep `snippet` for back-compat), `action` = `reply in <#chatId>` plus the question.
  - `tool-incomplete` → 🟡, action = `!project stop <slug>` (kill + lazy-respawn note).
  - `schedule-wakeup-loop` → 🟡, action = `!project stop <slug>`.
- **FR3** — New detector `schedule-noop-loop`: for each **enabled** schedule, scan the target channel transcript's user-role entries; count trailing consecutive entries that are scheduler-originated (content contains `user_id="__mcd_scheduler__"` or messageId starts with `sched-`). If count ≥ 5 → 🟡 item, summary includes schedule id + runCount, action = `!project schedule pause <id>` (mention `--stop-on-reply` alternative).
- **FR4** — New detector `circuit-open`: when deps expose circuit state and `circuitOpen === true` for a chatId → 🔴 item, action = `!project stop <slug>` then send a message to re-open.
- **FR5** — New detector `specclaw-idle`: project has an active specclaw change (via `readSpecclawStatus`) AND transcript age ≥ staleAfterMinutes → 🔵 item, summary = change name + phase + tasks done/total + idle age. No cross-scan state.
- **FR6** — `handleHeartbeat` renders the report: header `Heartbeat — <ISO ts>`, one line per item `<sev-emoji> <#chatId> **slug** — summary`, indented `↳ action` line, `detail` quoted block for questions. Cap at 15 items with `(+N more)`. When zero items: `✅ all quiet — N channels scanned`.
- **FR7** — `--quiet` flag on `heartbeat`: zero attention items → return exactly `HEARTBEAT_OK` (single token, no timestamp) so a scheduled prompt can suppress posting. With items → identical to FR6 output.
- **FR8** — `--channel <slug>` keeps working: report filtered to that slug (all detectors), same rendering.
- **FR9** — Circuit state plumbed from pool to master commands: optional `getCircuitStates?: () => Map<string, { circuitOpen: boolean; backoffUntil?: number }>` on `MasterContext`; server.ts wires `pool.getCircuitStates`. All detectors that need deps degrade silently when the dep is absent (unit tests without pool still pass).
- **FR10** — Help text updated (`heartbeat [--channel <slug>] [--quiet]`); `templates/master.CLAUDE.md` heartbeat section rewritten to instruct the scheduled prompt: call with `--quiet`, post nothing when output is `HEARTBEAT_OK`.

### Non-Functional Requirements

- **NFR1** — Read-only: no detector writes any state file or mutates schedules/config.
- **NFR2** — Scan cost bounded: transcript reads stay at last-200-lines per channel (existing pattern); schedule-noop-loop reuses the same parsed entries, no second file read per channel.
- **NFR3** — A failure in any single detector or channel must not abort the scan (per-channel try/catch, existing pattern).
- **NFR4** — Output fits one Discord message (≤ 2000 chars) for ≤ 15 items; chunker handles overflow anyway.

## Acceptance Criteria

- **AC1** — Channel with an unanswered question ≥ staleAfterMinutes old yields a 🔴 item whose `detail` contains the full question (verified with a fixture transcript whose question exceeds 80 chars — the old snippet limit).
- **AC2** — Fixture transcript with 5 trailing scheduler-originated user entries + enabled schedule for that chatId yields a `schedule-noop-loop` 🟡 item naming the schedule id; 4 trailing entries yields none; disabled schedule yields none; an operator message after the scheduler run resets the count.
- **AC3** — `getCircuitStates` returning `circuitOpen: true` for a chat yields a 🔴 `circuit-open` item; absent dep yields no item and no throw.
- **AC4** — Project with active specclaw change and stale transcript yields a 🔵 `specclaw-idle` item with change name and phase; fresh transcript yields none.
- **AC5** — `heartbeat --quiet` returns exactly `HEARTBEAT_OK` when no items; returns the full report when items exist.
- **AC6** — Rendering: items sorted 🔴 → 🟡 → 🔵; > 15 items truncated with `(+N more)`; zero-item non-quiet output is `✅ all quiet — N channels scanned`.
- **AC7** — All existing test suites pass + `bun tsc --noEmit` clean.

## Edge Cases

- Transcript dir missing / empty → channel contributes no items (existing `no-transcript` path).
- Schedule targets a chatId with no project entry → skipped, no throw.
- Multiple schedules on one channel, several in noop-loop → one item per schedule.
- Question text with backticks/newlines → newlines collapsed to spaces in detail, wrapped in a quote block, still ≤ 300 chars.
- Both circuit-open and question-unanswered on one channel → both items (they need different operator actions).
- `--quiet --channel <slug>` → sentinel applies to the filtered report.

## Dependencies

- `src/specclaw-status.ts` (`readSpecclawStatus`) — exists.
- `src/schedules-config.ts` (`loadSchedules`) — exists.
- `ProjectPool.getCircuitStates()` — exists (`src/project-pool.ts:472`).

## Notes

- The live schedule prompt in `schedules.json` is operator state; PR only updates template/README guidance. Operator applies the `--quiet` prompt change manually (or via `!project schedule`), and needs an MC restart to load the new code.
