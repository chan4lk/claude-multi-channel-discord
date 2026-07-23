# Proposal: Orphan Session Sweep on Boot

**Created:** 2026-07-23
**Status:** 🟡 Draft

## Problem

Every MCD server restart leaks one `claude` subprocess per warm channel. The pool tracks its child tmux sessions in memory only; session names carry a spawn timestamp (`mcd-<slug>-<ts>`), so a new server generation spawns fresh sessions instead of reattaching, and the old detached sessions keep running forever. Idle-evict and the stuck-watchdog only reach pool-tracked processes, so orphans are invisible to every existing cleanup path.

Observed 2026-07-23: 17 orphan claude processes (~4.9GB RSS) from Jul 11–15 server generations on a 15GB box — including 5 copies of one channel from a restart loop, several resuming the same session UUID. Manually killed. Within minutes of cleanup, a message to `dstm-apps` spawned a new generation next to its surviving old one, reproducing the leak live.

## Proposed Solution

On server boot, before accepting messages, sweep tmux for stale MCD sessions:

1. List tmux sessions matching `mcd-<slug>-*` (exclude the server's own session, e.g. plain `mcd`).
2. Since a freshly booted server owns no project sessions yet, every match is by definition an orphan from a previous generation — kill it with `tmux kill-session`.
3. Log one line per kill (`orphan-sweep: killed mcd-<slug>-<ts>`) and a summary count; surface the summary to the master channel on first ready.

Session state is not lost: each project's conversation resumes via `.session-id` + `--resume` on next inbound message, exactly as after a normal evict.

Guard rails:
- Match only the exact `mcd-<slug>-<ts>` naming pattern for slugs present in `channels.json` plus a generic `mcd-*-<ts>` fallback; never touch non-MCD tmux sessions (e.g. an operator's `mcd` server session or unrelated sessions).
- Opt-out flag `defaults.orphanSweep: false` in `channels.json` for setups intentionally running multiple MCD instances against the same tmux server (they should set distinct session prefixes instead).

## Scope

### In Scope
- Boot-time sweep in `server.ts` / `ProjectPool` startup path
- Structured log events + master-channel summary line
- `defaults.orphanSweep` config flag (default `true`)
- Unit tests for the session-name matcher (pure function)

### Out of Scope
- Periodic (non-boot) sweeps — boot sweep alone caps the leak at one generation
- Reattaching orphans instead of killing them (resume-on-next-message already covers continuity)
- Multi-instance tmux namespacing (separate concern)

## Impact

- **Files affected:** 3–4 (estimated) — `server.ts`, `src/project-pool.ts` or new `src/orphan-sweep.ts`, `src/channels-config.ts`, tests
- **Complexity:** small
- **Risk:** medium — kill logic must never match the server's own tmux session or a concurrently-spawning session; mitigated by running before the pool spawns anything and excluding the exact server session name

## Open Questions

- Should the sweep also run on a schedule tick (e.g. hourly) to catch sessions leaked by pool-kill failures, or is boot-only enough? (Proposal: boot-only first; revisit if leaks reappear.)
- Multiple MCD instances on one host sharing a tmux server: is the config opt-out sufficient, or should session names embed an instance id? (Proposal: opt-out now, instance id later if anyone actually runs that topology.)

---

**To proceed:** Review this proposal and approve to begin planning.
