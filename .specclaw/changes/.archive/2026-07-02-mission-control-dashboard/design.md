# Design: Mission Control Dashboard

**Change:** mission-control-dashboard
**Created:** 2026-05-23

## Technical Approach

Fire-and-forget HTTP emitter in MCD → central Hub → SSE → Next.js browser client. All new code; zero modification to MCD's critical message path. Hub is a standalone Bun HTTP server (no framework, matches MCD style). Dashboard is Next.js App Router with Tailwind.

## Architecture

```
[MCD instance A]  src/mission-control-emitter.ts
[MCD instance B]  src/mission-control-emitter.ts   ──POST /events (Bearer <api-key>)──▶
[MCD instance N]  src/mission-control-emitter.ts

                        ┌─────────────────────────────────────────────┐
                        │  apps/mission-control-hub/                  │
                        │  src/server.ts  (Bun HTTP)                  │
                        │    POST /events      → db.insert + sse.fan  │
                        │    GET  /events/stream → SSE to browsers    │
                        │    GET  /api/instances → instance list      │
                        │    GET  /api/events    → filtered history   │
                        │  src/db.ts      (bun:sqlite)                │
                        │  src/auth.ts    (API key lookup)            │
                        │  src/sse.ts     (SSE fan-out set)           │
                        │  Dockerfile + docker-compose.yml            │
                        └─────────────────────────────────────────────┘
                                          │  SSE
                                          ▼
                        ┌─────────────────────────────────────────────┐
                        │  apps/mission-control/  (Next.js 15)        │
                        │  app/page.tsx           ← root dashboard    │
                        │  app/api/events/route.ts ← SSE proxy        │
                        │  app/api/instances/route.ts ← REST proxy    │
                        │  components/InstanceGrid.tsx                │
                        │  components/EventFeed.tsx                   │
                        │  components/SpecclawPipeline.tsx            │
                        │  components/SchedulerTable.tsx              │
                        └─────────────────────────────────────────────┘
```

## Event Envelope Schema

```typescript
// src/mission-control-types.ts (copy into both MCD and Hub)
export type McEventType =
  | 'session_start'
  | 'session_stop'
  | 'session_killed_watchdog'
  | 'message_received'
  | 'reply_sent'
  | 'scheduler_fired'
  | 'specclaw_status_changed';

export interface McEvent {
  instance_id: string;   // SHA1(realpath(MCD_CHANNELS_DIR))
  host: string;          // os.hostname()
  user: string;          // os.userInfo().username
  ts: string;            // ISO 8601
  type: McEventType;
  payload: Record<string, unknown>;
}

// Payload shapes per type
// session_start:            { slug, chatId, model }
// session_stop:             { slug, chatId, reason }
// session_killed_watchdog:  { slug, chatId, stuckMs }
// message_received:         { chatId, userId, messageId }
// reply_sent:               { chatId, chunks, replyTo? }
// scheduler_fired:          { chatId, slug, jobId, scheduledTime }
// specclaw_status_changed:  { slug, chatId, statusMd: string (truncated 2KB) }
```

## SQLite Schema

```sql
-- db.ts bootstraps these on startup
CREATE TABLE IF NOT EXISTS instances (
  instance_id TEXT PRIMARY KEY,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  last_seen   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,  -- JSON string
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_instance   ON events(instance_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
```

## Hub API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /events | Bearer api-key | Ingest event; 200 OK or 401 |
| GET | /events/stream | none (localhost only) | SSE; `data: <json>\n\n` per event |
| GET | /api/instances | none | JSON array of instance rows |
| GET | /api/events | none | `?instance_id=&type=&since=<iso>` filtered history |

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/mission-control-types.ts` | Create | Shared event envelope types |
| `src/mission-control-emitter.ts` | Create | Fire-and-forget HTTP emitter |
| `server.ts` | Modify | 8 hook call sites; import emitter; derive instance_id on startup |
| `src/scheduler.ts` | Modify | Emit `scheduler_fired` on job fire |
| `apps/mission-control-hub/src/server.ts` | Create | Bun HTTP server (POST /events, GET /events/stream, REST) |
| `apps/mission-control-hub/src/db.ts` | Create | bun:sqlite schema + CRUD |
| `apps/mission-control-hub/src/auth.ts` | Create | API key lookup |
| `apps/mission-control-hub/src/sse.ts` | Create | SSE client set + fan-out |
| `apps/mission-control-hub/package.json` | Create | Bun app manifest |
| `apps/mission-control-hub/Dockerfile` | Create | Bun image |
| `apps/mission-control-hub/docker-compose.yml` | Create | Hub + optional dashboard |
| `apps/mission-control/` | Create | Next.js 15 App Router scaffold + 4 components |

## Key Decisions

1. **Emitter uses native `fetch` with 2s timeout** — no new dependencies in MCD; AbortController signals timeout without blocking.
2. **Hub uses raw Bun HTTP (no Express/Hono)** — matches MCD's zero-framework style; SSE via `ReadableStream` + `Response`.
3. **SSE over WebSocket for Hub→browser** — simpler, unidirectional push is sufficient; no need for browser-to-server messages on the stream.
4. **`bun:sqlite` built-in** — no external driver, matches Bun toolchain.
5. **instance_id = SHA1 of channels dir realpath** — stable across restarts, derived without coordination, unique per deployment.
6. **Specclaw watcher: `fs.watch` on STATUS.md per active project** — lightweight; only attaches after project spawns; detaches on eviction.
7. **Next.js proxies SSE/REST to Hub** — avoids CORS; Hub listens on internal port (default 4001); Next.js on 3001.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Hub down blocks MCD | Emitter is async fire-and-forget with 2s timeout; catch all errors |
| SQLite WAL lock under concurrent writes | Bun sqlite uses WAL mode by default; single writer (Hub server is single-process) |
| SSE connection count unbounded | Hub tracks client set; removes on `close` event; no cap needed for ≤10 browser tabs |
| `fs.watch` misses STATUS.md rename (atomic writes) | Watch parent dir for `rename` events in addition to `change`; re-read on any event |
| Specclaw STATUS.md missing at watcher setup | Guard with `existsSync`; attach watcher lazily on first session spawn |
