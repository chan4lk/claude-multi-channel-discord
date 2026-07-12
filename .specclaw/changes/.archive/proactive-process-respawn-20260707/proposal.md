# Proposal: Proactive Process Respawn

**Created:** 2026-07-07
**Status:** 🟡 Draft

## Problem

ClaudeProjectProcess currently only respawns on **crashes** (non-zero exit). Clean-exit paths — LRU eviction (`pool-full`), idle eviction (`idleEvictMinutes` timeout), and explicit `kill()` — all call `markDead(0, null)`, which the pool treats as intentional stop and never reschedules.

This means a long-running project like `nexus` goes dark whenever:
- The pool hits `maxConcurrent` and LRU evicts it
- The idle-eviction timer fires (no message within `idleEvictMinutes`)
- The watchdog kills it and the circuit breaker has already opened (≥5 failures in 30 min → 10 min blackout)

Operator must send a message to trigger lazy-respawn, which may arrive minutes or hours later. Meanwhile the tmux session is gone — no warm context, user experience is broken.

## Proposed Solution

Add a **`persistent: true`** flag to the per-project config (and `defaults`). When set:

1. **Bypass idle eviction** — `idleEvictMinutes` timer does not fire for persistent projects.
2. **Bypass LRU eviction** — persistent projects are excluded from `evictLeastRecentlyUsed()` candidates.
3. **Respawn on clean exit** — the `onExit` handler in `spawn()` respawns via `recordFailureAndMaybeRespawn()` even when `code === 0`, treating all exits as recoverable for persistent projects.
4. **Relax circuit breaker for persistent projects** — raise `MAX_FAILURES_BEFORE_CIRCUIT` (or skip circuit for persistent) so one bad wave doesn't permanently silence the project.

Config at project level:
```jsonc
"projects": {
  "<chat_id>": {
    "slug": "nexus",
    "persistent": true   // ← new flag
  }
}
```

Or globally via `defaults.persistent: true`.

Spawn already carries all needed config from `channels.json` and reads `.session-id` for `--resume`, so the same config + session resume works out of the box — no new state required.

## Scope

### In Scope
- `persistent` boolean field in `channels.json` schema (Zod)
- Idle-eviction skip for persistent projects in `ProjectPool`
- LRU-eviction skip for persistent projects in `evictLeastRecentlyUsed()`
- `onExit` handler treating `code=0` as crash for persistent projects → routes through existing `recordFailureAndMaybeRespawn`
- Relaxed or bypassed circuit breaker for persistent projects (configurable `maxFailuresBeforeCircuit` per-project, or a `skipCircuit: true` sub-option)
- `!project show` and `!project list` surface `persistent: true` in status output

### Out of Scope
- Changing respawn behavior for non-persistent projects
- Cross-project handoff or failover
- Proactive health-check pings to a sleeping persistent project
- External process supervisor (systemd/supervisord) — this stays within the pool

## Impact

- **Files affected:** ~4 (`src/channels-config.ts`, `src/project-pool.ts`, `src/master-commands.ts`, tests)
- **Complexity:** small
- **Risk:** low — flag is opt-in; existing behavior unchanged when `persistent` is absent/false

## Open Questions

1. Should persistent projects be excluded from ALL evictions, or only LRU (still allow idle-evict after a very long timeout, e.g. 24h)?
2. Should circuit breaker be fully disabled for persistent projects, or just have a longer reset window (e.g. 30 min instead of 10)?
3. Should `!project stop` still honor stop (i.e., not respawn), even for persistent projects? Assumption: yes — `requested` kill = intentional operator action.

---

**To proceed:** Review this proposal and approve to begin planning.
