# Proposal: Activity Feed Enhancement

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The existing `EventFeed` component shows all MCD events with no visual hierarchy or filtering. High-signal events (commits, PRs opened, injects, stalls) are buried under routine MCP calls and heartbeats. There is no way to pause the feed during review, and all events look the same — making it hard to triage at a glance.

## Proposed Solution

Enhance the existing `EventFeed` component in `apps/mission-control/components/EventFeed.tsx` with three improvements:

1. **Filter chips** — above the feed: "All | Commit | PR | Inject | Stall | Tool". Active filter persists in `localStorage`. Filtering is client-side (no refetch).

2. **Pause-on-hover** — hovering the feed freezes scroll and shows a "PAUSED" badge in the top-right corner. Mouse-leave resumes.

3. **Color-coded rows** — event categories get distinct neon colors:
   - Commit → green
   - PR opened → violet
   - Inject → amber
   - Stall detected → red (with pulse dot)
   - Tool call → slate
   - Default → dim white

Each event row also shows a compact project slug chip, linking to the Instance Grid row for that project.

### Architecture

Changes are entirely within `components/EventFeed.tsx` and the existing SSE event-type taxonomy. No new API routes required.

## Acceptance Criteria

- AC1: Filter chips visible above feed; default = "All"; state persists in localStorage
- AC2: Pause-on-hover freezes scroll; "PAUSED" badge shown; resumes on mouse-leave
- AC3: Commit and PR events render with a distinct color and truncated message preview
- AC4: Stall events render red with a pulse dot
- AC5: Clicking a project slug chip in any event row highlights that project in Instance Grid (via `?instance=` query param)
- AC6: Max 500 events retained in DOM; older events pruned silently
