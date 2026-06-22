# Proposal: Fold mission-control-hub into Next.js

**Created:** 2026-05-24
**Status:** 🟡 Draft

## Problem

Mission Control currently runs as two separate processes:
- **Next.js** (port 3001) — UI + transparent proxy
- **mission-control-hub** (port 4001) — SQLite, auth, SSE, HTTP API

This two-process architecture adds operational complexity: two services to start, two ports to expose, an internal `HUB_URL` env var to wire, and a proxy indirection that adds latency on every request. Deployment requires orchestrating both processes. The Hub has no logic that requires isolation from Next.js.

## Proposed Solution

Move all Hub logic into Next.js Route Handlers. Delete `apps/mission-control-hub/`. Single deployable unit on a single port.

- **POST /api/events** — Route Handler: Bearer auth + SQLite insert + SSE broadcast
- **GET /api/events/stream** — Route Handler: `ReadableStream` SSE, in-process fan-out
- **GET /api/instances** — Route Handler: SQLite query
- **GET /api/events** — Route Handler: SQLite query with filters
- **SQLite** — `bun:sqlite` module-level singleton (same as Hub uses today)
- **SSE fan-out** — global `Set<ReadableStreamController>` singleton in a shared module
- **Auth** — `validateApiKey()` inline, same logic, queries same SQLite instances table
- **Remove** `HUB_URL` env var, proxy files `app/api/events/route.ts` + `app/api/instances/route.ts`

## Scope

### In Scope
- Port all 4 Hub endpoints to `apps/mission-control/app/api/` Route Handlers
- Move `db.ts`, `auth.ts`, `sse.ts` logic into `apps/mission-control/src/`
- Replace proxy routes with direct implementations
- Delete `apps/mission-control-hub/` entirely
- Update README / env var docs

### Out of Scope
- Schema changes to SQLite tables
- New API endpoints or event types
- UI component changes
- Multi-process / multi-replica SSE fan-out (Redis pub/sub etc.)
- Authentication mechanism changes

## Impact

- **Files affected:** ~10–14 (4 new route handlers, 3 new lib files, 2 deleted proxy routes, hub directory deleted, package.json/README updates)
- **Complexity:** medium
- **Risk:** low — pure relocation of logic, no behavioral changes

## Open Questions

1. **Multi-process SSE:** In-process fan-out breaks if Next.js runs in cluster mode (PM2, multiple replicas). Acceptable for now? (Can add Redis adapter later if needed.)
2. **Runtime:** Confirm Next.js runs on Bun so `bun:sqlite` is available, or should we add `better-sqlite3` for Node compatibility?
3. **DB path:** `mc.db` currently defaults relative to Hub cwd. New default relative to `apps/mission-control/`?

---

**To proceed:** Review this proposal and approve to begin planning.
