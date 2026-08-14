# Spec: progressMode "phases" — SpecClaw Phase-Level Progress

**Change:** progress-mode-phases
**Created:** 2026-07-12

## Overview

Existing progress modes are the wrong altitude for 24/7 specclaw loops: `edit`/`post` stream raw tool calls, `off` is silent for 20-minute turns. New `progressMode: "phases"` streams one timeline line per lifecycle transition (phase entered, task count, verify verdict) by diffing `.specclaw/` state on the existing 2s transcript-watcher poll, rendered as one edit-in-place Discord message per specclaw change.

## Functional Requirements

- **FR1** — `channels-config.ts`: `"phases"` joins the progressMode enum (project + defaults).
- **FR2** — New `src/specclaw-progress.ts` (pure, no timers, no Date):
  - `takeSpecclawProgressSnapshot(projectCwd)` — reuses `readSpecclawStatus()`, plus verify verdict (🟢/✅ vs 🔴/❌ on the active change's Verify phase row).
  - `classifySpecclawTransitions(prev, next)` — returns timeline lines (no timestamps): change started, phase entered (with task total when known), task count change, verify verdict change. No transition → `[]`.
- **FR3** — `claude-process.ts`: on the existing 2s poll, when `opts.progressMode === 'phases'` and handlers are attached, snapshot/diff and fire `SpecclawProgressEvent { change, lines }`. First snapshot is baseline only (no replay at spawn). No new timers.
- **FR4** — `project-pool.ts`: forward as pool event `{ kind: 'specclaw-progress', ... }` with handler cleanup.
- **FR5** — `server.ts`:
  - Factory passes `progressMode` into `ClaudeProjectProcess` options.
  - `handleToolProgressEvent` returns early for `phases` (tool activity produces no output).
  - New dispatch: one Discord message per change keyed `chatId:change`, edited in place, growing `🦞 <change>` header + `├ HH:MM <line>` timeline (`└` last); timestamps stamped at dispatch (observation time); re-posts if the tracked message was deleted/buried. No `.specclaw/` → no events → silent (behaves as `off`).

## Acceptance Criteria

- AC1: `"phases"` accepted by the channels-config schema
- AC2: Phase/task/verify transitions each append exactly one timeline line
- AC3: One Discord message per change, edited in place
- AC4: `mcp__mcd__*` and non-transition tool activity produce no output
- AC5: Fixture-sequence classification tests; `bun tsc --noEmit` clean

## Out of Scope

- Teams/WhatsApp parity (Discord first), mixing modes, non-specclaw phase detection, PR-open detection (not on disk in a parseable spot).
