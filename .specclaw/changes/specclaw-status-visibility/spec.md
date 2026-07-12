# Spec: SpecClaw Status Visibility in Show + Heartbeat

**Change:** specclaw-status-visibility
**Created:** 2026-07-12
**Status:** ✅ Approved

## Overview

Give MCD read-only awareness of a project's specclaw lifecycle state. A single parser reads `.specclaw/STATUS.md` (dashboard) and the active change's `status.md` (phase table), and two consumers render it: the `!project show` verb and the `heartbeat` master-command report.

## Requirements

### Functional Requirements

- **FR1** — New module `src/specclaw-status.ts` exporting `readSpecclawStatus(projectCwd: string): SpecclawStatus` where:
  ```ts
  interface SpecclawStatus {
    present: boolean            // .specclaw/STATUS.md exists and parsed
    activeChange?: string       // first 🔨 (in-progress) change from dashboard; falls back to first active entry
    phase?: string              // lowest non-green phase from the change's status.md Progress table (e.g. "build")
    tasksDone?: number
    tasksTotal?: number
    failedTasks?: number
    pendingProposals?: number   // count of 📋 entries in dashboard Pending Proposals section
  }
  ```
- **FR2** — Dashboard parsing: from `.specclaw/STATUS.md`, extract Active Changes lines matching `- <emoji> **<name>** — <done>/<total> tasks … | <failed> failed` and Pending Proposals count. A `🔨` entry wins over `✅` entries for `activeChange`; if only ✅ entries exist, `activeChange` is undefined (nothing in flight).
- **FR3** — Phase resolution: when `activeChange` is set and `.specclaw/changes/<activeChange>/status.md` exists, parse its `## Progress` table (same column logic as `checkPipelineGreen` in `src/specclaw-guard.ts`) and report the first phase whose status is not 🟢/✅ as `phase` (lowercased).
- **FR4** — `!project show <target>` (`handleShow` in `src/master-commands.ts`): when `readSpecclawStatus(projectDir(slug))` returns `present: true`, add one line after the `git:` line:
  - active change: `specclaw: 🔨 <change> — <phase> <done>/<total> tasks, <pending> proposals pending`
  - no active change: `specclaw: idle — <pending> proposals pending` (omit `, N proposals pending` when 0)
- **FR5** — `handleHeartbeat` full-scan output: after the idle/stalled lines, add a `🦞 specclaw:` block listing every project with `present: true` **and** an active change, one line each: `  • <slug>: <change> — <phase> <done>/<total>`. No block when no project qualifies. Single-channel mode (`--channel`) appends the same line for that channel when applicable.

### Non-Functional Requirements

- **NFR1** — Read-only: the module never writes or mutates `.specclaw` state.
- **NFR2** — Robust: missing files, missing sections, malformed tables → `{ present: false }` or partial fields; never throws (all IO in try/catch).
- **NFR3** — Cheap: at most 2 file reads per project (dashboard + one change status); no directory walks over `changes/`.

## Acceptance Criteria

- **AC1** — Parser returns `{present:false}` for: no `.specclaw/` dir, no `STATUS.md`, unreadable file — without throwing.
- **AC2** — Fixture dashboard with `🔨 foo — 3/8 tasks (38%) | 1 failed` + 2 pending proposals → `{present:true, activeChange:'foo', tasksDone:3, tasksTotal:8, failedTasks:1, pendingProposals:2}`.
- **AC3** — Fixture with change `status.md` where Build row is `🔨` and earlier rows 🟢 → `phase: 'build'`.
- **AC4** — Dashboard with only ✅ entries → `activeChange` undefined, `present: true`.
- **AC5** — `show` output contains the `specclaw:` line for a fixture project; omits it when no `.specclaw/`.
- **AC6** — `heartbeat` full-scan output contains the `🦞 specclaw:` block listing active-change projects; absent when none.
- **AC7** — `bun tsc --noEmit` clean; all existing test suites pass.

## Edge Cases

- Dashboard `**Project:**` name mismatching the MCD slug (observed: dstm-apps dashboard says "application-collector") — parser ignores the project field entirely.
- Active change named in dashboard but its `changes/<name>/status.md` missing → `phase` undefined, rest populated.
- Multiple 🔨 entries → first one listed wins.
- Task counts absent from the line (`— proposal ready…`) → counts undefined.

## Dependencies

- None (foundation change — `loop-halt-escalation`, `rotation-specclaw-resume`, `progress-mode-phases` build on this module).

## Notes

`checkPipelineGreen` stays untouched; its table-parsing column logic is duplicated-then-shared: extract the row-parsing helper into `specclaw-status.ts` and re-import from `specclaw-guard.ts` only if trivially compatible — otherwise leave guard as-is (YAGNI).
