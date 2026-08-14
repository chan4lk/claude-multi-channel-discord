# Tasks: Loop Guardrail-Halt Escalation to Master

**Change:** loop-halt-escalation
**Created:** 2026-07-12
**Total Tasks:** 4

## Tasks

### Wave 1 — Core

- [x] `T1` — `detectSpecclawHalt()` in src/specclaw-status.ts (S1 failed-count, S2 🔴/❌ phase row, S3 non-empty Issues; fail-open) + `escalatedAt` schema field
  - Files: src/specclaw-status.ts, src/schedules-config.ts
  - Estimate: medium

### Wave 2 — Wiring

- [x] `T2` — Scheduler `checkHalt`/`onEscalate` deps + tick gate; `scheduleSetEnabled` clears `escalatedAt` on resume; `scheduleList` 🛑 tag; server.ts wiring (checkHalt resolver + master notice)
  - Files: src/scheduler.ts, src/master-commands.ts, server.ts
  - Estimate: medium
  - Depends: T1

### Wave 3 — Tests + gate

- [x] `T3` — Detection fixtures in src/specclaw-status.test.ts (S1/S2/S3, healthy, missing files, placeholder Issues); escalation matrix in src/scheduler.test.ts (AC1 blocked/healthy, AC2 never-twice, schema round-trip); resume-clears test in src/master-commands.test.ts (AC3)
  - Files: src/specclaw-status.test.ts, src/scheduler.test.ts, src/master-commands.test.ts
  - Estimate: medium
  - Depends: T2
- [x] `T4` — Full gate: all test suites + `bun tsc --noEmit`
  - Estimate: small
  - Depends: T3
