# Proposal: Backlog stall watch — days-scale stuck detection without autopilot

**Created:** 2026-07-25
**Status:** 🟡 Draft

## Problem

MCD only detects a stalled backlog when **autopilot is enabled** for the project: `nextAutopilotAction()` counts zero-delta fires and escalates to the master channel after `stallThreshold` (3) misses. Projects without an `autopilot` block — most of them — have **no backlog stall detection at all**. Heartbeats keep injecting nudges, the channel keeps replying, and an item can sit "open" for days or weeks with nobody noticing.

Observed on `dstm-apps`: the backlog item `excel-export-wide-preference-matrix` showed "PR #8266 open, pending merge" from **2026-07-15 to 2026-07-25** (10 days). The PR's code had actually merged to origin/main days earlier; the only thing stuck was the BACKLOG.md checkbox — itself parked on yet another unmerged docs PR. The channel meanwhile moved on to other changes, so day-to-day activity masked the stall. The operator discovered it only by asking "why am I stuck for a week?".

Autopilot's fires-based counter (3 × 30 min ≈ 90 min) is the wrong instrument anyway for "stuck for days" — it targets active seeded runs, not passive long-horizon drift.

## Proposed Solution

A **passive, days-scale backlog stall sweep**, independent of autopilot, registered on the existing scheduler alongside the autopilot sweep:

- For every non-master project whose dir has a detectable backlog source (reuse `detectBacklogSource()` / `snapshotBacklog()` from `src/backlog.ts`), take a snapshot each sweep (piggyback on the existing 60s scheduler tick, but evaluate at most hourly).
- Persist minimal runtime in `channels.json` per project: `backlogWatch: { lastSnapshot, lastDeltaAt }` (MCD-maintained, like autopilot runtime).
- When `open > 0` and `lastDeltaAt` is older than `staleBacklogDays` (default 3, `defaults.backlogWatch.staleBacklogDays` override, per-project override too):
  - Post a digest to the **master channel**: slug, open-item lines verbatim from the backlog, days since last delta.
  - Re-alert at most once per `staleBacklogDays` window (don't spam every sweep).
- Skip projects where autopilot is enabled and non-idle (autopilot already owns stall escalation there).
- Opt-out: `backlogWatch: false` on the project or `defaults.backlogWatch: false`.

Items annotated "pending merge / PR open" are exactly what this catches: zero delta for days ⇒ operator gets a digest naming the blocked item instead of silence.

## Scope

### In Scope
- New sweep in `src/scheduler.ts` (`registerBacklogWatchSweep`, mirrors `registerAutopilotSweep` shape) + wiring in `server.ts` with master-channel digest via existing escalation/announce path.
- Zod schema additions: `defaults.backlogWatch`, `projects[*].backlogWatch` (config + runtime fields) in `src/channels-config.ts`.
- Pure helpers in `src/backlog.ts` (or a small sibling): stale evaluation given snapshot + timestamps, digest formatting.
- Unit tests: stale detection, re-alert throttling, autopilot-active skip, opt-out.
- Docs: CLAUDE.md, ARCHITECTURE.md, README status table row.

### Out of Scope
- Verifying external PR state (ADO/GitHub) to auto-tick backlog items — separate, platform-specific feature.
- Auto-remediation (nudging the project channel) — watch reports to the operator; acting on it stays human/autopilot territory.
- Changes to autopilot's own stall machinery.

## Impact

- **Files affected:** ~6 (`src/scheduler.ts`, `src/backlog.ts`, `src/channels-config.ts`, `server.ts`, tests, docs)
- **Complexity:** medium
- **Risk:** low — read-only sweep + one master-channel message; worst case a false-positive digest

## Open Questions

- Default `staleBacklogDays`: 3 (lean) or 7? Operator was stuck 10 days; 3 would have fired twice.
- Digest destination: master channel only, or also the project channel itself as a self-nudge? (Lean: master only — the project channel already "knows" and that's the failure mode.)
- Should `!project backlog <target>` also show `lastDeltaAt` / staleness? (Cheap, probably yes.)

---

**To proceed:** Review this proposal and approve to begin planning.
