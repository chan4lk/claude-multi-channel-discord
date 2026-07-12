# Proposal: SpecClaw Status Visibility in Show + Heartbeat

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

MCD runs autonomous specclaw loops (dstm-apps: 12-item backlog, every-30m `/specclaw:loop`) but has zero visibility into lifecycle state. `!project show` reports process/git state only; the master heartbeat reports channels as merely `idle`/`stalled`/`working`. The operator cannot answer "which change is dstm-apps building and how far along is it?" without opening the channel and scrolling.

The data already exists on disk in a stable format: `.specclaw/changes/<change>/status.md` (phase table) and `.specclaw/STATUS.md` (dashboard with task counts like `🔨 01-project-scaffold — 3/8 tasks`). `src/specclaw-guard.ts` already parses the per-change Progress table for its pipeline-green check — the parser just isn't reused for reporting.

## Proposed Solution

Extract a `readSpecclawStatus(projectCwd)` helper (extend `src/specclaw-guard.ts` or a new `src/specclaw-status.ts`) returning:

```ts
{ present: boolean, activeChange?: string, phase?: string, tasksDone?: number, tasksTotal?: number, pendingProposals?: number }
```

Consume it in two places:

1. **`!project show <slug>`** — add a `specclaw:` line, e.g. `specclaw: 🔨 01-project-scaffold — build 3/8 tasks, 11 proposals pending`. Omit when no `.specclaw/` dir.
2. **Master heartbeat** (`src/heartbeat.ts`) — include the same one-liner per channel that has an active change, so the 30m heartbeat reads `dstm-apps: building 01-project-scaffold (3/8)` instead of just `working`.

## Scope

### In Scope
- `readSpecclawStatus()` parser (tolerant: missing files/sections → `present: false`)
- `src/master-commands.ts`: `show` verb output line
- `src/heartbeat.ts`: per-channel specclaw summary in the report
- Tests with fixture STATUS.md/status.md files

### Out of Scope
- Schedule gating on specclaw state (future; parser makes it possible)
- Mission-control dashboard views
- Writing/mutating any `.specclaw` state — read-only

## Impact

- **Files affected:** 4 (estimated)
- **Complexity:** small
- **Risk:** low — read-only, additive output

## Open Questions

- `STATUS.md` project name can mismatch slug (dstm-apps' dashboard says "application-collector") — display change names only, not the project field.

---

**To proceed:** Review this proposal and approve to begin planning.
