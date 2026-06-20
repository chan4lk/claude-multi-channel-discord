# Proposal: Proposal / Backlog Overlay

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

There is no way to see each project's pending workload (specclaw proposals, BACKLOG.md items) alongside its runtime status. Operators cannot prioritise which channel needs their attention based on queue depth — they have to manually inspect each project's repo to discover what is pending.

## Proposed Solution

Add a "Backlog" toggle to the Instance Grid (keyboard shortcut `B`). When enabled, each project card gains a glowing halo ring; ring brightness (0–100% neon glow) scales with pending proposal count. A `/api/backlog` endpoint scans all project working directories listed in `channels.json`, reads each project's `.specclaw/STATUS.md` (if present), and counts proposals with status `pending` or `in-progress`.

Clicking the halo on a project card opens a side drawer listing proposals:
- Title
- Status badge (🟡 Draft / 🔨 In Progress)
- Created date
- Relative file path (for operator reference)

The overlay is additive — it does not replace the Instance Grid, just augments the cards.

### Architecture

- `apps/mission-control/app/api/backlog/route.ts` — reads `channels.json`, scans each `projectDir` for `.specclaw/STATUS.md`, parses counts
- Instance Grid card extended with optional halo ring (CSS `box-shadow` + `filter: drop-shadow`)
- Drawer component reused from existing pattern (GlassCard sliding panel)

## Acceptance Criteria

- AC1: Halo renders as a neon ring; dim = 1 pending item, bright + pulsing = 5+ items
- AC2: Projects with no specclaw changes show no halo (no visual noise)
- AC3: Drawer lists each pending proposal: title, status badge, created date
- AC4: Toggle activated with `B` key; state persists in localStorage
- AC5: `/api/backlog` scans all project dirs in `channels.json`; returns within 2s
- AC6: Overlay updates within 30s of a `.specclaw/STATUS.md` change
