# Tasks: Actionable Heartbeat — Attention Report Instead of Idle Spam

**Change:** heartbeat-attention-report
**Created:** 2026-07-12
**Total Tasks:** 4

## Summary

Detector core first (with its own test file, since fixtures are the bulk of the work), then rendering + plumbing in parallel off it, then docs + full gate.

## Tasks

### Wave 1 — Detector core

- [x] `T1` — `src/heartbeat.ts`: add `detail` to `ChannelState` (full question ≤ 300 chars, newlines collapsed); expose trailing-scheduler-message count from the existing 200-line parse; add `AttentionItem` type + `buildAttentionReport(config, deps)` with detectors question-unanswered (🔴), tool-incomplete (🟡), schedule-wakeup-loop (🟡), circuit-open (🔴, from `deps.getCircuitStates`), schedule-noop-loop (🟡, enabled schedules + trailing ≥ 5), specclaw-idle (🔵, active change + transcript age ≥ staleAfterMinutes); severity sort; per-channel try/catch (NFR3); all deps optional (FR9 degrade)
  - Files: src/heartbeat.ts
  - Estimate: large

- [x] `T2` — `src/heartbeat.test.ts` (new): fixture transcripts under a temp dir; matrix covering AC1 (full >80-char question in detail), AC2 (5 vs 4 trailing scheduler entries, disabled schedule, operator-message reset), AC3 (circuit-open + absent-dep no-throw), AC4 (specclaw-idle stale vs fresh), sort order + multi-item channel (edge: circuit-open + question both emitted)
  - Files: src/heartbeat.test.ts
  - Estimate: large
  - Depends: T1

### Wave 2 — Surface + wiring

- [x] `T3` — `src/master-commands.ts`: `getCircuitStates?` on `MasterContext`; rewrite `handleHeartbeat` — `--quiet` (exact `HEARTBEAT_OK` sentinel, FR7/AC5), `--channel` filter (FR8), render per FR6/AC6 (header, sev emoji + `<#chatId>` + slug + summary, `↳ action`, quoted detail, 15-item cap `(+N more)`, `✅ all quiet — N channels scanned`); help text; `server.ts` wires `getCircuitStates` at both ctx sites; AC5/AC6 tests in `src/master-commands.test.ts`
  - Files: src/master-commands.ts, server.ts, src/master-commands.test.ts
  - Estimate: medium
  - Depends: T1

### Wave 3 — Docs + gate

- [x] `T4` — `templates/master.CLAUDE.md` heartbeat section (call with `--quiet`; "if output is exactly HEARTBEAT_OK, do not post"); README heartbeat verb docs; run full gate (`bun src/heartbeat.test.ts`, `bun src/master-commands.test.ts`, `bun src/project-pool.test.ts`, `bun src/master-mcp-server.test.ts`, `bun tsc --noEmit`) (AC7)
  - Files: templates/master.CLAUDE.md, README.md
  - Estimate: small
  - Depends: T2, T3

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
