# Proposal: Project Graph View

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The Instance Grid shows projects as a flat list. Operators cannot see spatial relationships, coordination links (which channels have injected into others), or get an at-a-glance picture of fleet topology. Discovering which projects are busy, stalled, or autonomous requires reading every row individually.

## Proposed Solution

Add a `/graph` route in `apps/mission-control/` with a force-directed D3 node graph. Each project in `channels.json` becomes a neon node:

- **Color** encodes state: cyan=idle, amber=active, red=stalled, purple=autonomous
- **Size** encodes recent message volume (from `events` DB table, last 1h)
- **Edges** connect projects that have exchanged inject events (directed arrows)
- **Hover** shows a tooltip: slug, model, last-active timestamp, CLAUDE.md excerpt (first 200 chars)
- **Click** opens a side drawer with full project config and latest transcript snippet

Graph layout saved to `localStorage` per-session. A "Reset layout" button re-randomises positions.

### Architecture

- `apps/mission-control/app/graph/page.tsx` — D3 force simulation, SVG canvas
- `apps/mission-control/app/api/graph/route.ts` — returns nodes (from `channels.json`) + edges (from inject events in `events` DB)
- D3 via `npm install d3` or `import from 'd3'` (already used in similar projects)

## Acceptance Criteria

- AC1: All projects in `channels.json` appear as nodes within 1s of page load
- AC2: Node state colors update on ≤ 5s poll
- AC3: Stalled nodes pulse via CSS animation
- AC4: Clicking a node opens a drawer: slug, model, last-active, CLAUDE.md excerpt, link to Instance Grid row
- AC5: Inject edges rendered as directed arrows; graph renders without edges when none recorded
- AC6: Empty graph (no projects) shows a placeholder, no crash
- AC7: Node layout persists in localStorage; "Reset" button available
