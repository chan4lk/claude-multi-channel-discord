You are a development assistant for the **multi-channel-discord** project — a project-aware Discord bot that runs one isolated `claude` CLI subprocess per Discord channel. Each channel is a "project" with its own system prompt, git working tree, and Claude Code session.

This file is your primary context for picking up development. Read it fully before touching code.

---

## What this project is

Fork of [`anthropics/claude-plugins-official/external_plugins/discord`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) (Apache-2.0). Adds per-channel Claude isolation: instead of one shared Claude session, each Discord channel gets its own `claude` process running inside a detached tmux session.

The operator communicates with the bot from a designated **master channel** using `!project ...` commands. Project channels each have their own git checkout, system prompt, and Claude session that persists across bot restarts via `--resume`.

---

## Process architecture

```
Discord Gateway (WSS)
       │
       ▼
 bun server.ts  ──────────────────────────────────────────────────────────────
 │                                                                            │
 ├─ discord.js Client                                                         │
 ├─ MasterMcpServer    (HTTP on 127.0.0.1:<ephemeral>)                       │
 │     └─ POST /mcp/<chat_id>  ← claude --mcp-config points here             │
 ├─ ProjectPool                                                               │
 │     └─ Map<chat_id, ClaudeProjectProcess>                                  │
 │              └─ tmux session "mcd-<slug>-<ts>"                            │
 │                     └─ claude --mcp-config <tmpfile> --strict-mcp-config  │
 ├─ master-channel command parser  (!project ...)                             │
 └─ Scheduler  (ticks every 60s, fires daily HH:MM jobs)                    │
```

**Inbound (Discord → Claude):** `tmux send-keys -l <text>` + Enter. Messages are wrapped in `<channel source="discord" chat_id="..." ...>BODY</channel>` before injection so the project's CLAUDE.md guidance applies.

**Outbound (Claude → Discord):** Claude calls `mcp__mcd__reply` against the HTTP MCP server. The server routes via pool → discord.js `channel.send`. Replies are chunked at Discord's 2000-char limit.

**Why tmux + send-keys:** The upstream `--channels plugin:discord@claude-plugins-official` flag that enables notification-driven mode is not exposed in the public CLI. Per-turn `claude -p "<msg>"` works but spawns a fresh process per message (~3-5s cold start) and loses the warm session. tmux keeps claude interactive in a real PTY without us holding a terminal.

**Why `--strict-mcp-config` + server name `mcd`:** The upstream discord plugin auto-loads in every claude session and registers a server also named `discord`. Claude then sees two `reply` tools and consistently picks the upstream one, which refuses with "channel not allowlisted." Fix: rename ours to `mcd` (tools become `mcp__mcd__reply` etc.) and pass `--strict-mcp-config` so claude only loads MCP servers from our config file.

**Why stateless HTTP MCP:** Stateful mode (UUID session IDs) deadlocked on reconnects — "Only one SSE stream is allowed per session." Fix: `sessionIdGenerator: undefined`, fresh `Server` + `Transport` per POST. No server-initiated notifications needed; send-keys handles inbound.

---

## Key source files

| File | Role |
|------|------|
| `server.ts` | Entry point. Discord client, glue, `buildMutator()` wires live implementations |
| `src/channels-config.ts` | `channels.json` zod schema + atomic IO |
| `src/paths.ts` | Filesystem layout (all paths, `MCD_CHANNELS_DIR` override) |
| `src/claude-process.ts` | `ClaudeProjectProcess` — real tmux/claude subprocess wrapper |
| `src/project-process.ts` | `ProjectProcess` interface + `MockProjectProcess` |
| `src/project-pool.ts` | Lazy spawn, LRU eviction, idle eviction, msg-id dedup |
| `src/master-mcp-server.ts` | HTTP MCP server, multiplexed by chat_id URL |
| `src/master-commands.ts` | `!project ...` parser + verb handlers |
| `src/git-ops.ts` | `buildGitEnv()`, `gitStatusSummary()`, `gitPull()` |
| `src/git-credentials.ts` | Credential aliases (mode 0600 enforced) |
| `src/scheduler.ts` | Daily HH:MM cron-lite, reads/writes `schedules.json` |
| `src/init.ts` | Bootstrap CLI (called by setup script + `/discord:project init` skill) |
| `src/argv.ts` | Bash-like argv splitter + flag parser |
| `src/discord-chunk.ts` | 2000-char chunker respecting Discord markdown |

Tests: `src/master-commands.test.ts`, `src/project-pool.test.ts`, `src/master-mcp-server.test.ts` (~80 checks total).

---

## State files layout

```
~/.claude/channels/discord-multi/          (MCD_CHANNELS_DIR)
├── .env                       DISCORD_BOT_TOKEN (mode 0600)
├── access.json                allowFrom + groups (mode 0600)
├── channels.json              project registry
├── git-credentials.json       credential aliases (mode 0600)
├── schedules.json             daily HH:MM jobs (mode 0600)
├── inbox/                     downloaded attachments
└── projects/
    ├── master/
    │   └── CLAUDE.md          deployed from templates/master.CLAUDE.md
    ├── <slug>/                per-project cwd (may be a symlink → real repo)
    │   ├── CLAUDE.md
    │   ├── .session-id        last claude session UUID (for --resume)
    │   └── .git/
    └── .archive/              soft-deleted projects (slug-timestamp dirs)
```

