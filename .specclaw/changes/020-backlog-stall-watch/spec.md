# Spec: Backlog stall watch — days-scale stuck detection without autopilot

**Change:** backlog-stall-watch
**Created:** 2026-07-25

## Functional Requirements

**FR1 — Pure stall evaluation.**
A pure function in `src/backlog.ts` (`evaluateBacklogWatch`) decides, from a current snapshot + persisted runtime (`lastSnapshot`, `lastDeltaAt`, `lastAlertAt`) + config (`staleBacklogDays`) + `now`, one of:
- `init` — no runtime yet: persist snapshot, set `lastDeltaAt = now`, no alert.
- `delta` — snapshot differs from `lastSnapshot` (done or total changed): persist new snapshot, `lastDeltaAt = now`, clear any alert latch.
- `alert` — `total - done > 0`, `now - lastDeltaAt >= staleBacklogDays` days, and (`lastAlertAt` unset OR `now - lastAlertAt >= staleBacklogDays` days): set `lastAlertAt = now`.
- `none` — everything else.

**FR2 — Open-item listing for the digest.**
A helper returns the open items for a project: for `file` source, the raw unchecked checkbox lines (trimmed) from the backlog file; for `specclaw` source, the change names counted as not-done by the existing specclaw snapshot logic. Capped at 10 with a `(+N more)` suffix.

**FR3 — Scheduler sweep.**
`Scheduler.registerBacklogWatchSweep(opts)` (mirroring `registerAutopilotSweep`'s options shape: pool-free — it only needs `getChannels`, `saveChannels`, `projectDirFor`, `onAlert`, `mcdDir`, `sweepIntervalMs`) iterates all non-master projects each sweep (default interval 1 hour):
- Skip when `project.autopilot?.enabled` is true (autopilot owns stall escalation there).
- Skip when watch is disabled (FR5).
- Skip when `detectBacklogSource()` returns `'none'`.
- Otherwise snapshot, run `evaluateBacklogWatch`, persist runtime patches via `saveChannels`, and invoke `onAlert(slug, chatId, digest)` on `alert`.

**FR4 — Master-channel digest.**
`server.ts` wires `onAlert` to post to the master channel (same `routeNotification` pattern as autopilot escalation): `📋 **<slug>**: backlog stalled — X open item(s), no movement for N day(s)`, followed by the open-item list from FR2 and a hint (`check the channel or merge pending PRs; disable with set <slug> --backlog-watch off` — hint text only, the set flag itself is out of scope).

**FR5 — Config schema.**
- `projects[*].backlogWatch: { enabled?: boolean; staleBacklogDays?: number; lastSnapshot?; lastDeltaAt?; lastAlertAt? }` — all optional; runtime fields MCD-maintained.
- `defaults.backlogWatch: { enabled?: boolean; staleBacklogDays?: number }` — limits/defaults only.
- Resolution: project value ?? defaults value ?? built-ins (`enabled: true`, `staleBacklogDays: 3`).

**FR6 — No behavior change for autopilot.**
Autopilot code paths and config are untouched.

## Non-Functional Requirements

**NFR1 —** Sweep cost per project: one `detectBacklogSource` + one snapshot read per hour; no subprocess spawns, no message injection into project channels.
**NFR2 —** All decision logic pure and unit-testable without fs/timers (fs only in the existing detect/snapshot helpers + the FR2 lister).
**NFR3 —** A malformed/missing backlog file never throws out of the sweep (reuse existing defensive helpers).

## Acceptance Criteria

- **AC1:** `evaluateBacklogWatch` unit tests cover: init, delta (done change, total change), stale-but-below-threshold ⇒ none, stale past threshold ⇒ alert, re-alert throttled inside window, re-alert fires after window, zero open items ⇒ never alert, delta clears alert latch.
- **AC2:** Open-item lister returns unchecked lines for file source and not-done change names for specclaw source; caps at 10 with `+N more`.
- **AC3:** Sweep skips: master project, `autopilot.enabled: true` projects, `backlogWatch.enabled: false` (project or defaults), source `none`.
- **AC4:** Sweep persists runtime (lastSnapshot/lastDeltaAt/lastAlertAt) through `saveChannels` and fires `onAlert` exactly per FR1 (scheduler-level test with temp dirs and injected clock, following existing `scheduler.test.ts` autopilot patterns).
- **AC5:** Alert text posts to master channel via the server wiring (code-review evidence; message format per FR4).
- **AC6:** Existing suites all pass + `bun tsc --noEmit` clean; new checks live in `src/backlog.test.ts` and `src/scheduler.test.ts`.

## Edge Cases

- Server restart wipes nothing: runtime lives in `channels.json`, so staleness measured across restarts.
- First sweep on a long-stale backlog: `init` sets `lastDeltaAt = now` — alert fires only after `staleBacklogDays` of *observed* stagnation (no pre-history available; documented behavior).
- Backlog completes (open = 0) while stale: no alert; a later `delta` (new items) restarts the clock.
- Project dir missing/unreadable: `detectBacklogSource` returns `'none'` ⇒ skip.
- `staleBacklogDays: 0` or negative: treat as built-in 3 (clamp in resolution).
