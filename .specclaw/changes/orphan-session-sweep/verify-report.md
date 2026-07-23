# Verify Report: orphan-session-sweep

**Change:** orphan-session-sweep
**Date:** 2026-07-23
**Verdict:** ✅ PASS (7/7 ACs)

## Commands

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `bun tsc --noEmit` | ✅ clean |
| New tests | `bun src/orphan-sweep.test.ts` | ✅ 14/14 |
| Regression | `bun src/master-commands.test.ts` | ✅ all checks passed |
| Regression | `bun src/project-pool.test.ts` | ✅ all checks passed |

## Acceptance Criteria

- **AC1 (sweep on boot, pre-spawn)** ✅ — `sweepOrphanSessions()` called in `server.ts` top-level module flow before `client.login()`; sweep is `spawnSync` (synchronous), and pool spawns only on inbound messages which require a logged-in gateway. Kill loop verified by unit tests at the matcher layer. *Not* exercised against the live tmux server — a live run would kill this verifier's own session; live confirmation lands on next operator restart, which will report via the master-channel summary.
- **AC2 (non-project sessions survive)** ✅ — tests: `mcd`, `mcd-server`, `main`, `work`, `hermes`, `mcd-x-THISISLONGSUFFIX13` all rejected by matcher.
- **AC3 (opt-out)** ✅ — `server.ts` gates on `loadChannelsConfig().defaults.orphanSweep !== false`, logs `orphan-sweep: disabled`. Schema field added (`channels-config.ts`), optional, absent ⇒ enabled.
- **AC4 (no tmux server / zero sessions)** ✅ — `ls.error || ls.status !== 0` returns empty result, never throws; whole call additionally wrapped in try/catch at the server.ts call site.
- **AC5 (master summary iff ≥1 killed)** ✅ — `clientReady` handler posts `🧹 orphan sweep: killed N ...` only when `killed.length > 0`; post failure logged, never fatal.
- **AC6 (resume intact)** ✅ — kill path is `tmux kill-session`, identical to `ClaudeProjectProcess.kill()`; `.session-id` written at spawn, untouched by sweep. Same-mechanism eviction observed working live on 2026-07-23 (channels killed manually resumed with context).
- **AC7 (typecheck + suites)** ✅ — table above.

## Edge cases

- EC1 multi-hyphen slug: covered by test (`mcd-application-collector-mrggsfaj` matches).
- EC3 partial kill failure: collected into `errors`, loop continues (code inspection; not unit-tested — impure path).
- EC2 multi-instance: documented limitation in CLAUDE.md/ARCHITECTURE.md, opt-out flag.

## Notes

Activation requires a server restart (running server predates this code). The restart itself will be the first live exercise of the sweep — expect the 🧹 summary in the master channel listing this session's own predecessor among the kills.
