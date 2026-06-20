# Proposal: Schedule Timeline

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The existing `SchedulerTable` shows schedules as a flat table with no temporal context. Operators cannot see when the next job will fire relative to other jobs, which jobs are overdue, or how the schedule load clusters across the day. For a fleet with many projects and daily jobs, the table requires scrolling and mental arithmetic to understand timing.

## Proposed Solution

Add a horizontal swimlane timeline view (togglable with the existing table) covering a 24-hour window centered on "now". Implementation inside `components/SchedulerTable.tsx` as a second tab/view mode.

**Layout:**
- One swimlane row per project that has scheduled jobs
- Project slug labels fixed on the left (sticky column)
- Timeline scrollable horizontally
- 24h window; current time shown as a vertical red "now" line

**Job blocks:**
- Interval jobs: block spanning last-run → next-run; countdown ticking live
- Daily HH:MM jobs: vertical tick at the scheduled time; filled if fired today, hollow if upcoming
- Paused jobs: strikethrough + dimmed

**Interaction:**
- Clicking a job block opens a popover: full schedule config, "Copy inject command" button

### Architecture

- New `TimelineView` component inside `components/SchedulerTable.tsx` (same data source: `/api/schedules`)
- No new API routes — existing `/api/schedules` response extended with `lastRunAt` timestamp if not already present
- `requestAnimationFrame` loop for live countdown ticking

## Acceptance Criteria

- AC1: All entries from `schedules.json` rendered; 24h window centered on current time
- AC2: Next-run countdown ticks live without page refresh
- AC3: Paused schedules shown dimmed with strikethrough label
- AC4: Timeline scrollable horizontally; slug labels fixed on left
- AC5: "Copy inject command" available in job block popover
- AC6: Jobs that fired within the last hour show a trailing "last ran Xm ago" marker
- AC7: Toggle between table view and timeline view persists in localStorage
