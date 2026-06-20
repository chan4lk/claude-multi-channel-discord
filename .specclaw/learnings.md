# Learnings: mission-control-ui-redesign

Build learnings, spec gaps, and patterns discovered.

**Categories:** spec_gap | design_gap | pattern | best_practice | agent_issue

---

## [L1] pattern — bun:sqlite works in Next.js 15 route handlers when starte...

**When:** 2026-05-24 14:47 UTC
**Category:** pattern
**Priority:** high
**Status:** pending

### Detail
bun:sqlite works in Next.js 15 route handlers when started with bun next dev — no better-sqlite3 needed

### Action
Use bun:sqlite directly in Next.js route handlers for Bun-first apps; no fallback needed when bun is the runtime

---

## [L2] pattern — Next.js HMR breaks module-level Set singletons — wrap in ...

**When:** 2026-05-24 14:47 UTC
**Category:** pattern
**Priority:** medium
**Status:** pending

### Detail
Next.js HMR breaks module-level Set singletons — wrap in globalThis to survive hot reload

### Action
Use globalThis.__mcdClients ??= new Set() pattern for any process-lifetime singleton in Next.js route handlers

---

## [L3] pattern — Wave tasks with intra-wave dependencies should be split a...

**When:** 2026-05-24 14:47 UTC
**Category:** pattern
**Priority:** medium
**Status:** pending

### Detail
Wave tasks with intra-wave dependencies should be split across waves or sequenced manually — parallel_tasks=2 cannot express T1→T2 ordering within same wave

### Action
When tasks in same wave have dependency chains, either split to separate waves or note that build executor must serialize them

---
