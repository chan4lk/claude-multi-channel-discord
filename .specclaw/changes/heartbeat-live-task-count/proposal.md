# Proposal: Heartbeat live task count

**Created:** 2026-07-18
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The heartbeat `specclaw-idle` detector (`src/heartbeat.ts:392-414`) builds its nudge from `readSpecclawStatus()`, which parses the project's `.specclaw/STATUS.md`. STATUS.md is only as fresh as the last `specclaw-update-status` run — during an active build it routinely lags tasks.md. On 2026-07-18 the finaudit-agents heartbeat injected *"bank-fraud-audit-system is in build phase (0/14 tasks done), idle 4h+ — please resume /specclaw:build"* when the real state was **13/13 done, PR #2 open awaiting merge**. The agent burned a turn (and a session respawn) correcting the harness, and a less careful agent could have re-run build tasks against a completed change. A stale nudge is worse than no nudge: it injects false state into an autonomous session with directive framing.

## Proposed Solution

_What are we building? High-level approach._

Make tasks.md the source of truth for task counts at **fire time**:

- Extend `readSpecclawStatus()` (implementation in `server.ts`) to locate the active change's `tasks.md` (`.specclaw/changes/<active>/tasks.md`) and count checkboxes (`- [x]` done / total task lines) directly.
- STATUS.md remains the source for `activeChange` and `phase`; tasks.md overrides `tasksDone/tasksTotal` when present and parseable.
- Guard the nudge: if tasks.md shows all tasks complete but STATUS.md says build in-progress, **suppress** the resume-build nudge and instead emit a milder `specclaw-idle` summary ("tasks complete, phase not advanced — verify/pr may be pending") so the heartbeat never instructs re-running a finished build.
- Idle-age computation unchanged.

## Scope

### In Scope
- `readSpecclawStatus` implementation in `server.ts`: tasks.md checkbox count at fire time
- `src/heartbeat.ts`: completed-but-stale guard + adjusted nudge wording
- Test coverage: stale STATUS.md + complete tasks.md → suppressed/re-worded nudge; fresh mismatch → live count wins

### Out of Scope
- Fixing specclaw's own STATUS.md update cadence (plugin territory)
- Other heartbeat detectors (question-unanswered, circuit-open, etc.)
- Parsing task wave/dependency structure — checkbox counting only

## Impact

- **Files affected:** 3 (estimated) — `server.ts`, `src/heartbeat.ts`, heartbeat tests
- **Complexity:** small
- **Risk:** low — read-only state gathering; parse failure falls back to current STATUS.md behavior

## Open Questions

- Should the nudge also check for an open PR (e.g. `.specclaw/changes/<active>/verify-report.md` presence) to pick an even more accurate phase hint?
- Emit a master-channel note when STATUS.md and tasks.md disagree materially, so the operator sees the drift?

---

**To proceed:** Review this proposal and approve to begin planning.
