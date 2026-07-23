# Spec: Orphan Session Sweep on Boot

**Change:** orphan-session-sweep
**Created:** 2026-07-23
**Status:** 🟡 Draft

## Overview

Every MCD server restart leaks one warm `claude` subprocess per active channel: the pool's session map is in-memory, tmux sessions are detached, and session names embed a spawn timestamp (`mcd-<slug>-<base36ts>`, `src/claude-process.ts:467`), so a new server generation spawns fresh sessions instead of reattaching. On boot, sweep tmux for MCD-pattern sessions and kill them — a freshly booted server owns no project sessions, so every match is an orphan. Conversations are not lost: projects resume via `.session-id` + `--resume` on the next inbound message, identical to a normal idle-evict.

## Requirements

### Functional Requirements

- **FR1** — On server boot, before the pool can spawn any project process, list tmux sessions and kill every session whose name matches the MCD project-session pattern.
- **FR2** — The match pattern is `^mcd-.+-[a-z0-9]{4,12}$` (slug + base36 timestamp suffix). The bare server session (e.g. `mcd`) and non-MCD sessions must never match.
- **FR3** — The sweep is enabled by default and disabled when `defaults.orphanSweep: false` is set in `channels.json`.
- **FR4** — Each kill emits one stderr log line (`orphan-sweep: killed <name>`); a summary line reports the total.
- **FR5** — When ≥1 session is killed, a one-line summary is posted to the master channel once Discord is ready (e.g. `🧹 orphan sweep: killed 3 stale claude sessions from a previous server generation`).
- **FR6** — Orphan-session matching logic is a pure function, exported and unit-tested.

### Non-Functional Requirements

- **NFR1** — Sweep must complete (or fail safely) without blocking boot: a tmux error (no server running, no sessions) is treated as "nothing to sweep", not a crash.
- **NFR2** — No new dependencies; use `spawnSync('tmux', ...)` like the rest of the codebase.

## Acceptance Criteria

- **AC1** — Boot with stale `mcd-<slug>-<ts>` tmux sessions present → all are killed before any project spawns; each logged.
- **AC2** — Sessions named `mcd`, `main`, `work`, `mcd-server` (no timestamp suffix shape) survive the sweep.
- **AC3** — With `defaults.orphanSweep: false`, no sessions are killed and a `orphan-sweep: disabled` line is logged.
- **AC4** — With no tmux server or zero sessions, boot proceeds normally with no error.
- **AC5** — Summary posts to the master channel when ≥1 killed; nothing posts when 0 killed.
- **AC6** — After a sweep, the first message to a previously-warm channel respawns it with `--resume` and conversation context intact (existing behavior, regression-checked by inspection).
- **AC7** — `bun tsc --noEmit` passes; new matcher tests pass; existing test suites unaffected.

## Edge Cases

- **EC1** — Session name with multi-hyphen slug (`mcd-application-collector-mrggsfaj`) → matches (`.+` covers hyphens).
- **EC2** — Session created by a *concurrent* second MCD instance sharing the tmux server → killed unless that instance sets `orphanSweep: false`. Documented limitation; opt-out is the supported topology.
- **EC3** — `tmux kill-session` fails for one session (already dying) → log and continue with the rest.
- **EC4** — Sweep runs while an old claude is mid-write to its transcript → safe: kill is the same path as idle-evict; `.session-id` is written at spawn, not at exit.

## Dependencies

None beyond existing `tmux` requirement.

## Notes

Root-cause context: 2026-07-23 incident — 17 orphans, ~4.9GB RSS, from ~5 server restarts on 2026-07-11. See proposal.md.
