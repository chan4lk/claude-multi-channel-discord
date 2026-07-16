# Design: Hermes Agent Bridge — out-of-band ops executor for MCD

**Change:** hermes-agent-bridge
**Created:** 2026-07-15

## Technical Approach

New `src/hermes-bridge.ts` module owns everything Hermes-specific: config resolution, run-id generation, prompt wrapping, argv construction, detached spawn, and run metadata/log-file layout. The master-command verb and the MCP tool are thin callers into this module. Spawn is dependency-injected so tests never launch a real process.

The child is launched with Node `child_process.spawn(binPath, argv, { detached: true, stdio: ['ignore', fd, fd] })` + `child.unref()`, where `fd` is an opened write fd for `<run-id>.log`. Detachment makes the run survive MCD's own restart — the core use case ("Hermes, restart MCD").

Result reporting is **Hermes-side**: the wrapped prompt instructs Hermes to run `hermes send --to discord:<master-chat-id> "[hermes:<run-id>] <outcome>"` when done. This works even while MCD is down (Hermes has its own Discord credentials — verified on this box via `hermes send --list`).

## Architecture

```
Operator (Discord master channel)
   │  !project hermes "restart MCD"          master Claude: mcp__mcd__hermes_run
   ▼                                             │
master-commands.ts handleHermes() ◄──────────────┘ (both call the same bridge)
   │
   ▼
src/hermes-bridge.ts  launchHermesRun()
   │  wrap prompt → build argv → mkdir hermes-runs/ → open log fd
   │  spawn(binPath, ['-z', wrapped, '--yolo', ...], {detached, stdio:[ignore,fd,fd]}).unref()
   │  write <run-id>.json meta
   ▼
hermes (independent process, outlives MCD)
   │  ... does the ops task (may kill/restart MCD) ...
   ▼
hermes send --to discord:<master-chat-id> "[hermes:<id>] done: ..."
   ▼
Discord master channel (direct, no MCD involvement)
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/hermes-bridge.ts` | create | `launchHermesRun()`, `tailHermesRun()`, `listRecentRuns()`, `buildHermesArgv()`, `wrapHermesPrompt()`, `newRunId()`; injectable `spawnFn` |
| `src/hermes-bridge.test.ts` | create | argv construction, prompt wrapping (report/no-report), hostile prompt safety, disabled gating, meta file write, spawn options (detached/unref/stdio), tail + not-found |
| `src/paths.ts` | edit | add `hermesRunsDir()` → `join(channelsDir(), 'hermes-runs')` |
| `src/channels-config.ts` | edit | add `HermesConfigSchema` (`enabled`, `binPath`, `yolo`, `extraArgs`), slot into `DefaultsSchema` as optional `hermes` |
| `src/master-commands.ts` | edit | add `hermes` to `MUTATION_VERBS`, dispatch case, `handleHermes()` (launch + `--tail` mode), help text line |
| `src/master-mcp-server.ts` | edit | register `hermes_run` tool master-only + config-gated (mirror `run_master_command` pattern at :336), handler case calls bridge |
| `src/master-commands.test.ts` | edit | verb tests: launch reply shape, disabled message, `--tail`, unauthorized already covered by global gate |
| `server.ts` | edit | pass hermes config through where master MCP + commands are constructed (context already carries `config`; verify no extra wiring needed beyond tool-list gating callback) |
| `CLAUDE.md` / `README.md` | edit | bridge section: config, verbs, restart-MCD recipe, security notes |

## Data Model Changes

`channels.json` — new optional defaults sub-object:

```jsonc
"defaults": {
  "hermes": {
    "enabled": true,
    "binPath": "/home/openclaw/.local/bin/hermes",
    "yolo": true,            // default true
    "extraArgs": []           // appended verbatim
  }
}
```

New on-disk layout:

```
<MCD_CHANNELS_DIR>/hermes-runs/
├── h-<ts36>-<rand4>.log     combined stdout+stderr of the run
└── h-<ts36>-<rand4>.json    { runId, rawPrompt, wrappedPrompt, argv, pid, startedAt, masterChatId }
```

## API Changes

- New master verb: `!project hermes "<prompt>" [--model <m>] [--no-report]` and `!project hermes --tail <run-id> [--lines <n>]`
- New MCP tool (master session only, only when `defaults.hermes.enabled`): `hermes_run { prompt: string, model?: string }` → text result `run <id> launched; log: <path>`

## Key Decisions

1. **Detached one-shot CLI over webhook gateway** — webhook needs a second supervised daemon and dies with localhost POST anyway during self-restart. CLI works today. Bridge module isolates the mechanism for a later swap.
2. **Hermes-side result reporting** — `hermes send` instruction appended to prompt. Only mechanism that closes the loop while MCD is down. MCD-side log tailing rejected for v1 (adds watcher lifecycle for little value); `--tail` verb covers manual inspection.
3. **No timeout-kill** — a restarted MCD doesn't own the old pid; killing detached process groups reliably is more risk than value. Operator kills manually if needed.
4. **`spawnFn` injection** — matches repo's mock-driven test style (`MasterMutator` pattern); tests assert on captured spawn args instead of real processes.
5. **Run id `h-<Date.now().toString(36)>-<4 hex>`** — sortable, short enough to type in `--tail`.
6. **Verb classed as mutation verb** — it executes arbitrary ops on the host; belongs behind the same gate as `create`/`rm` (allowFrom enforced globally at master-commands.ts:124).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `--yolo` Hermes run executes destructive host actions from a garbled prompt | Opt-in config (disabled default); master-channel + allowFrom gate; full prompt+argv logged in `<run-id>.json`; docs warn |
| Prompt injection via shell metacharacters | argv-array spawn, never `shell: true`; hostile-prompt unit test |
| Hermes binary path wrong / PATH lacks `~/.local/bin` in server env | `binPath` config (docs recommend absolute); spawn `error` event → actionable Discord reply |
| Orphaned/hung Hermes runs accumulate | `--tail` + meta files for inspection; docs give manual kill recipe (`pkill -f 'hermes -z'` filtered by run log) |
| Restart-MCD prompt races (Hermes kills MCD before launch reply sent) | Launch reply sent before Hermes can plausibly act (spawn returns immediately); wrapped prompt tells Hermes to wait 5s before destructive steps as belt-and-suspenders |
| Duplicate reply tools confusion (upstream discord plugin) inside Hermes | N/A — Hermes is not Claude; it uses its own `hermes send` |
