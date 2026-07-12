# Spec: Rotation-Aware SpecClaw Resume Prompt

**Change:** rotation-specclaw-resume
**Created:** 2026-07-12

## Overview

When a session rotates, the injected context brief is lossy prose. For specclaw projects, disk (`.specclaw/`) is authoritative. Append a deterministic SPECCLAW RESUME block to the rotation brief so the fresh session reads disk state instead of re-planning.

## Functional Requirements

- **FR1** — `buildSpecclawResumeBlock(projectCwd)` in `src/specclaw-status.ts`: pure function over `readSpecclawStatus()`.
  - Active change present → multi-line block naming change, phase, task counts, instructing: read `status.md` + `tasks.md`, continue via `/specclaw:build`, never re-run `/specclaw:propose` or `/specclaw:plan`.
  - `.specclaw/` present, no active change → one-liner pointing at `BACKLOG.md` / `.specclaw/STATUS.md`.
  - No `.specclaw/` → empty string.
- **FR2** — `extractContextSnapshot()` in `src/claude-process.ts` appends the block (when non-empty) after the 2000-char truncation of the prose snapshot, so the block is never cut mid-instruction.
- **FR3** — When the transcript yields no prose snippets but a resume block exists, the snapshot is still written (block-only brief). When both are empty, behavior unchanged (no snapshot).

## Acceptance Criteria

- AC1: Active change → resume block appended with change name, phase, task counts
- AC2: `.specclaw/` present but no active change → one-liner pointing at BACKLOG/STATUS
- AC3: No `.specclaw/` → brief byte-identical to current behavior
- AC4: Brief-assembly tests for all three cases; `bun tsc --noEmit` clean

## Out of Scope

- Rotation thresholds, distillation changes, skill auto-invocation.
