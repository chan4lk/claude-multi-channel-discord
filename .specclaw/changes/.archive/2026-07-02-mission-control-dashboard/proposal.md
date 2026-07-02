# Proposal: Mission Control Dashboard (Next.js + MCP Hub)

**Created:** 2026-05-23
**Status:** 🟡 Draft

## Problem

No single view shows what all MCD projects are doing across all running instances. Multiple MCD deployments (different machines, different users) operate independently with no shared visibility. Operators must SSH into each host individually to inspect session state, watchdog events, or specclaw pipeline progress.

## Proposed Solution

Build a **centralized Mission Control** — a Next.js app backed by a persistent **MCP Hub server** that multiple MCD instances push events to. Each MCD instance is an event producer; the Hub aggregates, persists, and fans events out to browser clients via SSE.

**Architecture:**

```
[Machine A]  MCD server.ts ──HTTP POST /events──▶ ┐
[Machine B]  MCD server.ts ──HTTP POST /events──▶ ├──▶ Mission Control Hub (Node/Bun)
[Machine C]  MCD server.ts ──HTTP POST /events──▶ ┘         │
                                                       persist to events.jsonl
                                                             │
                                                             ▼ SSE
                                                      Next.js App (browser)
                                                             │
                                                             ▼
                                                      Unified Dashboard
```

**Hub responsibilities:**
- Accept `POST /events` from any registered MCD instance (auth via shared secret / API key per instance)
- Identify source instance (`instance_id`, `host`, `user`) from event envelope
- Persist events to append-only `mission-control-events.jsonl` (or SQLite)
- Stream to browser clients via `GET /events/stream` (SSE)
- Expose REST endpoints for current project list, schedules, specclaw status per instance

**Dashboard panels:**
- Instance grid (per MCD host: status, active project count, last seen)
- Per-instance project list with Claude session status
- Live unified event feed (filterable by instance / project / event type)
- Specclaw pipeline per project across all instances
- Scheduler jobs and last-run times per instance
- Watchdog event history

**MCD changes (each instance):**
- New `src/mission-control-emitter.ts` — fire-and-forget HTTP POST to hub URL
- Hooks in `server.ts` on: message received, reply sent, session spawn/kill, watchdog trigger, scheduler fire, specclaw state change
- Config: `MISSION_CONTROL_URL` + `MISSION_CONTROL_SECRET` env vars (optional — no-op if unset)

## Scope

### In Scope
- Mission Control Hub: standalone Bun/Node HTTP server (`apps/mission-control-hub/`)
- Next.js dashboard app (`apps/mission-control/`)
- `src/mission-control-emitter.ts` in MCD — fire-and-forget emitter, silent on failure
- Event envelope schema: `{ instance_id, host, user, ts, type, payload }`
- Event types: `session_start`, `session_stop`, `session_killed_watchdog`, `message_received`, `reply_sent`, `scheduler_fired`, `specclaw_status_changed`
- Per-instance API key auth on Hub
- Event persistence: append-only JSONL or SQLite
- SSE stream to browser
- Specclaw STATUS.md polling per registered instance (Hub pulls periodically)

### Out of Scope
- Write/control ops from dashboard
- Role-based access control (API key per instance is sufficient v1)
- Mobile layout
- Cloud hosting / managed deployment
- Bi-directional MCP (Hub → MCD control plane)

## Impact

- **Files affected:** 2 new apps (`apps/mission-control-hub/`, `apps/mission-control/`), 1 new MCD file (`src/mission-control-emitter.ts`), ~8–12 hook call sites in `server.ts`
- **Complexity:** large
- **Risk:** low-medium — emitter is fire-and-forget (failures silent, never block MCD), hub is additive infrastructure

## Decisions

| Question | Decision |
|----------|----------|
| Repo structure | Monorepo — `apps/mission-control-hub/` + `apps/mission-control/` in this repo |
| Event persistence | SQLite — queryable, filterable, single file |
| Hub hosting | Containerized — `Dockerfile` + `docker-compose.yml` in `apps/mission-control-hub/` |
| Specclaw data | MCD emits specclaw events directly (no polling sidecar) |

---

**To proceed:** Approve this proposal to begin planning.
