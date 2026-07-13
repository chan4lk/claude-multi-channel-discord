# Tasks: Rotation-Aware SpecClaw Resume Prompt

**Change:** rotation-specclaw-resume
**Created:** 2026-07-12
**Total Tasks:** 4

## Tasks

### Wave 1 — Core

- [x] `T1` — `buildSpecclawResumeBlock()` in src/specclaw-status.ts (active-change block / no-active one-liner / absent → '')
  - Files: src/specclaw-status.ts
  - Estimate: small

### Wave 2 — Wiring

- [x] `T2` — extractContextSnapshot(): compute block, append after truncation, block-only brief when prose empty
  - Files: src/claude-process.ts
  - Estimate: small
  - Depends: T1

### Wave 3 — Tests + gate

- [x] `T3` — Fixtures in src/specclaw-status.test.ts: AC1 block content, AC2 one-liner, AC3 empty string
  - Files: src/specclaw-status.test.ts
  - Estimate: small
  - Depends: T1
- [x] `T4` — Full gate: all test suites + `bun tsc --noEmit`
  - Estimate: small
  - Depends: T2, T3
