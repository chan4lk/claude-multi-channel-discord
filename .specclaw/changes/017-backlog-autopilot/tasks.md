# Tasks: Backlog autopilot

**Change:** backlog-autopilot
**Created:** 2026-07-18
**Total Tasks:** 6

## Summary

Six tasks in three waves: schema + pure logic first (independently testable), then sweep + command surface, then server wiring + docs + full gate.

## Tasks

### Wave 1 — Foundations (schema + pure logic, parallel-safe)

- [x] `T1` — Autopilot config schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Depends: —
  - Notes: `AutopilotSchema` on project entry (`enabled`, `file?`, `intervalMinutes?`, `stallThreshold?`, `respectHeartbeatWindow?`, runtime: `state?`, `seededAt?`, `lastFireAt?`, `zeroDeltaCount?`, `lastSnapshot?`) + `defaults.autopilot` limits-only (`intervalMinutes?`, `stallThreshold?`). Follow the `botPeers` / `defaults.botPeers` pattern exactly. Built-in fallbacks: 30 min / 3 / `BACKLOG.md` / true.

- [x] `T2` — `src/backlog.ts` pure module + tests
  - Files: `src/backlog.ts`, `src/backlog.test.ts`
  - Estimate: medium
  - Depends: T1 (types only)
  - Notes: `detectBacklogSource` (specclaw wins), `snapshotBacklog` (file: `- [x]`/`- [ ]` regex count; specclaw: active-change `tasks.md` checkboxes + pending proposals as one open item each), `buildSeedPrompt` (goal verbatim or CLAUDE.md-derived instruction; instructs checkbox format), `buildNudgePrompt` (reply-required footer, same text as scheduler's), `withinWindow` (HH:MM-HH:MM, wrap-around), `nextAutopilotAction(entry, snap, nowIso)` pure transition per design state machine (seed / verify-failed after 2 intervals / nudge / stall at threshold / complete / rearm / none). No timers, no fs in the transition fn (snapshot passed in). Tests: fixture dirs via tmp, transition table, window edge cases (AC5, AC9 groundwork).

### Wave 2 — Drivers (sweep + command surface)

- [x] `T3` — `Scheduler.registerAutopilotSweep()`
  - Files: `src/scheduler.ts`, `src/scheduler.test.ts` (or extend existing suite file if scheduler tests live elsewhere)
  - Estimate: medium
  - Depends: T1, T2
  - Notes: Mirror `registerBehaviourMirrorSweep` shape: 60s unref'd timer, deps `{ pool: {deliver, isBusy}, getChannels, saveChannels, checkHalt, onEscalate, notify, mcdDir }`. Per enabled project (skip master chatId): busy-skip (5 min grace), halt → suspend + escalate (mirror schedule 🛑 path), else execute `nextAutopilotAction` side effects: deliver seed/nudge envelope (`userId: '__mcd_autopilot__'`, messageId `autopilot-<chatId>-<ts>`), persist patch to the project's `autopilot` subtree only, escalate on `verify-failed`/`stall`, announce on `complete`/`rearm`. Log `[autopilot]` lines + `scheduler-history.jsonl` append. Tests with mock deps + injected config (AC3, AC4, AC6, AC7).

- [x] `T4` — Master command surface
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Depends: T1, T2
  - Notes: `handleSet`: `--autopilot on|off` (+ optional `--seed "<goal>"`, `--autopilot-interval N`, `--backlog-file <path>`); `on` resets runtime counters and stores seed goal for the sweep's first action; `off` clears runtime state; refuse on master channel target; allowFrom-gated like sibling flags. New `backlog <target>` verb: source, X/Y, state, last fire, zero-delta count, effective interval/threshold (read-only, works when off — uses T2 snapshot fns). Help text for both. Update the `set` usage error string. Tests: round-trips, refusals, unknown slug, rendering (AC1, AC8).

### Wave 3 — Integration + gate

- [x] `T5` — Server wiring
  - Files: `server.ts`
  - Estimate: small
  - Depends: T3, T4
  - Notes: Register sweep next to behaviour-mirror registration; wire `checkHalt` to `detectSpecclawHalt(projectDir(slug))`, notifications through `routeNotification` (completion → project channel + master; escalations → master, ⛽/🛑 shapes consistent with existing notices). No new env vars.

- [x] `T6` — Docs + full gate
  - Files: `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`
  - Estimate: small
  - Depends: T5
  - Notes: Document verb + flags + config block + state machine; add `backlog`/`--autopilot` to the implemented-verbs list in CLAUDE.md. Run full gate: `bun tsc --noEmit` + all five existing suites + new `backlog.test.ts` (AC10).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
