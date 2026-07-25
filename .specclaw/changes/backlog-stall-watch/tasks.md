# Tasks: Backlog stall watch

**Change:** backlog-stall-watch
**Created:** 2026-07-25
**Total Tasks:** 5

## Summary

Two waves. Wave 1: pure logic + schema + their tests (independent files). Wave 2: scheduler sweep + server wiring + sweep tests + docs.

## Tasks

### Wave 1 — Pure logic + schema

- [x] `T1` — evaluateBacklogWatch + listOpenItems in backlog.ts + unit tests
  - Files: src/backlog.ts, src/backlog.test.ts
  - Estimate: medium
  - Kind: impl
  - Notes: Per design §1. `evaluateBacklogWatch({snap, runtime, staleBacklogDays, nowMs})` returns `{action, patch}` — decision order: init (no lastSnapshot/lastDeltaAt) → delta (snapshot differs; patch clears lastAlertAt) → alert (open>0, lastDeltaAt older than days*86400000, alert window clear; patch lastAlertAt) → none. Clamp staleBacklogDays<1 to 3 inside. `listOpenItems(projectCwd, source, file?)`: file source = trimmed unchecked `- [ ]` line texts via TASK_LINE_RE; specclaw source = not-done change names using the same predicate snapshotSpecclaw applies (extract shared helper if cleanest); cap 10 + `(+N more)`; fs errors ⇒ []. Tests in backlog.test.ts following its existing style: AC1 full matrix (init, delta done/total, below-threshold none, past-threshold alert, re-alert throttle inside window, re-alert after window, zero-open never alerts, delta clears latch) + AC2 (both sources, cap behavior) using temp dirs like existing detect/snapshot tests.

- [x] `T2` — backlogWatch config schema
  - Files: src/channels-config.ts
  - Estimate: small
  - Kind: config
  - Notes: Per design §2. `backlogWatch` on project schema (enabled?, staleBacklogDays?, runtime lastSnapshot?/lastDeltaAt?/lastAlertAt?) + limits-only `defaults.backlogWatch` (enabled?, staleBacklogDays?). Match comment style of the autopilot schema blocks (~lines 119-151, 363-367). `.strict()` if sibling schemas use it — follow file convention.

### Wave 2 — Sweep + wiring + docs

- [x] `T3` — Scheduler sweep + tests
  - Files: src/scheduler.ts, src/scheduler.test.ts
  - Estimate: medium
  - Kind: impl
  - Depends: T1, T2
  - Notes: Per design §3. `registerBacklogWatchSweep(opts)` (timer, default 3_600_000ms, unref) + `runBacklogWatchSweep(opts)` public for tests, placed after the autopilot pair. Opts: getChannels, saveChannels, projectDirFor, onAlert(slug, chatId, {snap, staleDays, openItems}), mcdDir, sweepIntervalMs?. Skips: master chatId, autopilot?.enabled, resolved enabled false, source none. Persist patches via the same reload-merge-save pattern runAutopilotSweep uses. Tests in scheduler.test.ts following its autopilot sweep test patterns (temp project dirs, fake configs, captured onAlert): AC3 all four skip cases + AC4 init→stale→alert→throttle→delta-reset sequence with injected clock.

- [x] `T4` — Server wiring
  - Files: server.ts
  - Estimate: small
  - Kind: impl
  - Depends: T3
  - Notes: Per design §4. Register next to registerAutopilotSweep (~line 1586); onAlert posts master-channel digest via routeNotification (format per spec FR4). Typecheck against actual helper names in server.ts (loadChannelsConfig/saveChannels/projectDirFor equivalents — read the autopilot registration block and reuse its exact accessors).

- [x] `T5` — Docs
  - Files: CLAUDE.md, ARCHITECTURE.md, README.md
  - Estimate: small
  - Kind: docs
  - Depends: T3, T4
  - Notes: CLAUDE.md: channels.json key fields (backlogWatch), short feature para near autopilot docs. ARCHITECTURE.md: sweep contract at same depth as autopilot section. README.md: status-table/feature row if the file has one (follow existing structure). Rationale line: dstm-apps 10-day silent stall 2026-07-25.
