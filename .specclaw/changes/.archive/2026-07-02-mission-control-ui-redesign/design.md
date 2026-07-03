# Design: Mission Control Overhaul — Hub Consolidation + Futuristic UI/UX

**Change:** mission-control-ui-redesign
**Created:** 2026-05-24

## Technical Approach

**Part 1 — Hub Consolidation:** Lift the four handler functions from `apps/mission-control-hub/src/` verbatim into `apps/mission-control/src/` as shared modules (`db.ts`, `auth.ts`, `sse.ts`). Replace the two proxy Route Handlers with direct implementations. Split events route into two files: `app/api/events/route.ts` (GET history + POST ingest) and `app/api/events/stream/route.ts` (SSE). Delete hub directory.

**Part 2 — UI Redesign:** Extend Tailwind config with cyber palette tokens. New primitive components (`GlassCard`, `StatusDot`, `PulseRing`, `Sparkline`, `CountBadge`) in `components/ui/`. Redesign four panels in place — same data contracts, same API endpoints (except EventSource URL change). Add HUD header to page.tsx. Use Framer Motion for enter animations and list transitions.

## Architecture

```
apps/mission-control/
├── src/
│   ├── db.ts          ← bun:sqlite singleton + CRUD (lifted from hub)
│   ├── auth.ts        ← validateApiKey() (lifted from hub)
│   └── sse.ts         ← Set<Controller> singleton + broadcast (lifted from hub)
├── app/
│   ├── api/
│   │   ├── events/
│   │   │   ├── route.ts        ← GET (history) + POST (ingest)
│   │   │   └── stream/
│   │   │       └── route.ts    ← GET SSE fan-out
│   │   └── instances/
│   │       └── route.ts        ← GET instances list
│   ├── layout.tsx               ← font imports added
│   ├── page.tsx                 ← HUD header + CSS Grid layout
│   └── globals.css              ← dark base + scrollbar + keyframes
└── components/
    ├── ui/
    │   ├── GlassCard.tsx
    │   ├── StatusDot.tsx
    │   ├── PulseRing.tsx
    │   ├── Sparkline.tsx
    │   └── CountBadge.tsx
    ├── EventFeed.tsx            ← redesigned in-place
    ├── InstanceGrid.tsx         ← redesigned in-place
    ├── SchedulerTable.tsx       ← redesigned in-place
    └── SpecclawPipeline.tsx     ← redesigned in-place
```

**SSE singleton pattern (same as hub):**
```ts
// src/sse.ts — module-level singleton, lives for process lifetime
const clients = new Set<ReadableStreamDefaultController>()
```
Next.js route handlers import from `../../src/sse` — same module instance for GET stream and POST ingest because both run in the same Node/Bun process. This is why single-process is required (see NFR2).

**Tailwind cyber palette extension:**
```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      cyber: {
        bg:      '#080C14',
        surface: '#0D1421',
        panel:   '#111827',
        cyan:    '#00F5FF',
        amber:   '#F59E0B',
        crimson: '#EF4444',
        slate:   '#1E293B',
      }
    },
    boxShadow: {
      'glow-cyan':   '0 0 8px 2px rgba(0,245,255,0.35)',
      'glow-amber':  '0 0 8px 2px rgba(245,158,11,0.35)',
      'glow-red':    '0 0 8px 2px rgba(239,68,68,0.35)',
    },
    keyframes: {
      pulse_ring: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
      strobe:     { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      glow_sweep: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
    },
    animation: {
      'pulse-ring': 'pulse_ring 2s ease-in-out infinite',
      'strobe':     'strobe 0.5s step-end infinite',
      'glow-sweep': 'glow_sweep 3s linear infinite',
    }
  }
}
```

**Framer Motion usage:** `AnimatePresence` + `motion.div` for EventFeed list items (slide from left + fade). `motion.span` for CountBadge number rolls (`useSpring`). Page-level `motion.main` with fade-in on mount.

**Sparkline:** SVG-based, ~30 lines. Takes `data: number[]` (event counts per 10s bucket), renders a polyline. No external chart library.

