# Proposal: Rotation-Aware SpecClaw Resume Prompt

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

When a project's transcript grows past the rotation threshold, MCD rotates the session and injects a generic context brief distilled from the old transcript. On 2026-07-12 dstm-apps rotated at 2,876 KB mid-lifecycle (message `1525683768529256608`: "session rotated… prior context briefed into fresh session"). For a specclaw project the distilled brief is the *weakest* recovery source available — it's lossy prose about what the agent was doing, while `.specclaw/` holds the authoritative machine state: active change, phase table, per-task status, learnings, errors.

A fresh session briefed with prose may re-plan finished work, miss in-flight task state, or diverge from the tasks.md ordering. The loop self-corrects eventually, but burns turns re-discovering what disk already knows.

## Proposed Solution

At rotation time, detect `.specclaw/` in the project cwd (reuse `readSpecclawStatus()` from `specclaw-status-visibility`). When present with an active change, append a deterministic resume block to the injected brief:

```
SPECCLAW RESUME: This project uses specclaw. Authoritative state is on disk, not in this brief.
Active change: 01-project-scaffold (build, 3/8 tasks done).
Before doing anything else: read .specclaw/changes/01-project-scaffold/status.md and tasks.md,
then continue from the first non-completed task via /specclaw:build.
Do not re-run /specclaw:propose or /specclaw:plan for this change.
```

When `.specclaw/` exists but no change is active, append a one-liner pointing at BACKLOG.md/STATUS.md instead. No specclaw → unchanged behavior.

## Scope

### In Scope
- Rotation/brief path in `src/claude-process.ts` (or wherever the rotation brief is assembled — likely `src/distillation.ts`): conditional specclaw resume block
- Reuse of `readSpecclawStatus()`
- Tests: brief assembly with/without `.specclaw`, with/without active change

### Out of Scope
- Changing rotation thresholds or distillation itself
- Injecting `/specclaw:status` as a command (prompt instruction is enough; skill invocation is the session's job)

## Impact

- **Files affected:** 2–3 (estimated)
- **Complexity:** small
- **Risk:** low — additive text in an existing injection path

## Open Questions

- Depends on `specclaw-status-visibility` parser — build after it.

---

**To proceed:** Review this proposal and approve to begin planning.
