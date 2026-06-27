# Spec: Master Channel Loop Skills

**Change:** master-channel-loop-skills
**Created:** 2026-06-27
**Status:** 🟢 Approved

## Overview

Create a Claude Code plugin (`mcd-loops@chan4lk`) with three skills scoped to the master project. The core value is **goal amplification**: operator types simple words → master Claude crafts a precise, well-structured goal with success criteria → injects into project channel → monitors until done.

Skills are invoked from Discord via `/mcd-loops:goal-inject keyflow "ship payments"` or by master Claude autonomously when it recognises the pattern in natural language.

## Requirements

### Functional Requirements

**FR1 — goal-inject skill:** Takes `<slug>` and a short operator description. Master Claude:
1. Expands the description into a structured goal with: one-line objective, 3–5 measurable success criteria, relevant file hints if determinable from context.
2. Injects the expanded goal into the target channel via `mcp__mcd__inject`.
3. Creates a monitor schedule on the target project (every 30m by default) that checks GOALS.md for completion.
4. Saves a `coordination` memory: slug, goal text, schedule id.
5. Replies to master channel with the crafted goal text and schedule id.

**FR2 — spec-inject skill:** Takes `<slug>` and a short feature description. Master Claude:
1. Expands into a specclaw-ready spec prompt: change name suggestion, problem statement, proposed solution sketch, initial acceptance criteria.
2. Injects into project channel: "Start a new specclaw change named `<name>`. [expanded spec prompt]. Follow the propose → plan → build → verify → PR lifecycle."
3. Creates a monitor schedule (every 60m) that checks STATUS.md phase progression.
4. Saves coordination memory.
5. Replies with injected prompt summary + schedule id.

**FR3 — backlog-inject skill:** Takes `<slug>` and optional `--time HH:MM` (default 09:00). Master Claude:
1. Reads project BACKLOG.md; if missing, replies with error and stops.
2. Counts pending `[ ]` items, replies with count.
3. Creates a daily schedule at `--time` with a structured backlog-pick prompt.
4. Saves coordination memory with initial count.
5. Replies with schedule id and item count.

**FR4 — monitor ticks (all skills):** The monitor schedule prompt instructs master Claude to:
- Read the relevant progress file (GOALS.md / STATUS.md / BACKLOG.md).
- If stalled (no progress since last tick): inject a context-aware nudge using `mcp__mcd__inject`.
- If complete (goal `[x]` / Verify 🟢 / BACKLOG empty): post completion summary to master, remove the schedule via `run_master_command("schedule rm <id>")`.

**FR5 — goal amplification quality:** Expanded goals must include:
- One-line objective (≤ 20 words).
- 2–5 bullet success criteria (testable, specific).
- Optional: relevant file paths or module names if inferable from slug's CLAUDE.md or GOALS.md.
- Tone: direct and precise, matching `buildInjectionMessage` style.
- Length: expanded goal ≤ 400 chars total.

**FR6 — plugin scope:** Plugin registered as project-scoped to `projects/master`. Not available in other project channels.

**FR7 — schedule naming prefix:** All loop schedules have prompt prefix `[loop:goal:<slug>]`, `[loop:spec:<slug>]`, or `[loop:backlog:<slug>]` for easy identification and cancellation.

**FR8 — natural language trigger:** Master Claude recognises natural language like "make keyflow work on payments", "have agent-nexus build the auth module", "drain keyflow's backlog" and maps to the appropriate skill invocation. Documented in `master.CLAUDE.md`.

**FR9 — deploy:** After building:
- Plugin installed at `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/`
- Registered in `installed_plugins.json` for master project path
- `templates/master.CLAUDE.md` updated with brief Loop Skills section
- `projects/master/CLAUDE.md` deployed from updated template

### Non-Functional Requirements

**NFR1 — skill files only:** Each skill is a `SKILL.md` file. No new TypeScript source files in the claude-mcd repo.

**NFR2 — skill file size:** Each SKILL.md ≤ 80 lines.

**NFR3 — backward compat:** Existing master.CLAUDE.md content unchanged; new section appended.

## Acceptance Criteria

- [ ] AC1: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/goal-inject/SKILL.md` exists with complete playbook.
- [ ] AC2: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/spec-inject/SKILL.md` exists with complete playbook.
- [ ] AC3: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/backlog-inject/SKILL.md` exists with complete playbook.
- [ ] AC4: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/.claude-plugin/plugin.json` valid manifest.
- [ ] AC5: `installed_plugins.json` contains `mcd-loops@chan4lk` entry scoped to master project path.
- [ ] AC6: `templates/master.CLAUDE.md` has `## Loop Skills` section documenting skill invocation and natural language triggers.
- [ ] AC7: `projects/master/CLAUDE.md` matches updated template.
- [ ] AC8: Each SKILL.md includes goal-amplification step (FR5 criteria).

## Edge Cases

- Slug not found in channels.json → skill replies with error before injecting.
- BACKLOG.md missing → backlog-inject replies with error, no schedule created.
- Goal already exists in GOALS.md → goal-inject appends a new entry (duplicates allowed; project Claude manages its own GOALS.md).
- Multiple loops on same slug → each is a separate schedule; all valid.

## Dependencies

- `mcp__mcd__inject` (master MCP tool, already live)
- `mcp__mcd__run_master_command` with `schedule add/rm` (already live)
- `mcp__mcd__remember` / `mcp__mcd__recall` (already live)
- Claude Code plugin system (`installed_plugins.json`, `.claude-plugin/plugin.json`, `SKILL.md` convention)
