# Design: Orphan Session Sweep on Boot

**Change:** orphan-session-sweep
**Created:** 2026-07-23

## Technical Approach

New module `src/orphan-sweep.ts` with two layers:

1. **Pure matcher** — `findOrphanSessions(sessionNames: string[]): string[]` filters names against `/^mcd-.+-[a-z0-9]{4,12}$/`. Pure, exported, unit-tested. The bare `mcd` server session has no `-<suffix>` tail and never matches.
2. **Impure sweep** — `sweepOrphanSessions(): { killed: string[]; errors: string[] }` runs `tmux ls -F '#{session_name}'` via `spawnSync`, feeds names to the matcher, `tmux kill-session -t <name>` per match, logs each kill to stderr, returns the tally. Non-zero tmux exit (no server / no sessions) → return empty, no throw (NFR1).

Wiring in `server.ts`: call `sweepOrphanSessions()` during boot, immediately after config load and before `client.login()` — the pool only spawns on inbound Discord messages, so pre-login is strictly before any spawn (FR1). Gate on `config.defaults.orphanSweep !== false` (FR3). Stash the result; in the existing `clientReady` handler, if `killed.length > 0`, send the one-line summary to the master channel (FR5).

Config: add optional `orphanSweep: z.boolean().optional()` to the defaults schema in `src/channels-config.ts`.

## Architecture

Boot order (server.ts):

```
loadChannelsConfig()
  └─ if defaults.orphanSweep !== false → sweepOrphanSessions()   ← new
client.login()
client.once('clientReady') → post summary to master if killed > 0 ← new
...
projectPool lazily spawns mcd-<slug>-<ts> sessions on first message
```

A freshly booted server owns zero project sessions, so at sweep time every `mcd-<slug>-<ts>` match is by definition a leftover from a dead generation. No coordination with the pool is needed — that's what makes boot-time the only safe moment for a pattern-based kill.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/orphan-sweep.ts` | create | `findOrphanSessions` (pure) + `sweepOrphanSessions` (tmux ls/kill, logging) |
| `src/orphan-sweep.test.ts` | create | matcher unit tests: pattern hits, misses, multi-hyphen slugs, bare `mcd` |
| `src/channels-config.ts` | modify | add `orphanSweep?: boolean` to defaults zod schema |
| `server.ts` | modify | invoke sweep pre-login behind config gate; master-channel summary on clientReady |
| `CLAUDE.md` / `ARCHITECTURE.md` | modify | document sweep + opt-out flag |

## Data Model Changes

`channels.json` → `defaults.orphanSweep?: boolean` (absent = enabled).

## API Changes

None (no new MCP tools or `!project` verbs).

## Key Decisions

- **Kill-all-matches over pool-diff:** at boot the pool is empty, so "not in pool" degenerates to "matches the pattern". Simpler and race-free versus tracking ownership.
- **Pre-login placement:** guarantees sweep-before-spawn without locks; pool cannot receive a message before Discord login.
- **Pattern suffix `[a-z0-9]{4,12}`:** `Date.now().toString(36)` is 8 chars in 2026 (`mrwxepkq`); the range tolerates clock drift for decades while still excluding names like `mcd-server`.
- **Opt-out, not opt-in:** the leak bites every operator on every restart; multi-instance-shared-tmux is the rare topology and gets the flag.
- **stderr logging + master post, no new event plumbing:** matches existing server.ts conventions (`process.stderr.write` diagnostics).

## Risks & Mitigations

- **R1: kills a session the operator wanted** (e.g. hand-created `mcd-foo-test1234`). Mitigation: pattern requires the timestamp-shaped tail; opt-out flag; every kill logged by name.
- **R2: second MCD instance on same tmux server loses its sessions.** Mitigation: documented; that topology must set `orphanSweep: false` (EC2).
- **R3: sweep crashes boot.** Mitigation: all tmux calls wrapped, errors collected not thrown (NFR1, AC4).
