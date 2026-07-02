# Proposal: Mission Control Overhaul — Hub Consolidation + Futuristic UI/UX

**Created:** 2026-05-24
**Status:** 🟡 Draft

## Problem

Mission Control has two compounding issues:

**Architecture:** Runs as two separate processes:
- **Next.js** (port 3001) — UI + transparent proxy
- **mission-control-hub** (port 4001) — SQLite, auth, SSE, HTTP API

Two services to start, two ports to expose, `HUB_URL` env var to wire, proxy indirection on every request. Hub has no logic requiring isolation from Next.js.

**UI:** Functional but visually bare — default Tailwind, no dark mode, no animations, no visual hierarchy. Operator monitoring multiple live Claude sessions needs a UI that communicates urgency, health, and activity at a glance. Current UI fails that bar:
- No dark mode (eye strain during 24/7 ops)
- InstanceGrid, EventFeed, SchedulerTable, SpecclawPipeline have no visual priority — everything looks equally important
- No status-at-a-glance — healthy vs stuck vs killed requires reading text
- EventFeed is a plain list — no density control, no urgency differentiation, no live pulse
- No responsive layout — panels fight for space on a wide monitor
- No micro-feedback (transitions, hover states, loading states)

## Proposed Solution

### Part 1 — Hub Consolidation

Move all Hub logic into Next.js Route Handlers. Delete `apps/mission-control-hub/`. Single deployable unit on a single port.

- **POST /api/events** — Route Handler: Bearer auth + SQLite insert + SSE broadcast
- **GET /api/events/stream** — Route Handler: `ReadableStream` SSE, in-process fan-out
- **GET /api/instances** — Route Handler: SQLite query
- **GET /api/events** — Route Handler: SQLite query with filters
- **SQLite** — `bun:sqlite` module-level singleton
- **SSE fan-out** — global `Set<ReadableStreamController>` singleton in shared module
- **Auth** — `validateApiKey()` inline, same logic, same SQLite instances table
- **Remove** `HUB_URL` env var, proxy files `app/api/events/route.ts` + `app/api/instances/route.ts`

### Part 2 — Futuristic UI/UX Redesign

Full visual redesign of `apps/mission-control/` using a **cyber-ops / mission-control aesthetic**:

- **Dark-first palette**: near-black background (`#080C14`), electric cyan (`#00F5FF`) primary chrome, amber (`#F59E0B`) warnings, crimson errors, slate glass panels
- **Glass morphism panels**: frosted-glass card surfaces with subtle inner glow borders
- **Animated status indicators**: pulsing rings for active instances, flat for idle, red strobe for stuck/killed
- **Live activity sparks**: mini sparkline charts in InstanceGrid cards showing event frequency
- **EventFeed redesign**: color-coded by event type, animated entry (slide + fade), priority-pinned watchdog/error events at top, compact mode toggle
- **SpecclawPipeline**: horizontal progress track with glow sweep animation on active tasks, checkmark pop on complete
- **SchedulerTable**: countdown timers for next-fire times, pill badges for enabled/paused state
- **HUD header**: global instance count, total events/min rate, healthy vs degraded counts, elapsed uptime
- **Typography**: `JetBrains Mono` for technical values (ids, timestamps, counts), `Inter` for prose
- **Responsive grid**: CSS Grid with named areas, collapses to single-column on narrow screens
- **Framer Motion** for enter/exit animations, layout transitions, counter number rolls

### Tech additions
- `framer-motion` for animation
- `@fontsource/jetbrains-mono` + `@fontsource/inter`
- Custom Tailwind theme extension (palette, shadow glows, animation keyframes)

## Scope

### In Scope
- Port all 4 Hub endpoints to `apps/mission-control/app/api/` Route Handlers
- Move `db.ts`, `auth.ts`, `sse.ts` logic into `apps/mission-control/src/`
- Replace proxy routes with direct implementations
- Delete `apps/mission-control-hub/` entirely
- All files under `apps/mission-control/` (components, app, CSS, Tailwind config)
- New reusable UI primitives: `GlassCard`, `StatusDot`, `PulseRing`, `Sparkline`, `CountBadge`
- Tailwind theme extension for cyber palette + glow shadows
- `globals.css` dark-mode base + custom scrollbar styling
- Responsive layout via CSS Grid named areas
- Framer Motion page-entry and list-item animations
- Update README / env var docs

### Out of Scope
- Schema changes to SQLite tables
- New API endpoints or event types
- Auth / multi-user dashboard
- Multi-process / multi-replica SSE fan-out (Redis pub/sub etc.)
- Mobile app
- `server.ts` or any bot-side changes

## Impact

- **Files affected:** ~18–22 (4 new route handlers, 3 new lib files, 2 deleted proxy routes, hub directory deleted, ~4 new primitive components, components × 4, app/page.tsx, layout.tsx, globals.css, tailwind.config.ts, package.json/README)
- **Complexity:** medium-high
- **Risk:** low — hub is pure relocation of logic (no behavioral changes); UI is purely presentational

## Open Questions

1. **Multi-process SSE:** In-process fan-out breaks if Next.js runs in cluster mode. Acceptable for now?
2. **Runtime:** Confirm Next.js runs on Bun so `bun:sqlite` is available, or add `better-sqlite3` for Node compatibility?
3. **DB path:** `mc.db` currently defaults relative to Hub cwd. New default relative to `apps/mission-control/`?
4. **InstanceGrid cards:** Expandable to show last N events inline, or keep drill-down in EventFeed?
5. **Sparklines:** Client-side from buffered events, or add `/api/sparkline?instance_id=X` endpoint?
6. **Framer Motion:** ~45kB gzip — acceptable, or prefer CSS-only animations?
7. **Light mode:** Toggle or hard-lock dark?

---

**To proceed:** Review this proposal and approve to begin planning.
