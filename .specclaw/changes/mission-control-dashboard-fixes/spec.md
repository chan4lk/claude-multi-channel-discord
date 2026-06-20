# Spec: Mission Control Dashboard Fixes

**Change:** mission-control-dashboard-fixes  
**Created:** 2026-05-27  
**Status:** 📋 Planned

---

## Functional Requirements

### FR1 — Instance cards show active projects + current activity
- FR1.1: `/api/instances` response includes `activeSlugs: string[]` (distinct slugs from events in last 5 min for that instance) and `lastActivity: string` (most recent event `type`).
- FR1.2: `InstanceGrid` displays `activeSlugs` as chips inside each card.
- FR1.3: `InstanceGrid` displays `lastActivity` as a "doing X" badge (replacing or augmenting the status badge when `lastActivity` is present).
- FR1.4: Instance card title remains `host`; `activeSlugs` appears below as a secondary row.

### FR2 — Specclaw Pipeline reads STATUS.md directly
- FR2.1: New `GET /api/specclaw` route reads `$MCD_CHANNELS_DIR/projects/*/.specclaw/STATUS.md` via glob.
- FR2.2: Response is `Array<{ slug: string; changes: Array<{ name: string; status: 'active'|'completed'|'failed'; tasksTotal: number; tasksDone: number; phase: 'propose'|'plan'|'build'|'verify'|'pr' }> }>`.
- FR2.3: `SpecclawPipeline` polls `/api/specclaw` every 30 s on mount.
- FR2.4: If `MCD_CHANNELS_DIR` env var is not set, route returns `[]` (no error).
- FR2.5: Only active (non-completed) changes are returned.

### FR3 — Scheduler reads schedules.json directly
- FR3.1: New `GET /api/schedules` route reads `$MCD_CHANNELS_DIR/schedules.json`.
- FR3.2: Resolves `chatId → slug` from `$MCD_CHANNELS_DIR/channels.json`.
- FR3.3: Response is `Array<{ id: string; chatId: string; slug: string; at: string; prompt: string; enabled: boolean; lastRunAt: string|null; runCount: number; maxRuns: number|null }>`.
- FR3.4: If `MCD_CHANNELS_DIR` not set, returns `[]`.
- FR3.5: `SchedulerTable` polls `/api/schedules` every 60 s on mount; renders this data instead of event-derived data.

### FR4 — SSE keepalive + connection indicator
- FR4.1: Stream route sends SSE comment `: keepalive\n\n` every 15 s.
- FR4.2: `EventFeed` shows a connection state dot: green = connected, amber = reconnecting.
- FR4.3: On SSE `onerror`, `EventFeed` waits 3 s then creates a new `EventSource`.
- FR4.4: Reconnect attempts shown in controls row as "⚠ reconnecting…" text.
- FR4.5: Keepalive interval is cleared when the stream is cancelled.

---

## Non-Functional Requirements

- NFR1: All new API routes protected by existing session auth middleware.
- NFR2: File reads are synchronous (`fs.readFileSync`) — calls are infrequent (poll-based), no need for streaming.
- NFR3: Malformed STATUS.md or schedules.json must not crash the route; return partial data with best-effort parse.
- NFR4: New endpoints respond in < 500 ms on a local filesystem with ≤ 20 projects.

---

## Acceptance Criteria

- AC1: Instance card shows at least one slug chip when a session_start event was emitted in the last 5 min.
- AC2: Specclaw Pipeline is non-empty after page reload when any project has a `.specclaw/STATUS.md` with active changes.
- AC3: Scheduler table shows all enabled and disabled jobs from `schedules.json` after page load (no need for scheduler_fired event).
- AC4: Event feed reconnects within 5 s of SSE disconnect without requiring a page reload.
- AC5: SSE keepalive comment is sent every 15 s (verifiable via `curl` of the stream endpoint).
- AC6: If `MCD_CHANNELS_DIR` is unset, `/api/specclaw` and `/api/schedules` return HTTP 200 with `[]`.

---

## Edge Cases

- EC1: Project dir exists in `channels.json` but no `.specclaw/STATUS.md` — skip silently.
- EC2: `schedules.json` missing `schedules` key or is empty array — return `[]`.
- EC3: `chatId` in `schedules.json` has no matching entry in `channels.json` — use `chatId` as slug fallback.
- EC4: Multiple events for same slug within 5-min window — deduplicate, show slug once.
- EC5: SSE stream in Next.js edge/serverless context — keepalive interval must be stored and cleared on cancel.
