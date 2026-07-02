# Proposal: Mission Control Dashboard Fixes

**Created:** 2026-05-27
**Status:** 🟡 Draft

---

## Problem Statement

Four usability issues make the Mission Control dashboard unreliable:

1. **Instance cards show no project name or activity** — cards display a truncated `host` string and an 8-char `instance_id` prefix with no human-readable project slug or indication of what the instance is currently doing.
2. **Specclaw Pipeline always empty** — the pipeline widget only renders if `specclaw_status_changed` events are in the in-memory event stream. These events are rare; after a page reload the panel is always blank. It should read live status from each project's `.specclaw/STATUS.md` directly.
3. **Scheduler always empty** — the scheduler widget only renders if `scheduler_fired` events exist in the stream. It should read `schedules.json` from the MCD state directory so all configured jobs are visible immediately, not just those that have fired this session.
4. **Event feed disconnects silently** — the SSE stream has no keepalive heartbeat. Proxies/browsers drop idle SSE connections after ~30–60 s with no client-visible error; the feed goes stale without any indication.

---

## Proposed Solution

### T1 — Instance cards: add slug + current-activity indicator
- MC `/api/instances` enriches each row with `slug` (read from `channels.json` keyed by `instance_id` or derived from `host`).  
  OR (simpler first pass) the `mc-emitter` includes `slug` in every event payload and we persist it on the `instances` table.
- `InstanceGrid` shows `slug` as primary label and the `type` of the most-recent event as a "doing X" badge (e.g. `reply`, `build`, `progress`).

### T2 — Specclaw: read STATUS.md directly
- New API route `GET /api/specclaw` reads `$MCD_CHANNELS_DIR/projects/*/\.specclaw/STATUS.md` (glob).
- Parses each file to extract current change name + phase (propose/plan/build/verify/pr).
- `SpecclawPipeline` polls this endpoint every 30 s; falls back to event-stream data if env var not set.

### T3 — Scheduler: read schedules.json directly
- New API route `GET /api/schedules` reads `$MCD_CHANNELS_DIR/schedules.json`.
- Returns all jobs with `chatId`, `jobId`, `paused`, `nextFire`.
- `SchedulerTable` polls this endpoint every 60 s; falls back to event-stream data.

### T4 — SSE keepalive + reconnect indicator
- Stream route sends SSE comment `: keepalive\n\n` every 15 s via `setInterval`.
- `EventFeed` adds `onerror` handler: shows a "⚠ reconnecting…" chip in the controls row and auto-reconnects with 3 s delay.
- Connection state dot added to controls row (green = live, amber = reconnecting).

---

## Scope

**In:**
- `apps/mission-control/app/api/specclaw/route.ts` (new)
- `apps/mission-control/app/api/schedules/route.ts` (new)
- `apps/mission-control/app/api/events/stream/route.ts` (keepalive)
- `apps/mission-control/src/db.ts` (add `slug` column to instances if T1 uses DB approach)
- `apps/mission-control/components/InstanceGrid.tsx`
- `apps/mission-control/components/SpecclawPipeline.tsx`
- `apps/mission-control/components/SchedulerTable.tsx`
- `apps/mission-control/components/EventFeed.tsx`

**Out:**
- Authentication changes
- New dashboard panels
- Mobile layout changes
- mc-emitter changes (slug via env/config, not payload change)

---

## Impact

| Dimension | Assessment |
|-----------|-----------|
| Files changed | ~6–8 |
| Complexity | Low–Medium |
| Risk | Low — all additive; fallback paths keep current behavior if env var absent |
| Breaking changes | None |

---

## Open Questions

1. How should `slug` be resolved for instances? Option A: read `channels.json` server-side in `/api/instances`; Option B: add `slug` column to `instances` DB table, populated by the emitter sending `slug` in event payload.
2. Should `MCD_CHANNELS_DIR` be required (error if missing) or optional (graceful fallback to empty state)?
3. For T4 reconnect, should a hard page reload be offered after N failed reconnects?
