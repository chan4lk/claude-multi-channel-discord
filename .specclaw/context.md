# Project Context

_Last updated: 2026-07-29 (ops-mcp-surface)._

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

- **ops-mcp-surface (2026-07-29)**: read-only operator endpoint `POST /mcp/ops` on `MasterMcpServer`, gated by instance-level top-level `opsToken` in channels.json (`!project ops rotate --yes | none`; absent = off). Seven tools (`list_projects`, `project_status`, `backlog_state`, `schedules`, `usage`, `collab_state`, `server_info`) delegate by composing whitelisted read-only command strings through the injected `executeMasterCommand` — never export render handlers; slug regex `/^[A-Za-z0-9._-]{1,64}$/` is the argv-injection boundary. Separate `buildOpsServer()` so session/master tools are structurally absent, not gated. Token isolation is mutual: opsToken only on `/mcp/ops`, chat/external tokens never there. Stateless serving shared via `serveStateless()` helper.
- **claude-ai-connector (2026-07-28)**: MCP endpoint reachable by claude.ai custom connectors via a persistent per-project `externalToken` (`projects[*].externalToken`, `!project set <slug> --external-token rotate --yes` / `none`). `tokenValid()` became `tokenSource()` returning `'local' | 'external' | null`; external source is refused for the master chat inside `tokenSource()` itself (hand-edited config can't bypass), refused on `disabled` projects, and logged with an `external` marker. claude.ai can't send custom headers, so the auth bridge is a Caddy capability-URL (secret path prefix → strip → inject `x-mcd-token`) documented in README "claude.ai connector"; MCD keeps binding 127.0.0.1 (`MCD_MCP_PORT` fixes the port). No OAuth in MCD by design.
- **hermes-project-invoke (2026-07-25)**: `hermes_run` widened from master-only to per-project opt-in (`projects[*].hermes.enabled`, `!project set <slug> --hermes on --yes`). Single `hermesAccess()` predicate guards both tool listing and execution; project runs report to their own channel and post a master audit notice (`🛰 hermes run <id> launched by <slug>`, 120-char prompt preview).
- **collab-handoff-protocol (2026-07-26)**: `handoff` upgraded from fire-and-forget to tracked — registry in `shared/handoffs.json` (`src/handoffs.ts`, `pending → done | expired`, atomic writes, closed-record pruning), `#h-<id>` tags on every delivery, `handoff_complete` closes (target session or master; broad listing is safe because call-time enforces record ownership). Bot-peer targets (`collab.roles` values in `botPeers.allow`) get an `<@botId>` mention post in the source channel; an allowlisted bot reply containing a pending `#h-<id>` auto-closes it and is exempt from the bot-peer turn limit — exemption requires a matching *pending* id so it can't be abused for loops. 5-min scheduler sweep nags receiver at `timeoutMinutes` (defaults-level only in v1, built-in 30) and escalates to master + expires at 2×. High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json` (operator-owned config).
