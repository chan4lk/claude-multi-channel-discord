# Tasks: SpecClaw Status Visibility in Show + Heartbeat

**Change:** specclaw-status-visibility
**Created:** 2026-07-12
**Total Tasks:** 4

## Summary

Parser module first (with its own tests), then the two render hooks, then integration assertions + full gate.

## Tasks

### Wave 1 — Parser

- [x] `T1` — Create `src/specclaw-status.ts`: `SpecclawStatus` interface + `readSpecclawStatus()` (dashboard parse, phase resolution, all-IO-guarded)
  - Files: src/specclaw-status.ts
  - Estimate: medium
- [x] `T2` — Create `src/specclaw-status.test.ts`: tmpdir fixtures for AC1–AC4 + edge cases (missing change status.md, ✅-only dashboard, no task counts)
  - Files: src/specclaw-status.test.ts
  - Estimate: medium
  - Depends: T1

### Wave 2 — Render hooks

- [x] `T3` — Wire into `handleShow` (specclaw: line per FR4) and `handleHeartbeat` (🦞 block per FR5, both full-scan and --channel modes)
  - Files: src/master-commands.ts
  - Estimate: small
  - Depends: T1
- [x] `T4` — Render tests in `src/master-commands.test.ts` (AC5, AC6) + run full gate: all suites + `bun tsc --noEmit`
  - Files: src/master-commands.test.ts
  - Estimate: small
  - Depends: T3

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
