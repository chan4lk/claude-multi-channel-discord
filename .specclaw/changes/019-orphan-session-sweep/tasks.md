# Tasks: Orphan Session Sweep on Boot

**Change:** orphan-session-sweep
**Created:** 2026-07-23
**Total Tasks:** 4

## Summary

Two waves. Wave 1 builds the standalone module + config flag + tests (parallelizable, no server.ts contention). Wave 2 wires the sweep into boot and documents it.

## Tasks

### Wave 1 — Module, config, tests

- [x] `T1` — Create `src/orphan-sweep.ts`
  - Files: src/orphan-sweep.ts
  - Estimate: small
  - Kind: impl
  - Notes: `findOrphanSessions(names: string[]): string[]` pure, regex `/^mcd-.+-[a-z0-9]{4,12}$/`. `sweepOrphanSessions(): { killed: string[]; errors: string[] }` — `tmux ls -F '#{session_name}'` via spawnSync; non-zero exit → `{ killed: [], errors: [] }`; kill each match, log `orphan-sweep: killed <name>` to stderr, collect per-session kill failures into `errors` and continue (EC3).

- [x] `T2` — Add `orphanSweep` flag to defaults schema
  - Files: src/channels-config.ts
  - Estimate: small
  - Kind: config
  - Notes: `orphanSweep: z.boolean().optional()` on defaults. Absent ⇒ enabled.

- [x] `T3` — Matcher unit tests
  - Files: src/orphan-sweep.test.ts
  - Estimate: small
  - Kind: test
  - Depends: T1
  - Notes: hits (`mcd-claude-mcd-mrwxepkq`, `mcd-application-collector-mrggsfaj`), misses (`mcd`, `mcd-server`, `main`, `work`, `mcd-x-THISISLONGSUFFIX13`), empty input. Follow existing bun test style (see src/bot-peers.test.ts).

### Wave 2 — Boot wiring + docs

- [x] `T4` — Wire sweep into server boot + master summary + docs
  - Files: server.ts, CLAUDE.md, ARCHITECTURE.md
  - Estimate: medium
  - Kind: impl
  - Depends: T1, T2
  - Notes: call sweep after config load, before `client.login()`, gated on `config.defaults.orphanSweep !== false`; log `orphan-sweep: disabled` when opted out (AC3). Stash result; in existing `clientReady` handler post `🧹 orphan sweep: killed N stale claude sessions from a previous server generation` to master channel iff N>0 (FR5). Document flag + behavior in CLAUDE.md state-files section and ARCHITECTURE.md.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
