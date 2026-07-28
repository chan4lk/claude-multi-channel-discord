# Tasks: Org-graph view (`!project graph`)

**Change:** org-graph-view
**Created:** 2026-07-28
**Total Tasks:** 5

## Summary

Build the pure graph module first (model + both renderers + tests), then wire the verb into the parser, then docs. Waves ordered by dependency; wave 2 tasks can run in parallel after wave 1.

## Tasks

### Wave 1 — Pure graph module

- [x] `T1` — `src/org-graph.ts`: model builder + renderers
  - Files: `src/org-graph.ts`
  - Estimate: medium
  - Kind: impl
  - Notes: `GraphInputs` (schedules, handoffs, activity map, pool map), `buildOrgGraph(config, inputs)` deriving mutuality/staleness/dead edges/warnings per design model shape; `renderGraphText(graph, {stats})`; `renderGraphMermaid(graph, {stats})` with id sanitization + collision suffixing. Reuse `resolveCollabTarget` for role resolution; effective handoff flag = `project.handoff ?? defaults.handoff`. No IO in this file.

- [x] `T2` — `src/org-graph.test.ts`: unit tests
  - Files: `src/org-graph.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T1
  - Notes: bun PASS/FAIL script covering AC1–AC8 fixtures: mutual vs one-way peers, stale role, dead role (handoff off), missing peer slug, bot node dedup across two projects, disabled/autopilot/hermes decorations, schedule self-loops (enabled only), stats overlay (open handoff counts, idle never, warm/cold null-degradation), mermaid fence + `graph LR` + hostile slugs (`a-b.c`, emoji), empty registry.

### Wave 2 — Verb wiring + docs

- [ ] `T3` — `graph` verb in master-commands
  - Files: `src/master-commands.ts`
  - Estimate: small
  - Kind: impl
  - Depends: T1
  - Notes: dispatch case, async `handleGraph(rest, ctx)` (flags `--stats`, `--mermaid`), help line. Add optional `MasterContext.loadSchedulesFn` + `transcriptMtimeFn`; defaults fall back to real `loadSchedules` / `newestTranscriptMtimeMs`; handoffs via existing `ctx.loadHandoffRegistry ?? loadRegistry`; pool via `ctx.mutator?.poolStats` only when `--stats`. Every stats input try/catch-wrapped → null (NFR3). Zero writes.

- [ ] `T4` — parser tests
  - Files: `src/master-commands.test.ts`
  - Estimate: small
  - Kind: test
  - Depends: T3
  - Notes: verb reachable, injected deps only (no filesystem), `--stats` without mutator degrades not throws, help text contains `graph`, no mutator write methods invoked.

- [ ] `T5` — docs
  - Files: `README.md`, `docs/commands.md`, `CLAUDE.md`
  - Estimate: small
  - Kind: docs
  - Depends: T3
  - Notes: verb + flags in commands doc and README status/verb tables; CLAUDE.md verb list line.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