**Countdown timers:** `SchedulerTable` derives next-fire time from `jobId` (format `HH:MM`). `useEffect` with `setInterval(1000)` updates remaining seconds. Renders as `MM:SS` pill.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `apps/mission-control/src/db.ts` | CREATE | bun:sqlite singleton + types + CRUD functions (from hub) |
| `apps/mission-control/src/auth.ts` | CREATE | validateApiKey() (from hub) |
| `apps/mission-control/src/sse.ts` | CREATE | SSE client set + broadcast (from hub) |
| `apps/mission-control/app/api/events/route.ts` | REWRITE | GET filtered history + POST ingest (was GET proxy to stream) |
| `apps/mission-control/app/api/events/stream/route.ts` | CREATE | GET SSE fan-out |
| `apps/mission-control/app/api/instances/route.ts` | REWRITE | GET direct SQLite query (was GET proxy) |
| `apps/mission-control/package.json` | MODIFY | add framer-motion, @fontsource/jetbrains-mono, @fontsource/inter |
| `apps/mission-control/tailwind.config.ts` | MODIFY | add cyber palette + shadows + keyframes/animations |
| `apps/mission-control/app/globals.css` | MODIFY | dark base layer, custom scrollbar, glow keyframe |
| `apps/mission-control/app/layout.tsx` | MODIFY | import @fontsource packages, apply font CSS vars |
| `apps/mission-control/app/page.tsx` | MODIFY | HUD header, CSS Grid layout, EventSource URL → /api/events/stream |
| `apps/mission-control/components/ui/GlassCard.tsx` | CREATE | frosted-glass card primitive |
| `apps/mission-control/components/ui/StatusDot.tsx` | CREATE | colored dot indicator |
| `apps/mission-control/components/ui/PulseRing.tsx` | CREATE | animated ring wrapper |
| `apps/mission-control/components/ui/Sparkline.tsx` | CREATE | SVG sparkline |
| `apps/mission-control/components/ui/CountBadge.tsx` | CREATE | animated number badge |
| `apps/mission-control/components/EventFeed.tsx` | REWRITE | cyber style + Framer Motion + EventSource URL fix |
| `apps/mission-control/components/InstanceGrid.tsx` | REWRITE | glass cards + PulseRing + Sparkline |
| `apps/mission-control/components/SchedulerTable.tsx` | REWRITE | countdown timers + pill badges |
| `apps/mission-control/components/SpecclawPipeline.tsx` | REWRITE | horizontal progress track + glow sweep |
| `apps/mission-control-hub/` | DELETE | git rm -r entire directory |
| `README.md` / env docs | MODIFY | remove HUB_URL, document MC_DB_PATH |

## Data Model Changes

None. SQLite schema identical to hub — no migrations needed.

## API Changes

| Before | After | Notes |
|--------|-------|-------|
| `GET /api/events` → proxy to hub `/events/stream` | `GET /api/events` → SQLite filtered history (JSON) | URL reused, semantics changed |
| (none) | `GET /api/events/stream` → SSE fan-out | New path |
| `GET /api/instances` → proxy to hub `/api/instances` | `GET /api/instances` → direct SQLite | Same URL, proxy removed |
| Hub: `POST /events` on port 4001 | `POST /api/events` on port 3001 | Path prefix changed, port unified |

**Client-side EventSource URLs must change:** `new EventSource('/api/events')` → `new EventSource('/api/events/stream')` in `EventFeed.tsx` and `page.tsx`.

## Key Decisions

**D1 — bun:sqlite in Next.js:** Hub already uses `bun:sqlite`. Assumption: Next.js run under Bun exposes Bun built-ins in route handlers. If this fails at build time, switch to `better-sqlite3`. Document assumption in code comment.

**D2 — `export const dynamic = 'force-dynamic'`:** Required on SSE route and any route reading `MC_DB_PATH` env var to prevent Next.js from statically optimizing them.

**D3 — Two events routes (not one):** `GET /api/events` for JSON history keeps backward compat with any future tooling. `GET /api/events/stream` for SSE avoids overloading one URL with two response types.

**D4 — No sparkline endpoint:** Sparklines derive from in-memory SSE event buffer on the client. Avoids new API surface and stays within scope.

**D5 — Hard-lock dark mode:** No toggle. `<html>` element gets `class="dark"`. Tailwind config sets `darkMode: 'class'`.

**D6 — Framer Motion scope:** Only enter/exit animations for EventFeed list items and CountBadge. No layout animations on grid (too expensive). CSS keyframes for PulseRing/glow-sweep.

**D7 — Countdown timer strategy:** Parse `HH:MM` from jobId. Compute next-fire as next wall-clock occurrence of that time. `setInterval(1000)` in component, no server involvement.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `bun:sqlite` not available in Next.js route handlers | Medium | Test early (T2). Fallback: `better-sqlite3` |
| SSE module singleton not shared across route handlers in dev mode (Next.js hot reload) | Low | Wrap in `global` to survive HMR: `global.__mcdClients ??= new Set()` |
| Framer Motion SSR mismatch with `'use client'` components | Low | All panels are already `'use client'`; no SSR hydration issue |
| `git rm -r apps/mission-control-hub/` loses commit history | None | History preserved; `git rm` just stages the deletion |
| Countdown timer drift on tab background throttling | Low | Visual only; acceptable for operator tool |
