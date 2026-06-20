# Proposal: Stall Alert Panel

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

Stalled channels are invisible in the dashboard. Operators discover stalls only via the heartbeat Discord message or by manually checking each channel. There is no at-a-glance triage surface for the most operationally urgent situation: a Claude agent blocked waiting for input or stuck in a broken tool call.

## Proposed Solution

Add a `StallAlertPanel` component as a collapsible panel (or dedicated tab) in the mission control dashboard. A `/api/stalls` endpoint classifies each project's transcript using the same `classifyChannel` logic from `src/heartbeat.ts`. The panel shows:

| Column | Description |
|--------|-------------|
| Slug | Project name (links to Instance Grid row) |
| Reason | `question-unanswered` or `tool-incomplete` |
| Age | How long it has been stalled (minutes) |
| Snippet | Last 120 chars of transcript that triggered the stall |
| Action | "Inject" button |

The Inject button opens a pre-filled dialog with a suggested continuation prompt derived from the stall reason. On confirm, it fires a POST to a `/api/inject` endpoint (proxies to `mcp__mcd__inject`). The row is then removed optimistically and reappears on the next poll if still stalled.

### Architecture

- `apps/mission-control/app/api/stalls/route.ts` — reads `channels.json`, runs `classifyChannel` on each project's transcript
- `apps/mission-control/components/StallAlertPanel.tsx` — table + inject dialog
- Inject endpoint calls `run_master_command` or directly writes to the MCD tmux send-keys path (TBD)

## Acceptance Criteria

- AC1: Panel auto-refreshes every 30s; stall count shown in Fleet Health Bar badge
- AC2: Stall reason and snippet derived from actual transcript content via `classifyChannel`
- AC3: Inject dialog pre-populates prompt by stall type; operator can edit before confirming
- AC4: After inject, row removed optimistically; reappears if still stalled on next refresh
- AC5: Empty state displayed with a green "All clear ✓" message when no stalls
- AC6: Rows stalled longer than the project's `stuckThresholdMinutes` highlighted in red
