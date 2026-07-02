# Tasks: Mission Control Dashboard — Usable + E2E Tests

**Change:** mission-control-usable
**Created:** 2026-05-25 (revised: better-auth multi-user)
**Total Tasks:** 9

## Summary

Wave 1: Install deps + better-auth core setup + migration. Wave 2: Middleware, login page, admin users page. Wave 3: Data/SSE fixes. Wave 4: Playwright E2E. Each wave depends on the previous.

## Tasks

### Wave 1 — Dependencies & better-auth Core

- [x] `T1` — Install better-auth, run migration
  - Files: `apps/mission-control/package.json` (MODIFY)
  - Estimate: small
  - Depends: none
  - Notes: Add `better-auth` to dependencies. Add `@playwright/test` to devDependencies. Add scripts: `"migrate": "bunx @better-auth/cli migrate"`, `"test:e2e": "playwright test"`. Run `bun install`. Then run `MC_DB_PATH=./mc.db bunx @better-auth/cli migrate` to create auth tables in existing DB. Verify tables exist: `user`, `session`, `account`, `verification`.

- [x] `T2` — better-auth server config + admin seed
  - Files: `apps/mission-control/src/auth.ts` (REWRITE), `apps/mission-control/src/auth-client.ts` (CREATE), `apps/mission-control/src/seed-admin.ts` (CREATE), `apps/mission-control/next.config.ts` (MODIFY)
  - Estimate: small
  - Depends: T1
  - Notes:
    - `src/auth.ts`: `betterAuth({ database: new Database(process.env.MC_DB_PATH ?? 'mc.db'), secret: process.env.BETTER_AUTH_SECRET, baseURL: process.env.BETTER_AUTH_URL, emailAndPassword: { enabled: true } })`. Export `auth`.
    - `src/auth-client.ts`: `createAuthClient({ baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? '' })`. Export `authClient`.
    - `src/seed-admin.ts`: reads `MC_ADMIN_EMAIL` + `MC_ADMIN_PASSWORD`. If both set and `user` table empty, calls `auth.api.createUser({ body: { name: 'Admin', email, password, role: 'admin' } })`. Guards with try/catch (migration may not have run yet).
    - `next.config.ts`: import `seed-admin.ts` at top level (server-only, runs once on startup). Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` to env docs.

### Wave 2 — Auth Routes & Pages

- [x] `T3` — better-auth catch-all route handler
  - Files: `apps/mission-control/app/api/auth/[...all]/route.ts` (CREATE)
  - Estimate: small
  - Depends: T2
  - Notes: `import { auth } from '@/src/auth'; import { toNextJsHandler } from 'better-auth/next-js'; export const { GET, POST } = toNextJsHandler(auth);`

- [x] `T4` — Middleware (cookie-presence check)
  - Files: `apps/mission-control/middleware.ts` (CREATE)
  - Estimate: small
  - Depends: T3
  - Notes: Edge runtime. Check for `better-auth.session_token` cookie. Exclude `/login`, `/api/auth/*` from check. Unauthed browser requests → redirect `/login`. Unauthed API requests (`/api/*` not under `/api/auth`) → return 401 JSON `{"error":"Unauthorized"}`. Match pattern: `/((?!login|api/auth).*)`.

- [x] `T5` — Login page
  - Files: `apps/mission-control/app/login/page.tsx` (CREATE)
  - Estimate: small
  - Depends: T3
  - Notes: `'use client'`. Use `authClient.signIn.email({ email, password })`. On success: `router.push('/')`. On error: show inline error. Style with cyber theme (match existing palette — dark bg, cyan accent, GlassCard). No external UI library.

- [x] `T6` — Admin users page
  - Files: `apps/mission-control/app/admin/users/page.tsx` (CREATE)
  - Estimate: small
  - Depends: T4, T5
  - Notes: Server component validates session via `auth.api.getSession({ headers: headers() })` → redirect to `/login` if null. Lists users from DB. Client form to add user (calls `authClient.admin.createUser()` or POST to a simple server action). Keep simple — no pagination needed for an operator tool.

### Wave 3 — Data & SSE Fix

- [x] `T7` — GET /api/events limit param + EventFeed historical fetch
  - Files: `apps/mission-control/app/api/events/route.ts` (MODIFY), `apps/mission-control/components/EventFeed.tsx` (MODIFY), `apps/mission-control/app/page.tsx` (MODIFY), `apps/mission-control/app/layout.tsx` (MODIFY)
  - Estimate: small
  - Depends: T4
  - Notes:
    - `events/route.ts` GET: parse `limit` (default 200, max 500, clamp). Add `ORDER BY created_at DESC LIMIT ?`.
    - `EventFeed.tsx`: on mount fetch `GET /api/events?limit=200`, merge into state. Dedup by row `id`. Add optional `onEvent?: (e: EventEntry) => void` prop, call after each SSE event. Auth header not needed (cookie handled by middleware).
    - `page.tsx`: remove `useEffect` SSE block. Keep instance polling. Pass `onEvent` to EventFeed to update `eventsPerMin`. Keep HUD stats.
    - `layout.tsx`: add `bg-cyber-bg` className to `<body>`.

### Wave 4 — E2E Tests

- [x] `T8` — Playwright config + DB setup
  - Files: `apps/mission-control/playwright.config.ts` (CREATE), `apps/mission-control/e2e/global-setup.ts` (CREATE), `apps/mission-control/e2e/global-teardown.ts` (CREATE)
  - Estimate: small
  - Depends: T1
  - Notes: Config: baseURL `http://localhost:3002`, webServer `{ command: 'MC_DB_PATH=./e2e-test.db MC_ADMIN_EMAIL=admin@test.com MC_ADMIN_PASSWORD=testpass123 BETTER_AUTH_SECRET=test-secret BETTER_AUTH_URL=http://localhost:3002 next start -p 3002', port: 3002, reuseExistingServer: false }`. Global setup: create `e2e-test.db`, run better-auth migration programmatically (exec `bunx @better-auth/cli migrate` with `MC_DB_PATH=./e2e-test.db`), insert 1 instance row + 2 event rows via better-sqlite3 directly. Global teardown: `fs.unlinkSync('e2e-test.db')` + WAL files.

- [x] `T9` — E2E test suite
  - Files: `apps/mission-control/e2e/dashboard.spec.ts` (CREATE)
  - Estimate: medium
  - Depends: T8, T5, T7
  - Notes: 6 tests:
    1. Unauthed GET `/` → URL contains `/login`
    2. Unauthed `request.get('/api/instances')` → status 401
    3. Login with wrong password → stays `/login`, error visible
    4. Login with `admin@test.com` / `testpass123` → redirected to `/`, heading "MISSION CONTROL" visible
    5. After login, event feed contains ≥1 row (seeded historical data loaded)
    6. After login, intercept network; count requests to `/api/events/stream` = 1

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
