# Spec: Mission Control Overhaul — Hub Consolidation + Futuristic UI/UX

**Change:** mission-control-ui-redesign
**Created:** 2026-05-24
**Status:** 🟡 Draft

## Overview

Consolidate the two-process mission-control deployment (Next.js + separate hub) into a single Next.js app, then redesign the UI with a cyber-ops / mission-control dark aesthetic. Single deployable unit on one port; visually communicates urgency, health, and activity at a glance.

## Requirements

### Functional Requirements

**FR1 — Hub consolidation:** All four hub endpoints (`POST /events`, `GET /events/stream`, `GET /api/instances`, `GET /api/events`) are implemented as Next.js Route Handlers inside `apps/mission-control/`. No proxy indirection.

**FR2 — Event ingestion:** `POST /api/events` validates Bearer token against `instances` table, inserts event into SQLite, updates `last_seen`, and broadcasts to all active SSE clients.

**FR3 — SSE fan-out:** `GET /api/events/stream` delivers a persistent Server-Sent Events stream using an in-process `Set<ReadableStreamDefaultController>` singleton.

**FR4 — Instance listing:** `GET /api/instances` returns all instance rows from SQLite ordered by `created_at DESC`.

**FR5 — Event history:** `GET /api/events` returns filtered event history supporting `?instance_id=`, `?type=`, and `?since=` query params.

**FR6 — Single-process start:** `bun next dev` / `bun next start` is the only process required. `HUB_URL` env var is removed. Hub directory is deleted.

**FR7 — Dark-first UI:** Dashboard renders with cyber-ops palette: near-black `#080C14` background, electric cyan `#00F5FF` primary chrome, amber `#F59E0B` warnings, crimson errors, slate glass panels. No light-mode toggle.

**FR8 — Animated instance status:** InstanceGrid cards display `PulseRing` with pulsing animation for active instances (last_seen < 5 min), flat ring for stale, red strobe ring for stuck/killed events.

**FR9 — Live sparklines:** InstanceGrid cards show `Sparkline` of recent event frequency, derived client-side from buffered SSE events (no new API endpoint).

**FR10 — EventFeed redesign:** Events are color-coded by type, animate in with slide+fade, watchdog/error events are pinned to top. Compact mode toggle available.

**FR11 — SpecclawPipeline redesign:** Horizontal progress track with glow-sweep animation on active tasks; checkmark pop on complete.

**FR12 — SchedulerTable redesign:** Shows countdown to next-fire time; pill badges for enabled/paused state.

**FR13 — HUD header:** Global stats bar showing total instance count, events/min rate, healthy vs degraded counts, elapsed uptime.

**FR14 — Typography:** `JetBrains Mono` for IDs/timestamps/counts; `Inter` for prose/labels.

**FR15 — Responsive layout:** CSS Grid with named areas; collapses to single-column below `lg` breakpoint.

### Non-Functional Requirements

**NFR1 — Runtime:** Next.js is run under Bun (`bun next dev` / `bun next start`). `bun:sqlite` is used for SQLite. If this breaks, add `better-sqlite3` as fallback — but Bun runtime is the baseline assumption.

**NFR2 — SSE single-process only:** In-process fan-out does not support Next.js cluster mode. Acceptable for operator monitoring tool.

**NFR3 — DB path:** `MC_DB_PATH` env var (default: `./mc.db` relative to `apps/mission-control/` process cwd). Same semantics as hub.

**NFR4 — Bundle size:** Framer Motion (~45kB gzip) is acceptable per proposal.

**NFR5 — TypeScript:** `bun tsc --noEmit` passes with no errors in `apps/mission-control/`.

**NFR6 — No schema changes:** SQLite tables unchanged from hub definition.

## Acceptance Criteria

**AC1:** `bun next dev` in `apps/mission-control/` starts the dashboard — no second process required.

**AC2:** `curl -X POST http://localhost:3001/api/events -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"instance_id":"x","host":"h","user":"u","ts":"2026-01-01T00:00:00Z","type":"spawn","payload":{}}' ` returns `200 OK`.

**AC3:** `curl http://localhost:3001/api/events/stream` returns `Content-Type: text/event-stream` and keeps the connection open.

**AC4:** `curl http://localhost:3001/api/instances` returns a JSON array.

**AC5:** `curl "http://localhost:3001/api/events?type=spawn"` returns a JSON array of spawn events.

**AC6:** `HUB_URL` does not appear in any `.ts` file under `apps/mission-control/`.

**AC7:** `apps/mission-control-hub/` directory does not exist.

**AC8:** Dashboard at `http://localhost:3001` renders with `#080C14` background and cyan/amber palette (inspect computed styles).

**AC9:** InstanceGrid shows animated pulsing ring for active instances, flat ring for stale.

**AC10:** New events in EventFeed animate in with slide+fade transition.

**AC11:** SpecclawPipeline renders horizontal progress track (not vertical list).

**AC12:** SchedulerTable shows countdown timers and pill state badges.

**AC13:** HUD header shows instance count, events/min, healthy/degraded counts, uptime.

**AC14:** `bun tsc --noEmit` exits 0 in `apps/mission-control/`.

**AC15:** EventFeed and InstanceGrid subscribe to `/api/events/stream` (not `/api/events`).

## Edge Cases

**EC1 — SSE client disconnect:** `cancel()` on the stream removes the controller from the set. No memory leak.

**EC2 — Invalid Bearer token:** `POST /api/events` returns `401`. No event inserted.

**EC3 — Malformed JSON body:** `POST /api/events` returns `400`.

**EC4 — No instances registered:** InstanceGrid shows empty state without crashing.

**EC5 — No events received:** EventFeed shows "Waiting for events…" empty state.

**EC6 — Sparkline with < 2 data points:** Renders gracefully (flat line or single dot).

**EC7 — MC_DB_PATH not set:** Falls back to `./mc.db` relative to process cwd.

**EC8 — Very long instance_id / host / user strings:** UI truncates with `truncate` + `title` attribute.

## Dependencies

- `framer-motion` — animation library
- `@fontsource/jetbrains-mono` — monospace font
- `@fontsource/inter` — prose font
- `bun:sqlite` — SQLite driver (already used in hub; assumed available under Bun Next.js)
- Next.js 15 `ReadableStream` Route Handlers with `export const dynamic = 'force-dynamic'`

## Notes

- EventFeed and page.tsx both open independent EventSource connections to `/api/events` (current). After consolidation both must point to `/api/events/stream`.
- `apps/mission-control/app/api/events/route.ts` currently only has `GET` (proxy to stream). After change it needs both `GET` (filtered history) and `POST` (ingest). The stream moves to `app/api/events/stream/route.ts`.
- `apps/mission-control-hub/` deletion must be a `git rm -r` to be tracked.
- `SchedulerTable` currently derives data from live SSE events only (no `/api/schedules` endpoint). The redesign keeps this; countdown timers count down to next midnight-aligned HH:MM using local time.
