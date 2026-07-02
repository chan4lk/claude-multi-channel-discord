# Tasks: Master Channel Loop Skills

**Change:** master-channel-loop-skills
**Created:** 2026-06-27
**Total Tasks:** 5

## Summary

5 tasks, 3 waves. Wave 1 creates the plugin skeleton. Wave 2 writes the three skill files. Wave 3 registers the plugin, updates the master template, and deploys.

## Tasks

### Wave 1 — Plugin Skeleton

- [x] `T1` — Create plugin manifest and directory structure
  - Files: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/.claude-plugin/plugin.json`
  - Estimate: small
  - Depends: —
  - Notes: Create dirs `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/.claude-plugin/` and `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/`. Write `plugin.json`:
    ```json
    {
      "name": "mcd-loops",
      "version": "1.0.0",
      "description": "Master channel loop skills — goal-inject, spec-inject, backlog-inject. Amplify operator's simple words into precise goals and monitor project channels to completion.",
      "author": { "name": "Chandima Ranaweera", "email": "chan4lk@gmail.com" }
    }
    ```

### Wave 2 — Skill Files

- [x] `T2` — Write `goal-inject` skill
  - Files: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/goal-inject/SKILL.md`
  - Estimate: medium
  - Depends: `T1`
  - Notes: Skill invoked as `/mcd-loops:goal-inject <slug> "<words>"`. SKILL.md must instruct master Claude to:
    1. **Amplify**: expand `<words>` into a structured goal: one-line objective (≤20 words), 3–5 measurable success criteria (bullet list), relevant file hints if inferable from context. Total ≤400 chars.
    2. **Find chatId**: call `run_master_command("show <slug>")` and extract `chatId`.
    3. **Inject**: `mcp__mcd__inject { chatId, text: "Goal: <objective>\n\nSuccess criteria:\n<bullets>\n\nUpdate GOALS.md: append `[ ] <slug-of-goal>` under `## Goals` (create section if missing) and check it off when all criteria are met." }`.
    4. **Schedule**: `run_master_command("schedule add <slug> every 30m '[loop:goal:<slug>] Read ~/.claude/channels/discord-multi/projects/<slug>/GOALS.md. If goal `[ ] <slug-of-goal>` still open and no edit in last 30m: inject an encouraging nudge via mcp__mcd__inject. If `[x]`: schedule rm <id> and reply completion to master.'")`.
    5. **Save memory**: `mcp__mcd__remember { type: 'coordination', slug: '<slug>', content: 'loop:goal:<slug> sid:<schedule_id> goal:<objective>' }`.
    6. **Reply**: post crafted goal text + schedule id to master channel.

- [x] `T3` — Write `spec-inject` skill
  - Files: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/spec-inject/SKILL.md`
  - Estimate: medium
  - Depends: `T1`
  - Notes: Skill invoked as `/mcd-loops:spec-inject <slug> "<feature>"`. SKILL.md must instruct master Claude to:
    1. **Elaborate**: from `<feature>`, draft: change-name (kebab-case, ≤5 words), problem statement (1 sentence), proposed solution (1–2 sentences), 2–3 initial acceptance criteria.
    2. **Find chatId**: `run_master_command("show <slug>")`.
    3. **Inject**: `mcp__mcd__inject { chatId, text: "Start a specclaw change named `<change-name>`.\nProblem: <statement>\nSolution: <sketch>\nInitial ACs:\n<bullet list>\nRun /specclaw:propose to draft the full proposal, then /specclaw:plan, /specclaw:build, /specclaw:verify, /specclaw:pr." }`.
    4. **Schedule**: every 60m monitor prompt that checks STATUS.md for Verify 🟢; on complete posts PR link + `schedule rm`.
    5. **Save memory** + **reply** to master.

- [x] `T4` — Write `backlog-inject` skill
  - Files: `~/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0/skills/backlog-inject/SKILL.md`
  - Estimate: small
  - Depends: `T1`
  - Notes: Skill invoked as `/mcd-loops:backlog-inject <slug> [--time HH:MM]`. Default time 09:00. SKILL.md must instruct master Claude to:
    1. **Read**: check `~/.claude/channels/discord-multi/projects/<slug>/BACKLOG.md` exists. If missing: reply error, stop.
    2. **Count**: grep `^\- \[ \]` lines, reply with count.
    3. **Schedule**: `run_master_command("schedule add <slug> at <HH:MM> '[loop:backlog:<slug>] Pick the next 2 items from BACKLOG.md that are `[ ]`. Implement each, commit, push to a feature branch, open a PR. After each PR, mark the item `[x]`. If BACKLOG.md has 0 `[ ]` items: reply all done to master channel and run_master_command schedule rm <self_id>.'")`.
    4. **Save memory** with initial count.
    5. **Reply**: schedule id + pending count.

### Wave 3 — Register & Deploy

- [x] `T5` — Register plugin, update template, deploy
  - Files: `~/.claude/plugins/installed_plugins.json`, `templates/master.CLAUDE.md`, `projects/master/CLAUDE.md`
  - Estimate: small
  - Depends: `T2`, `T3`, `T4`
  - Notes:
    **(a) Register plugin:** Read `installed_plugins.json`. Add key `"mcd-loops@chan4lk"` with value:
    ```json
    [{
      "scope": "project",
      "projectPath": "/home/openclaw/.claude/channels/discord-multi/projects/master",
      "installPath": "/home/openclaw/.claude/plugins/cache/chan4lk/mcd-loops/1.0.0",
      "version": "1.0.0",
      "installedAt": "2026-06-27T00:00:00.000Z",
      "lastUpdated": "2026-06-27T00:00:00.000Z"
    }]
    ```
    Atomic write — read full JSON, add key, write back.
    **(b) Update template:** Append `## Loop Skills` section to `templates/master.CLAUDE.md`. Section content:
    - Brief intro: "Three skills amplify your words into precise goals and monitor project channels autonomously."
    - Trigger examples table (natural language → skill)
    - Skill invocation syntax for each of the three skills
    - Cancel instruction: "To stop a loop: `!project schedule list <slug>` then `!project schedule rm <id>`"
    **(c) Deploy:** Overwrite `projects/master/CLAUDE.md` with `templates/master.CLAUDE.md`. Verify `wc -l` match. Note that master subprocess restart is needed to pick up new plugin — operator can do `!project stop master` and the bot auto-respawns on next message.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
