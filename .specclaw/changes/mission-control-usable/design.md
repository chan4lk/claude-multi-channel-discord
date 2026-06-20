# Design: Mission Control Dashboard — Usable + E2E Tests

**Change:** mission-control-usable
**Created:** 2026-05-25 (revised: better-auth)

## Technical Approach

### Auth — better-auth v1.6.x
- `src/auth.ts`: server-side auth instance, SQLite adapter pointing at `mc.db`, `emailAndPassword` plugin enabled.
- `src/auth-client.ts`: browser client (`createAuthClient`), used in login page + admin page.
- `app/api/auth/[...all]/route.ts`: catch-all route handler via `toNextJsHandler(auth)`.
- **Middleware constraint**: better-sqlite3 is a native Node module — cannot import in Next.js edge middleware. Solution: middleware only checks for `better-auth.session_token` cookie presence (fast, edge-safe). Full session validation happens in server components via `auth.api.getSession({ headers: headers() })`.
- `src/seed-admin.ts`: called from a startup script or `next.config.ts` `onDemandEntries` equivalent. Reads `MC_ADMIN_EMAIL` + `MC_ADMIN_PASSWORD` env vars, calls `auth.api.createUser()` if no users exist yet.
- Admin page `/admin/users`: server component, calls `auth.api.listUsers()`, client form calls `auth.api.createUser()`.

### Auth migration
better-auth does NOT auto-create tables. Run once: `bunx @better-auth/cli migrate` (or `npx`). Creates `user`, `session`, `account`, `verification` tables in `mc.db`.

### Historical Events
`EventFeed` fetches `GET /api/events?limit=200` on mount. Results merged into state before SSE events append. Dedup by `id` (integer for DB rows, absent/undefined for SSE-only live events).

### SSE ownership
`EventFeed` owns the single SSE connection. `page.tsx` passes `onEvent` prop; EventFeed calls it for each incoming event. `page.tsx` uses the callback to maintain `eventsPerMin` counter without receiving the full events array.

### E2E
Playwright `webServer` starts `next start -p 3002`. Global setup: create `e2e-test.db`, run better-auth migration against it, seed test user + events. Global teardown: delete `e2e-test.db`. Tests use better-auth's `signIn.email()` via Playwright's `request` fixture for API-level login.

## Architecture

```
middleware.ts (edge — cookie presence check only)
    │
    ├── /login  ← app/login/page.tsx (better-auth client signIn.email())
    ├── /api/auth/[...all]  ← better-auth route handler
    ├── /admin/users  ← server component, auth.api.getSession() gate
    │
    ├── /  ← page.tsx (server validates session, passes onEvent to EventFeed)
    │        EventFeed (SSE + historical fetch, calls onEvent)
    │
    └── /api/events  ← GET adds limit param; POST keeps API key auth
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `apps/mission-control/src/auth.ts` | REWRITE | better-auth config: SQLite adapter, emailAndPassword |
| `apps/mission-control/src/auth-client.ts` | CREATE | Browser auth client |
| `apps/mission-control/src/seed-admin.ts` | CREATE | Seeds first admin from env vars |
| `apps/mission-control/middleware.ts` | CREATE | Cookie-presence check, redirect unauthed |
| `apps/mission-control/app/api/auth/[...all]/route.ts` | CREATE | better-auth catch-all handler |
| `apps/mission-control/app/login/page.tsx` | CREATE | Login form, client component |
| `apps/mission-control/app/admin/users/page.tsx` | CREATE | List + add users (server + client) |
| `apps/mission-control/app/api/events/route.ts` | MODIFY | Add `limit` param to GET |
| `apps/mission-control/components/EventFeed.tsx` | MODIFY | Historical fetch on mount, `onEvent` prop |
| `apps/mission-control/app/page.tsx` | MODIFY | Remove SSE, pass `onEvent` to EventFeed |
| `apps/mission-control/app/layout.tsx` | MODIFY | Add `bg-cyber-bg` to body |
| `apps/mission-control/playwright.config.ts` | CREATE | Playwright config, webServer port 3002 |
| `apps/mission-control/e2e/global-setup.ts` | CREATE | Create + migrate + seed e2e-test.db |
| `apps/mission-control/e2e/global-teardown.ts` | CREATE | Delete e2e-test.db |
| `apps/mission-control/e2e/dashboard.spec.ts` | CREATE | 6 E2E tests |
| `apps/mission-control/package.json` | MODIFY | Add better-auth, @playwright/test |

## Data Model Changes

better-auth migration adds to `mc.db`:
- `user` (id, name, email, emailVerified, image, createdAt, updatedAt)
- `session` (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
- `account` (id, accountId, providerId, userId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
- `verification` (id, identifier, value, expiresAt, createdAt, updatedAt)

Existing `instances` and `events` tables untouched.

## API Changes

**GET /api/events** — add `limit`:
- Default: 200, max: 500
- `ORDER BY created_at DESC LIMIT ?` (newest first for history merge)

**POST /api/auth/sign-in/email** (via better-auth handler) — sets session cookie.
**POST /api/auth/sign-up/email** (via better-auth handler, admin only).
**GET /api/auth/get-session** (via better-auth handler).

Existing `POST /api/events` API-key auth: preserved unchanged.

## Key Decisions

1. **Same `mc.db` for auth tables.** One DB file to back up, one connection pool. better-auth creates its tables on first migrate; no conflict with `instances`/`events`.

2. **Cookie-presence middleware (not full session check).** Edge-safe. False positives (expired/invalid cookie passes middleware) are corrected in server components — auth.api.getSession() returns null and the component redirects. Acceptable for an internal operator tool.

3. **No self-signup.** Registration only via admin page (authenticated) or env var seed. Prevents unauthorized account creation.

4. **Admin seed on startup.** `seed-admin.ts` called in `next.config.ts` via a server-side module import with a guard (`if (process.env.MC_ADMIN_EMAIL && users.count === 0)`). Idempotent.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| better-auth migration must run before server starts | Document in README; add to `package.json` `prestart` script |
| Cookie-presence check allows expired sessions past middleware | Server components call `auth.api.getSession()` and redirect on null |
| E2E migration against temp DB | Global setup runs `@better-auth/cli migrate` programmatically against `MC_DB_PATH=./e2e-test.db` |
| `src/auth.ts` name collision (old file had same name) | Old file is fully replaced — different export shape |
