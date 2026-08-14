# Proposal: progressMode "phases" — SpecClaw Phase-Level Progress

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

For 24/7 specclaw loops, the existing progress modes are the wrong altitude. `edit` mode streams raw tool calls — tonight's dstm-apps channel is a wall of `🔧 Bash: specclaw-update-task-status …`, `✅ Bash (2000ms)` lines that tell the operator nothing about lifecycle position. `off` is silent for 20+ minute turns. What the operator actually wants from an autonomous loop is one line per meaningful transition: *entered build*, *task 4/8 done*, *verify green*, *PR opened*.

MCD already has both halves: transcript polling infrastructure emitting `ToolProgressEvent` (`src/claude-process.ts` → `ProjectPool` → `server.ts:handleToolProgressEvent()`), and specclaw state on disk that changes exactly at phase boundaries.

## Proposed Solution

Add `progressMode: "phases"`:

1. **Detection:** during active turns, watch the project's `.specclaw/` for meaningful diffs — poll `.specclaw/STATUS.md` and the active change's `status.md`/`tasks.md` mtimes on the existing `TMUX_POLL_INTERVAL_MS` cycle (no new timers), reusing `readSpecclawStatus()`. Diff against the last snapshot to classify the transition: phase change (plan→build), task completion count change, verify verdict, new change started.
2. **Output:** maintain one Discord message per specclaw *change* (edit-in-place, like `edit` mode does per turn), growing a compact timeline:

   ```
   🦞 01-project-scaffold
   ├ 02:10 build started (8 tasks)
   ├ 02:24 tasks 3/8 ✅
   ├ 02:41 verify 🟢
   └ 02:44 PR #12 opened
   ```
3. **Fallback:** if no `.specclaw/` present, behave as `off` (documented) rather than falling back to tool-spam.

## Scope

### In Scope
- `src/channels-config.ts`: allow `"phases"` in the progressMode enum
- Snapshot/diff logic on the existing poll cycle
- `server.ts`: phases dispatch path (one message per change, edit-in-place)
- Tests: transition classification from fixture file sequences

### Out of Scope
- Mixing modes (phases + tool calls simultaneously)
- Teams/WhatsApp parity in v1 (Discord first; message-edit support differs)
- Detecting phases for non-specclaw projects

## Impact

- **Files affected:** 4 (estimated)
- **Complexity:** medium
- **Risk:** low — new opt-in mode, existing modes untouched

## Open Questions

- Depends on `specclaw-status-visibility` parser.
- Timestamps: use file mtimes or poll-observation time? Proposal: observation time, simpler and close enough at 2s polling.

---

**To proceed:** Review this proposal and approve to begin planning.
