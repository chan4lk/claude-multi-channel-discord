# Spec: Mission Control Dashboard

**Change:** mission-control-dashboard
**Created:** 2026-05-23
**Status:** 🟡 Draft

## Overview

Distributed, read-only observability dashboard for MCD. Multiple MCD instances emit structured events to a central Hub server. Hub persists to SQLite and streams to a Next.js browser dashboard via SSE. MCD emitter is fire-and-forget — Hub unavailability never impacts MCD operation.

## Requirements

### Functional Requirements

- FR1: MCD instances emit structured events to Hub via HTTP POST with per-instance API key auth
- FR2: Hub persists all received events to SQLite with full envelope (instance_id, host, user, ts, type, payload)
- FR3: Hub rejects events from unknown or invalid API keys
- FR4: Hub streams all incoming events to all connected browser clients via SSE
- FR5: Hub exposes REST endpoints: instance list, per-instance event history (filterable by type + since timestamp)
- FR6: Next.js dashboard renders instance grid (host, user, active project count, last-seen)
- FR7: Dashboard renders per-project Claude session status (active / idle / stuck / stopped) derived from events
- FR8: Dashboard renders live event feed, filterable by instance / project / event type
- FR9: Dashboard renders specclaw change pipeline per project (proposed → planned → building → verified → PR)
- FR10: Dashboard renders scheduler job table per instance (last fired, next scheduled time)
- FR11: MCD emitter is optional — if `MISSION_CONTROL_URL` env var is unset, all emit calls are no-ops
- FR12: Hub and dashboard launch via `docker-compose up` from `apps/mission-control-hub/`

### Non-Functional Requirements

- NFR1: Emitter adds ≤5ms to MCD event path (async fire-and-forget with 2s timeout)
- NFR2: Emitter failure (network error, timeout) is caught and logged as warning only — never throws
- NFR3: Hub SQLite file is a single portable file; path configurable via `MC_DB_PATH` env
- NFR4: Hub handles concurrent SSE clients and concurrent POST /events without data races
- NFR5: Dashboard updates without page refresh (SSE-driven)

## Acceptance Criteria

- AC1: MCD emits `session_start` event when `ClaudeProjectProcess.start()` completes TUI ready
- AC2: MCD emits `session_stop` event when a project is stopped gracefully
- AC3: MCD emits `session_killed_watchdog` event when watchdog kills a session
- AC4: MCD emits `message_received` event in `messageCreate` handler after access gate passes
- AC5: MCD emits `reply_sent` event in `dispatchProjectReply` after Discord send succeeds
- AC6: MCD emits `scheduler_fired` event when `scheduler.tick()` fires a due job
- AC7: MCD emits `specclaw_status_changed` event when a project's `.specclaw/STATUS.md` changes (file watcher)
- AC8: Hub persists every accepted event to SQLite `events` table
- AC9: Hub returns HTTP 401 for POST /events with missing or unknown API key
- AC10: Hub SSE stream delivers all events to all connected clients within 500ms of receipt
- AC11: Dashboard instance grid shows all instances that have emitted at least one event
- AC12: Dashboard event feed updates in real time without page reload
- AC13: `docker-compose up` in `apps/mission-control-hub/` starts Hub and serves dashboard on port 3001
- AC14: MCD with `MISSION_CONTROL_URL` unset starts and operates with zero errors from emitter

## Edge Cases

- **Hub unreachable:** Emitter catches error, logs `[mission-control] warn: <msg>`, returns; MCD continues unaffected
- **Hub overloaded / slow:** Emitter enforces 2s fetch timeout; does not block event path
- **Multiple browser tabs:** SSE fan-out sends each event to all connected `Response` streams
- **Instance restart:** Hub tracks `last_seen` per instance; dashboard shows instance as stale (gray) after 5min with no events
- **SQLite growth:** `events` table has `created_at` index; Hub prunes events older than `MC_RETENTION_DAYS` (default: 30) on startup
- **Specclaw not initialized in project:** `specclaw_status_changed` watcher only attaches if `.specclaw/STATUS.md` exists; dashboard shows "no specclaw" cell
- **Project has no `.session-id` yet:** `session_start` payload includes `slug` only; no session UUID until capture completes

## Dependencies

- Bun (Hub runtime — matches existing MCD dev toolchain)
- Next.js 15 App Router (dashboard)
- `bun:sqlite` built-in (no external SQLite driver)
- `better-sse` or raw `Response` + `ReadableStream` for SSE in Hub
- Tailwind CSS (dashboard styling)

## Notes

- Event envelope schema defined in `src/mission-control-types.ts` (shared between MCD and Hub via copy or symlink)
- `instance_id` = SHA1 of `MCD_CHANNELS_DIR` realpath (stable across restarts, unique per deployment)
- Hub API key registration: manual — add row to `instances` table via sqlite3 CLI or Hub admin endpoint (v1: no UI for this)
