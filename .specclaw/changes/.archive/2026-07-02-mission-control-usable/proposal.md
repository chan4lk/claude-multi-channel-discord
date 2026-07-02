# Proposal: Mission Control Dashboard — Usable + E2E Tests

**Created:** 2026-05-25
**Status:** 🟡 Draft (revised: better-auth multi-user)

## Problem

Mission Control dashboard has three blockers making it unusable:

1. **No data on load** — `EventFeed` only receives live SSE events; no historical events fetched on mount. Empty DB = all placeholder text.
2. **No auth** — all GET routes unprotected. Anyone with the URL sees the dashboard.
3. **UI rendering issues** — duplicate SSE connections (page.tsx + EventFeed both open streams); missing `bg-cyber-bg` base layer breaks glassmorphism; layout breaks when empty.

Zero automated tests.

## Proposed Solution

### 1. Multi-user auth via better-auth v1.6.x
- Email + password authentication with session cookies
- better-auth SQLite adapter reuses existing `mc.db` (separate `auth` tables auto-created via migration)
- Route handler at `app/api/auth/[...all]/route.ts`
- Middleware: cookie-presence check (edge-safe; full session validation in server components)
- Login page uses better-auth client (`signIn.email()`)
- Initial admin seeded from `MC_ADMIN_EMAIL` + `MC_ADMIN_PASSWORD` env vars at startup
- Admin page `/admin/users` to add further users

### 2. Historical data on mount
- `EventFeed` fetches `GET /api/events?limit=200` on mount, merges with live SSE, deduplicates by `id`

### 3. UI fixes
- Remove duplicate SSE from `page.tsx`; EventFeed owns stream, exposes `onEvent` callback
- Add `bg-cyber-bg` to `layout.tsx` body
- Fix empty-state grid layout

### 4. E2E tests with Playwright
- `next build && next start` on port 3002
- Seeds test users + events in temp DB
- 6 tests: unauthed redirect, login wrong/correct, historical data visible, single SSE connection

## Scope

### In Scope
- `apps/mission-control/src/auth.ts` (REWRITE — better-auth config, replaces simple API key validator)
- `apps/mission-control/src/auth-client.ts` (CREATE)
- `apps/mission-control/src/seed-admin.ts` (CREATE — seeds admin user from env vars)
- `apps/mission-control/middleware.ts` (CREATE — cookie-presence check)
- `apps/mission-control/app/api/auth/[...all]/route.ts` (CREATE)
- `apps/mission-control/app/login/page.tsx` (CREATE)
- `apps/mission-control/app/admin/users/page.tsx` (CREATE — list + add users)
- `apps/mission-control/app/api/events/route.ts` — add `limit` param to GET
- `apps/mission-control/components/EventFeed.tsx` — historical fetch + onEvent prop
- `apps/mission-control/app/page.tsx` — remove SSE
- `apps/mission-control/app/layout.tsx` — bg fix
- `apps/mission-control/playwright.config.ts` (CREATE)
- `apps/mission-control/e2e/` (CREATE — setup, teardown, spec)
- `apps/mission-control/package.json` — add better-auth, @playwright/test

### Out of Scope
- OAuth / SSO providers
- Role-based access control (all authenticated users see everything)
- Redesigning the visual theme

## Impact

- **Files affected:** ~14 (estimated)
- **Complexity:** medium
- **Risk:** low-medium — better-auth migration step required; existing API key POST auth preserved

## Open Questions

1. Should `src/auth.ts` use the same `mc.db` (separate tables) or a new `auth.db`? (Prefer same DB — simpler ops.)
2. Admin user management: env var seed only, or also UI to add users?

---

**To proceed:** Review this proposal and approve to begin planning.