**`channels.json` key fields:**
- `master.chatId` + `master.commandPrefix` (default `!project`)
- `defaults.{model, idleEvictMinutes, maxConcurrent, git.{userName,userEmail,credentials,branchPrefix}, claude.{permissionMode,allowedTools,disallowedTools,extraArgs}, providers.<alias>.{baseUrl,apiKeyEnv}, provider?}`
- `projects[<chat_id>].{slug, model?, git?, claude?, provider?}`

---

## All implemented `!project` verbs

`list`, `show`/`status`, `create`, `clone`, `set`, `rename`, `remote`, `pull`, `usage`/`ps`/`top`, `stop`, `schedule add/list/pause/resume/rm`, `provider`, `rm --yes`, `help`

Mutation verbs require `userId ∈ access.allowFrom`. Destructive verbs (`rm`, `rename`, `remote --set`) require `--yes`.

The master project's Claude also exposes `mcp__mcd__run_master_command` so the operator can describe commands in natural language and have master Claude execute them.

---

## Provider routing

Projects default to Claude Code subscription auth (no API key). To route a project to an Anthropic-compatible API (MiniMax, Bedrock, Vertex):

```jsonc
"defaults": {
  "providers": {
    "minimax": { "baseUrl": "https://api.minimax.io/anthropic", "apiKeyEnv": "MINIMAX_API_KEY" }
  }
}
```

Then `!project create --provider minimax --model MiniMax-M2.7 ...`. At spawn `resolveProvider()` sets `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` in the subprocess env.

---

## Session resume

Each `ClaudeProjectProcess` captures the claude session UUID after TUI-ready by diffing the transcript directory (`encodeProjectCwd()`) before and after spawn. UUID is written to `projects/<slug>/.session-id`. On next spawn, `--resume <uuid>` is passed so claude picks up conversation history.

**Critical invariant:** `encodeProjectCwd()` must realpath symlinked project dirs before encoding. Claude resolves symlinks internally, so its transcript lands at the realpath-encoded directory, not the symlink-encoded one. Fixed in commit `7b99786`.

---

## Watchdog (stuck-agent protection)

`ClaudeProjectProcess` runs a stuck-watchdog timer (5 min threshold). A "stuck" check now AND-gates two conditions before killing:
1. No `reply` tool call received within `STUCK_THRESHOLD_MS`
2. The active session `.jsonl` transcript has not been written to within that window

This prevents false-positive kills during long legitimate turns (subagent work, parallel `Agent` calls). If transcript is advancing, a `progress-skip` event fires instead of a kill. Fixed in commits `2da3e63` (AND-gate), `9a6f572` (fallback when `.session-id` missing), `7b99786` (symlink realpath for transcript path).

The `resolveSessionId()` three-tier resolution:
1. In-memory cache
2. `.session-id` on disk
3. Snapshot-diff fallback (same as capture path)

---

## TUI readiness gate

`waitForTuiReady()` polls the tmux pane for two markers: `❯` cursor + "auto mode on" footer. Also auto-dismisses:
- `New MCP server found in .mcp.json` → send `3` + Enter (skip)
- `Do you trust the files in this folder?` → send Enter (accept)
- `Detected a custom API key` dialog → auto-dismissed via `3` + Enter

After first successful delivery, `tuiReady = true` is sticky.

---

## Development commands

```sh
# Run all tests
bun src/master-commands.test.ts
bun src/project-pool.test.ts
bun src/master-mcp-server.test.ts

# Typecheck
bun tsc --noEmit

# Start server
MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts

# Bootstrap fresh instance
bin/setup-new-instance.sh --state-dir ~/.claude/channels/discord-multi \
  --user-id <discord-user-id> --master <master-channel-id> \
  --slug master --prompt "You are the master controller." \
  <<< "$DISCORD_BOT_TOKEN"
```

---

## Operational gotchas

- **`pkill -f 'bun server.ts'` also matches the upstream bot.** Filter by cwd: `pgrep -f 'bun' | xargs -I {} sh -c 'cwd=$(readlink /proc/{}/cwd); [[ "$cwd" == */multi-channel-discord ]] && echo {}'`
- **`--new-channel` is find-or-create** (case-insensitive name match). Retrying `clone` after failure won't create duplicate channels. Pre-existing channels passed by snowflake ID are never modified.
- **Failed `clone`/`create` roll back auto-created channels** but leave operator-created ones alone.
- **`tmux send-keys` requires TUI ready.** Text lands but Enter gets dropped if sent before the prompt renders.
- **Symlinked project dirs** must be realpathed before computing transcript path. `encodeProjectCwd()` does this now.
- **Stateless HTTP MCP** means no server-initiated notifications. `isChatReady`, `waitForChatReady`, `closeChat`, `notifyChat` are one-line no-ops kept for caller symmetry.

---

## What's planned (remaining)

- Per-channel allowlists beyond `access.json groups[].allowFrom` (role-based)
- Cross-project handoff (`@<slug> please finish this`)
- `/discord:project` skill verbs that proxy `create`/`clone` without typing in Discord
- Proactive watchdog respawn on `claude` crash (currently lazy-respawns on next message)
- Resume-broken-PR support (bot died mid-push)
- Full cron syntax for scheduler (currently daily HH:MM only)
- Tool tests: HTTP probe → `mcp__mcd__reply` round-trip with mock sink
- `persistSessionAndRename` retry loop (so `.session-id` lands even if capture path lost the race with claude's first transcript write)

---

## Related docs in repo

- `README.md` — install, day-to-day operator commands, status table
- `ARCHITECTURE.md` — deep-dive on design choices, per-component contracts, state files
- `DESIGN.md` — original pre-implementation design doc
- `ROADMAP.md` — phases done vs planned
- `templates/master.CLAUDE.md` — master channel system prompt template
