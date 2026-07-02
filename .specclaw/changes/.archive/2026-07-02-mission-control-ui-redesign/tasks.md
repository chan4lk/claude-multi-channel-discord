# Tasks: Mission Control Overhaul — Hub Consolidation + Futuristic UI/UX

**Change:** mission-control-ui-redesign
**Created:** 2026-05-24
**Total Tasks:** 14

## Summary

14 tasks in 3 waves. Wave 1 consolidates the hub into Next.js (backend). Wave 2 installs deps and creates UI primitives + Tailwind theme. Wave 3 redesigns the four dashboard panels and page layout. Wave 1 must complete before Wave 3 (EventSource URL fix). Wave 2 is independent and can start in parallel with Wave 1.

## Tasks

### Wave 1 — Hub consolidation (backend)

- [x] `T1` — Create `src/db.ts`, `src/auth.ts`, `src/sse.ts` in mission-control
  - Files: `apps/mission-control/src/db.ts`, `apps/mission-control/src/auth.ts`, `apps/mission-control/src/sse.ts`
  - Estimate: small
  - Depends: —
  - Notes: Lift hub source verbatim. In `db.ts` add `export const dynamic = 'force-dynamic'` is not needed here (it's a module, not a route). In `sse.ts` wrap the Set in `global` to survive Next.js HMR: `const g = globalThis as { __mcdClients?: Set<ReadableStreamDefaultController> }; export const clients = (g.__mcdClients ??= new Set())`. DB path default: `./mc.db`.

- [x] `T2` — Rewrite `app/api/events/route.ts` (GET history + POST ingest)
  - Files: `apps/mission-control/app/api/events/route.ts`
  - Estimate: small
  - Depends: T1
  - Notes: `export const dynamic = 'force-dynamic'`. GET: call `getEvents()` with query params, return `Response.json()`. POST: validate Bearer via `validateApiKey()`, parse body, call `insertEvent()` + `updateLastSeen()` + `broadcast()`. Test assumption: `bun:sqlite` available — if import fails, note it as blocker.

- [x] `T3` — Create `app/api/events/stream/route.ts` (SSE fan-out)
  - Files: `apps/mission-control/app/api/events/stream/route.ts`
  - Estimate: small
  - Depends: T1
  - Notes: `export const dynamic = 'force-dynamic'`. Return `ReadableStream` with `addClient(controller)` on start, `removeClient(controller)` on cancel. Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, `Connection: keep-alive`.

- [x] `T4` — Rewrite `app/api/instances/route.ts` (direct SQLite)
  - Files: `apps/mission-control/app/api/instances/route.ts`
  - Estimate: small
  - Depends: T1
  - Notes: `export const dynamic = 'force-dynamic'`. GET: call `getInstances()`, return `Response.json()`. Remove `HUB_URL` reference.

- [x] `T5` — Delete `apps/mission-control-hub/` and update README
  - Files: `apps/mission-control-hub/` (delete), `README.md`
  - Estimate: small
  - Depends: T2, T3, T4
  - Notes: `git rm -r apps/mission-control-hub/`. In README: remove HUB_URL, document MC_DB_PATH (default `./mc.db`), update start instructions to single `bun next dev`.

### Wave 2 — Deps + Tailwind theme + UI primitives

- [x] `T6` — Install deps and extend Tailwind config
  - Files: `apps/mission-control/package.json`, `apps/mission-control/tailwind.config.ts`
  - Estimate: small
  - Depends: —
  - Notes: Install `framer-motion`, `@fontsource/jetbrains-mono`, `@fontsource/inter`. Extend tailwind theme with cyber palette (bg `#080C14`, surface `#0D1421`, panel `#111827`, cyan `#00F5FF`, amber `#F59E0B`, crimson `#EF4444`), glow box-shadows, and keyframes/animations for `pulse-ring`, `strobe`, `glow-sweep`. Set `darkMode: 'class'`.

- [x] `T7` — Update `globals.css` and `layout.tsx`
  - Files: `apps/mission-control/app/globals.css`, `apps/mission-control/app/layout.tsx`
  - Estimate: small
  - Depends: T6
  - Notes: `globals.css`: set `body { background: #080C14; color: #E2E8F0; }` as base layer. Custom scrollbar: `scrollbar-width: thin; scrollbar-color: #00F5FF22 transparent`. Import `@fontsource/jetbrains-mono/400.css` and `@fontsource/inter/400.css` in layout.tsx. Add `class="dark"` to `<html>`. Apply font CSS vars.

- [x] `T8` — Create UI primitives (GlassCard, StatusDot, PulseRing, Sparkline, CountBadge)
  - Files: `apps/mission-control/components/ui/GlassCard.tsx`, `apps/mission-control/components/ui/StatusDot.tsx`, `apps/mission-control/components/ui/PulseRing.tsx`, `apps/mission-control/components/ui/Sparkline.tsx`, `apps/mission-control/components/ui/CountBadge.tsx`
  - Estimate: medium
  - Depends: T6
  - Notes:
    - `GlassCard`: `div` with `backdrop-blur-sm bg-cyber-surface/80 border border-cyber-cyan/10 rounded-xl shadow-inner`. Accepts `className` override.
    - `StatusDot`: colored `span` circle. Props: `status: 'active' | 'stale' | 'stuck'`. Colors: active=cyan, stale=slate, stuck=crimson.
    - `PulseRing`: wraps children in a ring `div`. Props: `status`. Active → `animate-pulse-ring border-cyber-cyan shadow-glow-cyan`. Stale → `border-slate-600 opacity-40`. Stuck → `animate-strobe border-cyber-crimson shadow-glow-red`.
    - `Sparkline`: SVG. Props: `data: number[]`, `width?: number`, `height?: number`. Normalize data to [0,height]. Draw `<polyline>` with cyan stroke. Handle < 2 points (render flat line).
    - `CountBadge`: `motion.span` with Framer Motion spring on number change. Props: `value: number`, `label: string`, `color?: string`.

### Wave 3 — Panel redesigns + page layout

- [x] `T9` — Update `page.tsx` (HUD header + CSS Grid layout + EventSource fix)
  - Files: `apps/mission-control/app/page.tsx`
  - Estimate: medium
  - Depends: T2, T3, T5, T8
  - Notes: HUD header: shows total instances (from `/api/instances` fetch), events/min (computed from SSE buffer), healthy count (last_seen < 5m), degraded count, uptime (`Date.now() - mountTime`). CSS Grid: `grid-template-areas: "header header" "instances feed" "pipeline feed" "scheduler scheduler"` at `lg`. Update `EventSource` URL from `/api/events` to `/api/events/stream`. Wrap `<main>` in `motion.main` with `initial={{ opacity: 0 }} animate={{ opacity: 1 }}`.

- [x] `T10` — Redesign InstanceGrid
  - Files: `apps/mission-control/components/InstanceGrid.tsx`
  - Estimate: medium
  - Depends: T8
  - Notes: Use `GlassCard` for each instance card. Wrap card in `PulseRing` with status derived from `last_seen`. Add `Sparkline` per card showing event count per 10s bucket from last 60s (prop: `events: EventEntry[]` passed from page). Show host in `font-jetbrains-mono text-cyber-cyan`. Show user, instance_id prefix, last_seen relative. `AnimatePresence` + `motion.div` for card enter (fade+scale).

- [x] `T11` — Redesign EventFeed
  - Files: `apps/mission-control/components/EventFeed.tsx`
  - Estimate: medium
  - Depends: T3, T8
  - Notes: Fix EventSource URL to `/api/events/stream`. Type color map → cyber palette (spawn=cyan, reply=green-400, error/watchdog=crimson, progress=amber, stop=orange-400). `AnimatePresence` + `motion.div` on each event row: `initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}`. Watchdog/error events sort-pinned to top. Compact mode toggle (button) shows only type+time, hides payload summary. Use `GlassCard` as container. Cap at 200 events (was 100).

- [x] `T12` — Redesign SpecclawPipeline
  - Files: `apps/mission-control/components/SpecclawPipeline.tsx`
  - Estimate: small
  - Depends: T8
  - Notes: Replace vertical list with horizontal progress track per pipeline row. Track: `flex` bar divided into phase segments (propose → plan → build → verify → pr). Active phase gets `animate-glow-sweep bg-gradient-to-r from-cyber-cyan/20 via-cyber-cyan/60 to-cyber-cyan/20`. Completed phase gets checkmark icon + solid cyan fill. Parse `statusMd` to infer current phase (look for keywords: `build`, `verify`, `pr`, `plan`, `propose`). Use `GlassCard` container.

- [x] `T13` — Redesign SchedulerTable
  - Files: `apps/mission-control/components/SchedulerTable.tsx`
  - Estimate: small
  - Depends: T8
  - Notes: Add countdown timer per row. Parse `jobId` for `HH:MM` time pattern. Compute next-fire = next wall-clock occurrence. `useEffect` with `setInterval(1000)` to update countdown. Render as `MM:SS` in `CountBadge`. State badge: if `paused` in payload → amber "paused" pill, else cyan "active" pill. Use `GlassCard` as table container. Apply cyber row styles.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
