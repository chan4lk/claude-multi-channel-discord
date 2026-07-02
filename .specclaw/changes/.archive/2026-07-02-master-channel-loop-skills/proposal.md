# Proposal: Master Channel Loop Skills

**Created:** 2026-06-27
**Status:** 🟡 Draft

## Problem

Master channel can already execute one-shot commands (`!project`, `run_master_command`) but has no vocabulary for **sustained loops** — multi-step autonomous workflows where master drives a project channel toward a goal, monitors gates, and closes the loop when done.

Three recurring operator needs with no current primitive:

1. "Add goal X to keyflow and don't stop until it's done" — requires goal injection, injection scheduling, progress polling, gate checking, and completion notification.
2. "Kick off a specclaw change on agent-nexus and tell me when it ships a PR" — requires spec authoring, build monitoring, clarity-gate handling, and PR notification.
3. "Keep watching academy-videos until the backlog is empty" — requires periodic progress checks, stall detection, and back-channel injection.

Without loop skills, the operator has to manually re-prompt master every step, which defeats autonomous operation.

## Proposed Solution

Add three **master-channel skills** (natural-language slash commands master Claude can invoke) that each encapsulate a full loop:

### Skill 1 — `goal-loop`
Master skill that, given a slug and a goal description, drives a project channel from goal-injection to verified completion:
1. Write goal to `projects/<slug>/GOALS.md` (append under `## Goals` section, create if missing).
2. Register a monitoring schedule (every N minutes, configurable, default 30).
3. Each tick: read GOALS.md + STATUS.md, check gates (spec-clarity, pipeline green), inject an encouraging message if stalled.
4. On all gates green + goal marked `[x]`: post completion summary to master channel, remove schedule.

### Skill 2 — `spec-loop`
Master skill that, given a slug and a specclaw change name, drives it through the full propose → plan → build → verify → PR lifecycle:
1. Inject `!project branch <slug> create` to create develop branch.
2. Inject a structured spec-authoring message into the project channel.
3. Monitor STATUS.md phase progression; surface spec-clarity warnings to operator.
4. On Verify 🟢: trigger batch PR check; notify operator with PR link.

### Skill 3 — `backlog-loop`
Master skill that drives a project to work through its BACKLOG.md:
1. Read BACKLOG.md; count pending items.
2. Inject daily schedule (if none exists) with prompt to pick next 2 items.
3. Each tick: count remaining items; if delta > 0 since last tick, post progress to master.
4. On 0 pending: notify operator, pause schedule.

**Implementation:** Each skill is a block in `templates/master.CLAUDE.md` telling master Claude exactly how to execute the loop using existing tools (`mcp__mcd__run_master_command`, `mcp__mcd__reply`, file reads via Claude's own tools). No new TypeScript required — these are prompt-engineering skills baked into the system prompt.

**Deploy step:** After template update, overwrite `projects/master/CLAUDE.md` with the updated template and send `[auto] reload` to the master channel to pick up the new instructions.

## Scope

### In Scope
- `templates/master.CLAUDE.md` — add `## Loop Skills` section with goal-loop, spec-loop, backlog-loop playbooks
- `projects/master/CLAUDE.md` — deploy updated template
- GOALS.md format spec (append-only, `[ ]`/`[x]` checkboxes under `## Goals`)
- Integration with existing: `mcp__mcd__run_master_command`, `registerBehaviourMirrorSweep`, `registerGoalReconcileCron`, spec-clarity gate

### Out of Scope
- New TypeScript source files (skills are prompt-only)
- New `!project` verbs
- Cross-project handoff (`@slug` routing)
- WhatsApp or Teams loop parity (Discord only)
- Persistent loop state beyond what GOALS.md + schedules.json already provide

## Impact

- **Files affected:** 2 (`templates/master.CLAUDE.md`, `projects/master/CLAUDE.md`)
- **Complexity:** medium (prompt engineering + deploy step)
- **Risk:** low (no runtime code changes; worst case master Claude ignores the new section)

## Open Questions

_Resolved 2026-06-27 by operator:_

1. **Trigger:** Natural language — "monitor keyflow goal: ship payments" is enough; master Claude infers the loop type.
2. **GOALS.md writes:** Inject into project channel; project Claude updates its own GOALS.md. Master does not write directly into project dirs.
3. **Termination:** Each loop watch IS a schedule entry. Operator cancels via `!project schedule rm <id>` or natural language "stop watching keyflow". No special mechanism needed.

---

**To proceed:** Review this proposal and approve to begin planning.
