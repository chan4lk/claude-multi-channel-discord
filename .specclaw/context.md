# Project Context

_Last updated: 2026-07-26 (collab-handoff-protocol)._

## Architecture Overview

MCD (multi-channel-discord) runs one isolated `claude` CLI subprocess per Discord/Teams/WhatsApp channel, glued by `bun server.ts`: discord.js client → `ProjectPool` (tmux-wrapped `ClaudeProjectProcess` per chat) → stateless HTTP `MasterMcpServer` multiplexed by chat_id URL. Outbound replies flow through `mcp__mcd__*` tools; inbound via `tmux send-keys`. See ARCHITECTURE.md for the full component map.

## Coding Style & Conventions

- TypeScript on bun; tests are plain `bun src/<name>.test.ts` scripts with PASS/FAIL check lines (no test framework).
- Zod schemas in `src/channels-config.ts` are the single source of truth for `channels.json`; per-project opt-in blocks are `.optional()` (absent = feature off) and `.strict()`.
- Gate checks live in private `<feature>Access`/`<feature>Source` methods on `MasterMcpServer` returning a source discriminator or `null`.

## Key Patterns

- **Per-project opt-in reach grants**: features that widen a project Claude's reach (handoff, botPeers, peers, hermes) are off by default, enabled per-project in `channels.json`, and toggled via `!project set` flags; flags that grant reach require `--yes`.
- **Defense in depth on MCP tools**: tool listing AND call handler check the same gate independently — a stale tool list can never bypass execution.
- **Injectable side effects**: spawn functions (`hermesSpawnFn`), clocks (`now`), and mutators are constructor-injected so tests never launch real processes.
- **Master audit notice**: project-initiated privileged actions post a one-line notice to the master channel via the `onReply` outbound path.

## Technology Decisions

- Hermes bridge (`src/hermes-bridge.ts`) spawns detached one-shot `hermes -z <prompt>` runs; prompt passes as a single argv element, never through a shell. Report-back is `hermes send --to discord:<chatId>` — Discord-only.

## Constraints

- Never kill/restart the MCD server from inside a project session — delegate restarts to Hermes.
- No per-project Hermes bridge config overrides (binPath/yolo/extraArgs) — `defaults.hermes` is the only bridge config; projects get an access flag only.
- `--strict-mcp-config` + server name `mcd` must be preserved (upstream plugin tool-name collision).

## Recent Decisions

- **hermes-project-invoke (2026-07-25)**: `hermes_run` widened from master-only to per-project opt-in (`projects[*].hermes.enabled`, `!project set <slug> --hermes on --yes`). Single `hermesAccess()` predicate guards both tool listing and execution; project runs report to their own channel and post a master audit notice (`🛰 hermes run <id> launched by <slug>`, 120-char prompt preview).
- **collab-handoff-protocol (2026-07-26)**: `handoff` upgraded from fire-and-forget to tracked — registry in `shared/handoffs.json` (`src/handoffs.ts`, `pending → done | expired`, atomic writes, closed-record pruning), `#h-<id>` tags on every delivery, `handoff_complete` closes (target session or master; broad listing is safe because call-time enforces record ownership). Bot-peer targets (`collab.roles` values in `botPeers.allow`) get an `<@botId>` mention post in the source channel; an allowlisted bot reply containing a pending `#h-<id>` auto-closes it and is exempt from the bot-peer turn limit — exemption requires a matching *pending* id so it can't be abused for loops. 5-min scheduler sweep nags receiver at `timeoutMinutes` (defaults-level only in v1, built-in 30) and escalates to master + expires at 2×. High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json` (operator-owned config).
