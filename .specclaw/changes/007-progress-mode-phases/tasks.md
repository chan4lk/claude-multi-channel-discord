# Tasks: progressMode "phases"

**Change:** progress-mode-phases
**Created:** 2026-07-12
**Total Tasks:** 6

## Tasks

### Wave 1 — Core

- [x] `T1` — channels-config.ts: add 'phases' to ProgressModeSchema
  - Files: src/channels-config.ts
  - Estimate: small
- [x] `T2` — src/specclaw-progress.ts: SpecclawProgressSnapshot, takeSpecclawProgressSnapshot (verify-row parse), classifySpecclawTransitions
  - Files: src/specclaw-progress.ts
  - Estimate: medium

### Wave 2 — Wiring

- [x] `T3` — Event plumbing: SpecclawProgressEvent + onSpecclawProgress (project-process.ts), pollSpecclawProgress in claude-process.ts poll cycle, pool forwarding (project-pool.ts)
  - Files: src/project-process.ts, src/claude-process.ts, src/project-pool.ts
  - Estimate: medium
  - Depends: T1, T2
- [x] `T4` — server.ts: progressMode into factory opts; phases early-return in handleToolProgressEvent; handleSpecclawProgressEvent (per-change edit-in-place timeline)
  - Files: server.ts
  - Estimate: medium
  - Depends: T3

### Wave 3 — Tests + gate

- [x] `T5` — src/specclaw-progress.test.ts: fixture snapshots + classifier sequences (AC2), schema acceptance (AC1)
  - Files: src/specclaw-progress.test.ts
  - Estimate: medium
  - Depends: T2
- [x] `T6` — Full gate: all test suites + `bun tsc --noEmit`
  - Estimate: small
  - Depends: T4, T5
