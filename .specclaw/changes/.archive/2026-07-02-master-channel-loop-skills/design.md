# Design: Master Channel Loop Skills

**Change:** master-channel-loop-skills
**Created:** 2026-06-27

## Technical Approach

Create a Claude Code plugin `mcd-loops` with three skill files. Plugin is project-scoped to the master project path. Operator types `/mcd-loops:goal-inject keyflow "ship payments"` in Discord → tmux send-keys delivers it to master Claude session → Claude Code invokes the skill → SKILL.md instructions execute using master's existing MCP tools.

## Architecture

```
Plugin: mcd-loops@chan4lk (project-scoped to projects/master)
  └── skills/
        ├── goal-inject/SKILL.md    /mcd-loops:goal-inject <slug> "<words>"
        ├── spec-inject/SKILL.md    /mcd-loops:spec-inject <slug> "<feature>"
        └── backlog-inject/SKILL.md /mcd-loops:backlog-inject <slug> [--time HH:MM]

Runtime path (goal-inject example):
  Operator Discord: "make keyflow work on payments"
        ↓ (master Claude natural-language → /mcd-loops:goal-inject)
  Skill SKILL.md loaded
        ↓
  1. Expand: "ship payments module" → structured goal (objective + 3-5 ACs)
  2. mcp__mcd__inject { chatId: keyflow_id, text: "[auto] Goal: ..." }
  3. run_master_command("schedule add keyflow every 30m '[loop:goal:keyflow] ...'")
  4. mcp__mcd__remember { type:'coordination', content:'loop:goal:keyflow sid:<id> goal:...' }
  5. mcp__mcd__reply { text: "Goal injected ✓ schedule <id> created" }
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/.claude-plugin/plugin.json` | Create | Plugin manifest |
| `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/goal-inject/SKILL.md` | Create | Goal amplification + inject + monitor skill |
| `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/spec-inject/SKILL.md` | Create | Spec elaboration + inject + monitor skill |
| `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/backlog-inject/SKILL.md` | Create | Backlog drain + daily schedule skill |
| `~/.claude/plugins/installed_plugins.json` | Modify | Add `mcd-loops@chan4lk` entry for master project |
| `templates/master.CLAUDE.md` | Modify | Add `## Loop Skills` section (natural language triggers) |
| `projects/master/CLAUDE.md` | Overwrite | Deploy from updated template |

No TypeScript changes to the claude-mcd repo.

## Data Model Changes

`installed_plugins.json` gets one new entry:
```json
"mcd-loops@chan4lk": [{
  "scope": "project",
  "projectPath": "/home/openclaw/.claude/channels/discord-multi/projects/master",
  "installPath": "/home/openclaw/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0",
  "version": "1.0.0",
  "installedAt": "<ISO>",
  "lastUpdated": "<ISO>"
}]
```

## Key Decisions

**Decision 1 — Plugin outside the claude-mcd repo.**
Skills live in `~/.claude/plugins/cache/` (Claude Code's plugin cache), not in the claude-mcd git repo. This matches how specclaw and caveman work. The claude-mcd repo only gains changes to `templates/master.CLAUDE.md` and `projects/master/CLAUDE.md`.

**Decision 2 — Goal amplification in SKILL.md, not TypeScript.**
Expansion is done by master Claude's LLM reasoning guided by the SKILL.md prompt. No deterministic text expansion needed — the LLM is better at this than regex or templates.

**Decision 3 — Monitor schedule as a schedule entry, not a new scheduler concept.**
Reuses existing `schedule add` infrastructure. The monitor prompt is self-contained: it tells master Claude exactly what file to read, what to look for, and what to do. No new scheduler callbacks in TypeScript.

**Decision 4 — Plugin name `mcd-loops`, author `chan4lk`.**
Consistent with existing `specclaw@chan4lk`. Scoped to master project to avoid polluting other channel sessions.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Plugin not picked up by master session after install | Restart master subprocess: `!project stop master` + auto-respawn on next message |
| Monitor schedule prompt too long for `schedules.json` | Keep monitor prompt ≤ 300 chars; use `recall` in the prompt to fetch full context |
| Master Claude confuses natural language with existing commands | `## Loop Skills` section in CLAUDE.md lists trigger phrases explicitly |
