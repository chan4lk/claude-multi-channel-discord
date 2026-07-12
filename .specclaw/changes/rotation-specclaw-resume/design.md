# Design: Rotation-Aware SpecClaw Resume Prompt

**Change:** rotation-specclaw-resume

## Placement

The rotation brief is assembled in `ClaudeProjectProcess.extractContextSnapshot()` (`src/claude-process.ts:1374`), which writes `.session-context.md` and sets `rotatedContextText` for first-message injection. The block builder lives in `src/specclaw-status.ts` next to `readSpecclawStatus()` — pure, filesystem-read-only, independently testable (claude-process.ts has no test harness; tmux-bound).

## Block builder

```ts
export function buildSpecclawResumeBlock(projectCwd: string): string
```

- `readSpecclawStatus(projectCwd)`; `!present` → `''` (AC3 byte-identity by construction — call site appends only non-empty).
- Active change → block:

```
SPECCLAW RESUME: This project uses specclaw. Authoritative state is on disk, not in this brief.
Active change: <name> (<phase>, <done>/<total> tasks done).
Before doing anything else: read .specclaw/changes/<name>/status.md and tasks.md,
then continue from the first non-completed task via /specclaw:build.
Do not re-run /specclaw:propose or /specclaw:plan for this change.
```

Phase falls back to `unknown phase` when parser found none; task counts omitted when absent.

- Present, no active change → `SPECCLAW: no active change. Check BACKLOG.md and .specclaw/STATUS.md for pending work before starting anything new.`

## Call-site wiring

In `extractContextSnapshot()`:
1. Compute `resumeBlock = buildSpecclawResumeBlock(this.projectCwd)` up front.
2. Early-return only when prose snippets AND block are both empty (FR3).
3. `snapshot = prose.slice(0, 2000)` then, if block non-empty, `snapshot += '\n\n' + resumeBlock` — appended after truncation so the instruction never gets cut.

Uses `this.projectCwd` (already realpathed), not `projectDir(slug)`, so symlinked projects resolve the same `.specclaw/` claude sees.

## Testing

`src/specclaw-status.test.ts` fixtures (same tmpdir pattern as halt tests): active-change block content (AC1), no-active-change one-liner (AC2), missing `.specclaw/` → `''` (AC3). Call-site append is a two-line change covered by tsc + construction argument.
