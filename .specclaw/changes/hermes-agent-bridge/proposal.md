# Proposal: Hermes Agent Bridge — out-of-band ops executor for MCD

**Created:** 2026-07-15
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

MCD's own Claude subprocesses cannot perform certain ops tasks — most critically **restarting the MCD server itself** (killing `bun server.ts` kills the Claude session that issued the command; CLAUDE.md hard-forbids it). Other host-level ops (deploying prod apps, service restarts, system maintenance) are also awkward from inside a project session: they run inside the bot's own process tree and die with it.

The operator has **hermes-agent** (nousresearch/hermes-agent) installed on this box at `~/.hermes/hermes-agent` (CLI: `~/.local/bin/hermes`, MiniMax-M3 provider configured). Hermes is an independent agent process — outside MCD's process tree — so it CAN restart MCD, deploy apps, and survive MCD downtime. Today there is no path for MCD to hand a task to Hermes; the operator must SSH in manually.

## Proposed Solution

_What are we building? High-level approach._

Add a **Hermes bridge** to MCD with two injection surfaces:

1. **Master command verb** — `!project hermes "<prompt>" [--timeout <min>] [--detach]`
   Operator types natural-language ops task in the master channel; MCD spawns a one-shot Hermes run.

2. **MCP tool** — `mcp__mcd__hermes_run { prompt, detach? }` on the master MCP server (master channel only, or allowlisted projects)
   Lets master Claude delegate ops tasks conversationally ("restart the MCD server" → master Claude calls the tool → Hermes does the kill+restart while MCD dies and comes back).

**Injection mechanism (recommended): one-shot CLI, detached via `setsid`/`nohup`:**

```
setsid hermes -z "<prompt>" --yolo >> ~/.claude/channels/discord-multi/hermes-runs/<run-id>.log 2>&1 &
```

- Detached from MCD's process tree → survives MCD restart (the whole point for the restart-MCD use case).
- No daemon dependency — Hermes webhook gateway is currently **disabled** on this box; the CLI works today.
- Run log captured to a per-run file; MCD tails/reports completion when it's alive to do so. For restart-MCD runs, Hermes itself reports back via `hermes send --to discord:<master-channel>` (Hermes has Discord send capability using its own credentials, no running MCD required).

A small `src/hermes-bridge.ts` module owns: run-id generation, spawn, log-file layout, completion detection, and result relay to the master channel.

### Alternative considered (webhook gateway)

Hermes has an HTTP webhook platform (`hermes webhook subscribe` + gateway on port 8644, HMAC-signed). Cleaner API but requires enabling + supervising a second daemon (`hermes gateway`), and MCD→localhost POST dies with MCD anyway — no benefit for the self-restart case. Deferred; the bridge module isolates the spawn mechanism so a webhook backend can be swapped in later.

## Scope

### In Scope

- `src/hermes-bridge.ts` — spawn detached one-shot Hermes runs, run-id + log-file management, completion relay
- `!project hermes` master-command verb (access-gated: `access.allowFrom`, master channel only)
- `mcp__mcd__hermes_run` MCP tool exposed to master project session only
- Config in `channels.json`: `defaults.hermes.{enabled, binPath, extraArgs, timeoutMinutes}` (disabled by default; opt-in)
- Run history: `hermes-runs/` dir under `MCD_CHANNELS_DIR` with per-run log files
- Prompt-injection hygiene: prompt passed via argv (no shell interpolation), `--yolo` flag configurable
- Tests: verb parsing, spawn arg construction, config gating (mock spawn)
- Docs: CLAUDE.md + README section, including the restart-MCD recipe (Hermes prompt template that kills, restarts, and confirms via `hermes send`)

### Out of Scope

- Enabling/managing the Hermes webhook gateway daemon
- Per-project (non-master) access to `hermes_run` (future: allowlist)
- Streaming Hermes output live to Discord (log tail on completion only, v1)
- Managing Hermes config/auth/skills — operator owns Hermes setup
- Bi-directional session (multi-turn MCD↔Hermes conversation); one-shot prompts only

## Impact

- **Files affected:** ~6 (new `src/hermes-bridge.ts` + tests; edits to `src/master-commands.ts`, `src/master-mcp-server.ts`, `src/channels-config.ts`, `server.ts`, docs)
- **Complexity:** medium
- **Risk:** medium — Hermes runs with `--yolo` (auto-approve tools) on the host as the same user; a malicious/garbled prompt can do real damage. Mitigations: master-channel-only, `access.allowFrom` gate, opt-in config, argv-safe prompt passing, full run logs.

## Open Questions

1. `--yolo` always, or make it per-run opt-in (`--yolo` flag on the verb, default off = Hermes runs with its own approval hooks)?
2. Should completion relay be MCD-side (tail log, post to Discord when run exits) or Hermes-side (`hermes send` instruction appended to every prompt)? Proposal assumes MCD-side default + Hermes-side for restart-class tasks; confirm.
3. Timeout policy for runaway Hermes runs — kill after `timeoutMinutes` (default 30?) or never kill detached runs?
4. Is MiniMax-M3 acceptable for ops tasks, or pin a model per-run (`hermes -z ... -m <model>`)?

---

**To proceed:** Review this proposal and approve to begin planning.
