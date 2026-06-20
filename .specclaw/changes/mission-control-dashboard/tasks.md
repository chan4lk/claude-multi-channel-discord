# Tasks: Mission Control Dashboard

**Change:** mission-control-dashboard
**Created:** 2026-05-23
**Total Tasks:** 11

## Summary

4 waves. Wave 1 lays the shared types and MCD emitter (no functional change to MCD yet). Wave 2 hooks the emitter into MCD lifecycle points. Wave 3 builds the Hub server. Wave 4 builds the Next.js dashboard. Each wave is independently deployable.

## Tasks

### Wave 1 — Shared types + MCD emitter (zero MCD behavior change)

- [x] `T1` — Define shared event envelope types
  - Files: `src/mission-control-types.ts` (create)
  - Estimate: small
  - Depends: —
  - Notes: `McEvent`, `McEventType`, per-type payload shapes. Pure types, no runtime code.

- [x] `T2` — Implement fire-and-forget emitter
  - Files: `src/mission-control-emitter.ts` (create)
  - Estimate: small
  - Depends: T1
  - Notes: Reads `MISSION_CONTROL_URL` + `MISSION_CONTROL_SECRET` from env. If URL unset → no-op. Uses `fetch` with `AbortController` (2s timeout). All errors caught + logged as warning. Exports `emitEvent(e: McEvent): void` and `buildEmitter(instanceId: string, host: string, user: string)` factory.

- [x] `T3` — Derive instance_id + wire emitter in server.ts
  - Files: `server.ts` (modify — import + 3 lines in `initialize()`)
  - Estimate: small
  - Depends: T2
  - Notes: `instance_id = sha1(realpathSync(MCD_CHANNELS_DIR))`. Build emitter once at startup, store in module scope. No hooks yet — just initialization.

### Wave 2 — MCD lifecycle hooks

- [x] `T4` — Hook message_received + reply_sent
  - Files: `server.ts` (modify — 2 call sites)
  - Estimate: small
  - Depends: T3
  - Notes: `message_received` in `messageCreate` handler after access gate passes. `reply_sent` in `dispatchProjectReply` after Discord send. Payload: see design.md.

- [x] `T5` — Hook session lifecycle (start, stop, watchdog kill)
  - Files: `server.ts` (modify — 3 call sites), `src/project-pool.ts` (modify — expose kill event if needed)
  - Estimate: small
  - Depends: T3
  - Notes: `session_start` after `waitForTuiReady` resolves in pool factory. `session_stop` on graceful stop. `session_killed_watchdog` on watchdog kill path. Check where `killProject` is called in pool — emit there.

- [x] `T6` — Hook scheduler_fired
  - Files: `src/scheduler.ts` (modify — 1 call site)
  - Estimate: small
  - Depends: T3
  - Notes: Emit after `deliver()` resolves in `tick()`. Payload: `{ chatId, slug, jobId, scheduledTime }`.

- [x] `T7` — Hook specclaw_status_changed (fs.watch)
  - Files: `server.ts` (modify — attach/detach watchers per project spawn/evict)
  - Estimate: medium
  - Depends: T3
  - Notes: On session spawn, if `<project-dir>/.specclaw/STATUS.md` exists, `fs.watch` parent dir for change/rename. Debounce 500ms. Read STATUS.md (truncate to 2KB). Emit `specclaw_status_changed`. Detach watcher on session eviction or stop. Guard `existsSync` before attaching.

### Wave 3 — Hub server

- [x] `T8` — Hub server: db + auth + SSE + HTTP
  - Files: `apps/mission-control-hub/src/db.ts` (create), `apps/mission-control-hub/src/auth.ts` (create), `apps/mission-control-hub/src/sse.ts` (create), `apps/mission-control-hub/src/server.ts` (create), `apps/mission-control-hub/package.json` (create)
  - Estimate: large
  - Depends: T1
  - Notes: Single wave — all Hub code is new with no existing entanglement. SQLite schema from design.md. `bun:sqlite` WAL mode. SSE via `ReadableStream` + `Response`. POST /events validates Bearer key, inserts row, fans to SSE clients. GET /events/stream returns SSE response, adds client to set, removes on close. GET /api/instances + GET /api/events with query filters. Prune events older than `MC_RETENTION_DAYS` (default 30) on startup.

- [x] `T9` — Hub containerization
  - Files: `apps/mission-control-hub/Dockerfile` (create), `apps/mission-control-hub/docker-compose.yml` (create)
  - Estimate: small
  - Depends: T8
  - Notes: `FROM oven/bun:1`. Expose port 4001. Volume mount for SQLite file. `docker-compose.yml` wires Hub + passes `MC_DB_PATH`, `MC_PORT` env vars.

### Wave 4 — Next.js dashboard

- [x] `T10` — Dashboard scaffold + SSE hook + EventFeed
  - Files: `apps/mission-control/` (create — Next.js 15 App Router + Tailwind), `apps/mission-control/app/api/events/route.ts`, `apps/mission-control/components/EventFeed.tsx`
  - Estimate: large
  - Depends: T8
  - Notes: `npx create-next-app` with App Router + Tailwind. API route proxies Hub SSE. `EventFeed` uses `useEffect` + `EventSource`. Filterable by type. Live update no page refresh.

- [x] `T11` — Dashboard panels + root page
  - Files: `apps/mission-control/components/InstanceGrid.tsx`, `apps/mission-control/components/SpecclawPipeline.tsx`, `apps/mission-control/components/SchedulerTable.tsx`, `apps/mission-control/app/api/instances/route.ts`, `apps/mission-control/app/page.tsx`
  - Estimate: large
  - Depends: T10
  - Notes: InstanceGrid fetches GET /api/instances, derives status from last_seen age. SpecclawPipeline and SchedulerTable derive state from accumulated SSE events (client-side event store). Root page wires all components. Stale instance = last_seen > 5min → gray indicator.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
