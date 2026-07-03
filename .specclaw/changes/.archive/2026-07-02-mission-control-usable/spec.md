# Spec: Mission Control Dashboard — Usable + E2E Tests

**Change:** mission-control-usable
**Created:** 2026-05-25
**Status:** 🟡 Draft

## Overview

Make the Mission Control Next.js dashboard functional: add token auth (middleware + login page), pre-populate the event feed with historical data on mount, fix duplicate SSE connections and layout issues, and add a Playwright E2E test suite targeting the production build.

## Requirements

### Functional Requirements

- FR1: All dashboard routes are protected by `MC_DASHBOARD_TOKEN`. Unauthenticated browser requests redirect to `/login`. Unauthenticated API requests return HTTP 401.
- FR2: `/login` page accepts a token input, validates it against `MC_DASHBOARD_TOKEN`, sets a `mc_token` HttpOnly cookie (24h expiry), and redirects to `/`.
- FR3: An incorrect token on `/login` shows an inline error message without page reload.
- FR4: `EventFeed` fetches up to 200 historical events from `GET /api/events?limit=200` on mount, then merges with live SSE stream, deduplicating by event `id`.
- FR5: `GET /api/events` accepts an optional `limit` query param (default 200, max 500).
- FR6: The dashboard has one SSE connection total (owned by `EventFeed`). `page.tsx` does not open its own SSE.
- FR7: `page.tsx` still computes aggregate stats (instances, events/min, healthy, degraded) using instance polling + events from `EventFeed` via a shared callback/state lift.

### Non-Functional Requirements

- NFR1: Auth token checked in Next.js middleware (edge runtime compatible — no `better-sqlite3` in middleware).
- NFR2: Cookie is HttpOnly, SameSite=Lax, Secure in production.
- NFR3: `MC_DASHBOARD_TOKEN` read at runtime; server logs warning and refuses to start if unset (enforced in middleware).
- NFR4: E2E tests run against `next build && next start` (prod build, port 3001).
- NFR5: E2E tests self-contained: use a temp SQLite DB, seed one instance + one event before running.

## Acceptance Criteria

- AC1: `curl http://localhost:3001/` without auth → HTTP 307 redirect to `/login`.
- AC2: `curl http://localhost:3001/api/instances` without auth → HTTP 401 JSON `{"error":"Unauthorized"}`.
- AC3: Posting correct token on `/login` → cookie set, redirected to `/`, dashboard visible.
- AC4: Posting wrong token on `/login` → stays on `/login`, error text visible.
- AC5: Dashboard opened fresh with seeded DB → event feed shows historical events immediately (no waiting for live SSE).
- AC6: Browser DevTools shows exactly one `/api/events/stream` connection open.
- AC7: `GET /api/events?limit=5` returns at most 5 rows.
- AC8: Playwright suite: all 6 E2E tests pass against `next start` prod build.

## Edge Cases

- `MC_DASHBOARD_TOKEN` unset: middleware returns 500 with message "MC_DASHBOARD_TOKEN not configured".
- Historical fetch fails (network error): `EventFeed` logs warning, continues with empty initial state (live SSE still works).
- SSE delivers event with same `id` as already-fetched historical event: deduplicated, not shown twice.
- `limit` param > 500: clamped to 500.
- `limit` param non-numeric: ignored, defaults to 200.

## Dependencies

- `@playwright/test` added as devDependency.
- No new runtime deps (Next.js middleware is built-in).

## Notes

- Cookie auth only for browser. API clients continue using `Authorization: Bearer` on POST. GET routes behind middleware (cookie or header accepted).
- Login page is server action or simple form POST to `/api/auth` — keep it simple, no client-side JS required for login.
