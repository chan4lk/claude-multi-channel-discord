You are a development assistant for the **multi-channel-discord** project — a project-aware Discord bot that runs one isolated `claude` CLI subprocess per Discord channel. Each channel is a "project" with its own system prompt, git working tree, and Claude Code session.

This file is your primary context for picking up development. Read it fully before touching code.

> **⚠️ CRITICAL — READ BEFORE DOING ANYTHING:**
> You are running **inside** this bot as a subprocess. The `mcd` tmux session IS the production server that spawned you. **Never** run `tmux send-keys -t mcd C-c`, `pkill -f 'bun server.ts'`, or any command that restarts or kills the MCD server. Doing so kills the bot, which kills your own session. If code changes require a server restart, push to git and tell the operator to restart manually — or, when the Hermes bridge is enabled, delegate the restart to Hermes (`!project hermes` / `mcp__mcd__hermes_run`), which runs outside MCD's process tree and reports back after the bot returns.

> **⚠️ ON SESSION RESUME:**
> When this session resumes via `--resume`, do NOT automatically re-run tool calls or continue prior work. Wait for an explicit instruction from the operator. If the first message is a greeting ("hi", "hello") or short, respond briefly and wait. Do not replay debugging steps, file reads, or bash commands from the previous session.

---

## What this project is

Fork of [`anthropics/claude-plugins-official/external_plugins/discord`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) (Apache-2.0). Adds per-channel Claude isolation: instead of one shared Claude session, each Discord channel (or Teams/WhatsApp contact) gets its own `claude` process running inside a detached tmux session.

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
 └─ Scheduler  (ticks every 60s; daily HH:MM, intervals, 5-field cron)      │
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
| `src/project-pool.ts` | Lazy spawn, LRU eviction, idle eviction (transcript-mtime veto → `evict-skip`), msg-id dedup |
| `src/master-mcp-server.ts` | HTTP MCP server, multiplexed by chat_id URL |
| `src/master-commands.ts` | `!project ...` parser + verb handlers |
| `src/git-ops.ts` | `buildGitEnv()`, `gitStatusSummary()`, `gitPull()` |
| `src/git-credentials.ts` | Credential aliases (mode 0600 enforced) |
| `src/scheduler.ts` | Daily HH:MM / interval / 5-field cron jobs, reads/writes `schedules.json` |
| `src/hermes-bridge.ts` | Detached one-shot hermes-agent runs (`!project hermes`, `mcp__mcd__hermes_run`) |
| `src/init.ts` | Bootstrap CLI (called by setup script + `/discord:project init` skill) |
| `src/argv.ts` | Bash-like argv splitter + flag parser |
| `src/discord-chunk.ts` | 2000-char chunker respecting Discord markdown |
| `src/whatsapp-adapter.ts` | `WhatsAppAdapter` — Baileys socket, QR-to-master-channel pairing, inbound/outbound routing |
| `src/bot-peers.ts` | `BotPeerGate` — consecutive-turn limit, cooldown, notice latch, human reset for bot-peer inbound |
| `src/shared-learnings.ts` | Shared learnings board — `appendLearning`/`readLearnings` backed by `shared/learnings.md` |
| `src/backlog.ts` | Backlog autopilot pure logic — source detection, snapshots, seed/nudge prompts, state machine (`nextAutopilotAction`) |
| `src/handoffs.ts` | Handoff registry — tracked cross-agent handoffs (`pending→done|expired`), `shared/handoffs.json`, sweep + ack matching |

Tests: `src/master-commands.test.ts`, `src/project-pool.test.ts`, `src/master-mcp-server.test.ts`, `src/bot-peers.test.ts`, `src/shared-learnings.test.ts`, `src/backlog.test.ts`, `src/scheduler.test.ts` (~350 checks total).

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
├── shared/
│   └── learnings.md           cross-project learnings board (created on first share_learning call)
├── whatsapp-auth/             Baileys multi-file auth state (mode 0600); presence enables WhatsApp
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
- `projects[<chat_id>].{slug, model?, git?, claude?, provider?, platform?, whatsappJid?, botPeers?, peers?, hermes?, disabled?, enabledAt?, autoDisable?}` — `platform` is `'discord' | 'teams' | 'whatsapp'` (default `'discord'`); `whatsappJid` is required when `platform === 'whatsapp'` (contact's E.164 JID, e.g. `15551234567@s.whatsapp.net`); `botPeers: { allow: string[], maxConsecutive?, cooldownSeconds? }` enables allowlisted bot-peer inbound with loop-prevention; `peers: { allow: string[], maxHops?, cooldownSeconds? }` enables cross-project dialogue (mutual consent required on both sides)
- `defaults.botPeers.{maxConsecutive?, cooldownSeconds?}` — limits-only defaults (no `allow`); built-in fallback is maxConsecutive=5, cooldownSeconds=30
- `defaults.peers.{maxHops?, cooldownSeconds?}` — limits-only defaults for cross-project dialogue (no `allow`); built-in fallback is maxHops=6, cooldownSeconds=15
- `projects[*].collab.{roles?, timeoutMinutes?}` — collab handoff config: `roles` maps stable role names (e.g. `reviewer`) to an internal project slug or an allowlisted bot-peer id; `defaults.collab.{timeoutMinutes?}` limits-only (built-in 30 min). Reach itself stays behind the `handoff` flag (`projects[*].handoff` / `defaults.handoff`)
- `projects[*].autopilot.{enabled, file?, intervalMinutes?, stallThreshold?, respectHeartbeatWindow?}` + MCD-maintained runtime (`state`, `seededAt`, `seedGoal`, `lastFireAt`, `zeroDeltaCount`, `lastSnapshot`) — backlog autopilot; `defaults.autopilot.{intervalMinutes?, stallThreshold?}` limits-only (built-in fallback 30 min / 3)
- `projects[*].backlogWatch.{enabled?, staleBacklogDays?}` + MCD-maintained runtime (`lastSnapshot`, `lastDeltaAt`, `lastAlertAt`) — passive backlog stall watch (on by default when a backlog source exists); `defaults.backlogWatch.{enabled?, staleBacklogDays?}` limits-only (built-in fallback enabled / 3 days)
- `projects[*].hermes.{enabled}` — per-project Hermes bridge access (off by default); when true AND `defaults.hermes.enabled`, the project's Claude gains the `hermes_run` MCP tool
- `projects[*].disabled?` — project offline switch: `ProjectPool.deliver()` drops all inbound (no spawn) with a throttled `project disabled. use master to enable` notice; `enabledAt?` is an MCD-maintained ISO stamp written on re-enable (fresh idle window); `autoDisable?: false` exempts the project from the auto-disable sweep; `defaults.autoDisable.{enabled, idleDays?}` — opt-in hourly sweep that disables projects whose session transcript is idle > idleDays (default 7, clamp <1 → 7) and notifies master

---

## All implemented `!project` verbs

`list`, `show`/`status`, `create`, `clone`, `set`, `rename`, `remote`, `pull`, `usage`/`ps`/`top`, `stop`, `schedule add/inject/list/pause/resume/rm`, `provider`, `model`, `progress`, `branch`, `backlog`, `memory`, `heartbeat`, `hermes`, `collab`, `graph`, `teams-setup`, `rm --yes`, `help`

`set` flags include `--bot-peers <id,id,...> --yes` (set/replace allowlist) and `--bot-peers none` (remove block, no `--yes` needed); `--peers <slug,...>` (set/replace peer allow list, slugs must exist, no self/master) and `--peers none` (remove peers block); `--autopilot on|off [--seed "<goal>"] [--autopilot-interval <min>] [--backlog-file <path>]` (backlog autopilot — MCD seeds BACKLOG.md via the project's Claude, then nudge-loops until done; refused on master); `--hermes on --yes` / `--hermes off` (grant/revoke the project's `hermes_run` MCP tool; `on` requires `--yes` because it grants host-level ops reach; master target is a warn no-op); `--disabled on|off` (project offline switch — `on` stops the warm session and drops all inbound with a throttled notice, `off` re-enables and stamps `enabledAt`; no `--yes`, master target refused); `--collab-role <name>=<slug|botId>` / `--collab-role <name>=none` (set/remove a collab role — value validated against existing slugs / the project's `botPeers.allow`; no `--yes`, config only). `backlog <target>` shows source, X/Y done, autopilot state. `collab <target>` shows configured roles (stale-marked) + open handoffs.

Mutation verbs require `userId ∈ access.allowFrom`. Destructive verbs (`rm`, `rename`, `remote --set`) require `--yes`.

The master project's Claude also exposes `mcp__mcd__run_master_command` so the operator can describe commands in natural language and have master Claude execute them.

---

## Backlog stall watch (passive)

Independent of autopilot: an hourly `Scheduler.registerBacklogWatchSweep()` scans every non-master project with a detectable backlog source (`.specclaw/changes` or `BACKLOG.md`) and alerts the master channel when open items stop moving for `staleBacklogDays` (default 3; values <1 clamp to 3). Skips projects with `autopilot.enabled` (autopilot owns stall escalation there) or `backlogWatch.enabled: false`. Zero delta on the done/total snapshot for a full window ⇒ `📋 **<slug>**: backlog stalled — N open item(s)...` digest naming the open items (cap 10, then `(+N more)`); re-alerts throttled to once per window; any delta clears the alert latch. Runtime (`lastSnapshot`/`lastDeltaAt`/`lastAlertAt`) persists in `channels.json`. Rationale: a dstm-apps backlog item sat "pending merge" 10 days unnoticed (2026-07-25) — activity on other changes masked the stale signal. Pure decision logic in `src/backlog.ts` (`evaluateBacklogWatch`, `listOpenItems`); IO in `src/scheduler.ts`; alert wiring in `server.ts`.

---

## Project disable switch + auto-disable sweep

`!project set <slug> --disabled on|off` takes a channel offline without deleting it. The gate is a single check in `ProjectPool.deliver()` — the funnel every inbound path uses (Discord/Teams/WhatsApp, scheduler fires, autopilot nudges, bot-peers) — placed before kill-loop/circuit/budget/dedup so a disabled project records and queues nothing; it fires a `disabled-drop` pool event and `server.ts` posts `project disabled. use master to enable` to the originating channel (throttled 5 min/channel via `routeNotification`, platform-aware). `on` also kills the warm session (same path as `stop`); `off` deletes the flag and stamps `enabledAt`. Source-level skips keep logs honest: scheduler tick logs `skipped`/`project disabled` (fail-open `isProjectDisabled` dep), autopilot + backlog-watch sweeps `continue`, `ask_project` returns `target project is disabled`. Master can't be disabled; `list` marks disabled rows `⛔`.

Auto-disable: `defaults.autoDisable: { enabled, idleDays }` (opt-in, default idleDays 7) registers `Scheduler.registerAutoDisableSweep()` (hourly). Idle signal = newest session-transcript `.jsonl` mtime (`src/transcript-path.ts`, realpath-encoded like heartbeat) vs `max(mtime, enabledAt)` — any activity self-protects, never-used projects (no transcript) are skipped, `autoDisable: false` exempts per-project. Fires the same `disabled: true` flag as the manual toggle and posts `⛔ auto-disabled <slug> — idle Nd+` to master.

---

## Collab handoff protocol

Tracked cross-agent handoffs on top of the `handoff` flag. `mcp__mcd__handoff` (now with optional `role` arg resolved via `projects[*].collab.roles`) creates a registry record in `shared/handoffs.json` (`pending → done | expired`) and tags the delivery with `#h-<id>`. Internal project targets get the tagged envelope via `pool.deliver`; bot-peer targets (ids in the source project's `botPeers.allow`) get an `<@botId> [handoff #h-<id> from <slug>] <task>` post in the source channel (mention satisfies `DISCORD_ALLOW_BOTS=mentions`). Receivers close via `mcp__mcd__handoff_complete { id, outcome? }` (target session or master; idempotent) — or, for external bots, any allowlisted bot message containing a known pending `#h-<id>` auto-closes it and is **exempt from the bot-peer turn limit** (exemption only fires on a matching *pending* id, each id spends on first match — arbitrary `#h-` text can't bypass the loop gate). A 5-min scheduler sweep nags the receiver channel once at `timeoutMinutes` (default 30; v1 sweep reads the defaults-level timeout only) and escalates to master + marks `expired` at 2×. `!project collab <slug>` lists roles + open handoffs; `!project set <slug> --collab-role reviewer=<slug|botId>` configures.

Recommended channel norms for bot-peer channels (put in the project's CLAUDE.md): unaddressed human messages belong to the channel-owner bot — peers respond only when @mentioned; when a peer's blocking question is in your domain, answer it instead of letting it time out on the human; route work through `handoff` so it's tracked, not through free-text agreements.

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

## WhatsApp support

> **⚠️ UNOFFICIAL CLIENT — ToS WARNING:**
> WhatsApp support uses **Baileys** (`@whiskeysockets/baileys`), an unofficial WhatsApp Web client that is **not sanctioned by Meta/WhatsApp**. Using it can violate WhatsApp's Terms of Service and risks your phone number being permanently banned. Only use with a personal or dedicated self-hosted account — never a business-critical number.

WhatsApp is enabled when the `whatsapp-auth/` directory exists under `MCD_CHANNELS_DIR` OR when `WHATSAPP_ENABLED=1` is set in the environment. On first run, a QR code PNG is posted to the master Discord channel; scan it with your WhatsApp account within 60 seconds. The Baileys session is then persisted in `whatsapp-auth/` and survives restarts.

A single `WhatsAppAdapter` (Baileys socket) serves all WhatsApp projects via multiplexing — inbound `messages.upsert` events are matched to a project by the sender's JID and dispatched through the pool; outbound `mcp__mcd__reply` calls route back through the same adapter. Access control reuses `access.allowFrom`, matched against the sender's E.164 number. Inbound media is surfaced as attachment summaries only — files are not downloaded.

To bind a project to a WhatsApp contact, set `platform: "whatsapp"` and `whatsappJid: "<e164>@s.whatsapp.net"` on the project entry in `channels.json` (or use `!project set` once that flag is supported). Progress modes (`post`/`edit`) work over WhatsApp with parity to Discord and Teams.

---

## Hermes bridge (out-of-band ops)

Opt-in via `defaults.hermes.{enabled, binPath, yolo, extraArgs}` in `channels.json` (disabled by default). `!project hermes "<prompt>"` (master channel, allowFrom-gated) and the `mcp__mcd__hermes_run` MCP tool spawn a **detached** one-shot `hermes -z "<wrapped prompt>" --yolo` run via `src/hermes-bridge.ts`. The run outlives MCD — this is the sanctioned way to restart the MCD server: delegate to Hermes, which kills/restarts the bot and reports back via `hermes send` (its own Discord credentials, no MCD needed). Logs + metadata per run under `<MCD_CHANNELS_DIR>/hermes-runs/`; inspect with `!project hermes --tail <run-id>`. MCD never kills detached runs; hung runs are killed manually (`pgrep -af 'hermes.*-z'`). Prompt passes as a single argv element — never through a shell.

`hermes_run` is available to the master session always (when the bridge is enabled) and to project sessions the operator opts in via `projects[*].hermes.enabled` (`!project set <slug> --hermes on --yes`). Project-initiated runs report back to the **originating channel** (`hermes send --to discord:<project_chat_id>`), and every project launch posts a master audit notice: `🛰 hermes run <id> launched by <slug>: "<prompt ≤120 chars>"`. Limitation: report-back is Discord-only — Teams/WhatsApp projects can be opted in, but the Hermes-side report lands nowhere useful there.

---

## Session resume

Each `ClaudeProjectProcess` captures the claude session UUID after TUI-ready by diffing the transcript directory (`encodeProjectCwd()`) before and after spawn. UUID is written to `projects/<slug>/.session-id`. On next spawn, `--resume <uuid>` is passed so claude picks up conversation history.

**Critical invariant:** `encodeProjectCwd()` must realpath symlinked project dirs before encoding. Claude resolves symlinks internally, so its transcript lands at the realpath-encoded directory, not the symlink-encoded one. Fixed in commit `7b99786`.

---

## Orphan session sweep (boot)

Server restarts used to leak one warm claude subprocess per active channel: the pool's session map is in-memory, tmux sessions are detached, and session names embed a spawn timestamp, so a new server generation spawns fresh sessions and the old ones run forever (observed 2026-07-23: 17 orphans, ~4.9GB RSS). On boot — before `client.login()`, so strictly before any spawn — `sweepOrphanSessions()` (`src/orphan-sweep.ts`) kills every tmux session matching `mcd-<slug>-<base36ts>`; a fresh server owns none, so all matches are orphans. Conversations resume via `.session-id` on next message, same as idle-evict. When ≥1 killed, a `🧹 orphan sweep: ...` summary posts to the master channel on ready. Opt out with `defaults.orphanSweep: false` (required when multiple MCD instances share one tmux server).

---

## Watchdog (stuck-agent protection)

`ClaudeProjectProcess` runs a stuck-watchdog timer (5 min threshold). A "stuck" check now AND-gates two conditions before killing:
1. No `reply` tool call received within `STUCK_THRESHOLD_MS`
2. The active session `.jsonl` transcript has not been written to within that window

This prevents false-positive kills during long legitimate turns (subagent work, parallel `Agent` calls). If transcript is advancing, a `progress-skip` event fires instead of a kill. Fixed in commits `2da3e63` (AND-gate), `9a6f572` (fallback when `.session-id` missing), `7b99786` (symlink realpath for transcript path).

**Guard A — turn-completion detection:** the transcript watcher recognizes the `turn_duration` system event as end-of-turn and clears the pending-deliver flag (`noteTurnComplete()`, which also feeds `turnHistory`). A turn that completes WITHOUT calling the reply tool — e.g. a heartbeat answered "no reply" — is therefore never counted as stuck. Previously the flag stayed armed and caused an hourly kill/respawn loop (observed 2026-07-25, dstm-apps).

**Guard B — idle-evict transcript veto:** idle-evict now vetoes the kill when `transcriptMtimeMs()` shows the session transcript was written within the idle window, emitting an `evict-skip` pool event instead. `lastActivityMs` only tracks deliveries + MCP tool calls, so a long turn making no MCP calls looked idle — idle-evict killed a session mid-build (observed 2026-07-25, specclaw channel).

The `resolveSessionId()` three-tier resolution:
1. In-memory cache
2. `.session-id` on disk
3. Snapshot-diff fallback (same as capture path)

---

## Tool-call progress notifications (progressMode)

Per-project `progressMode` field in `channels.json` streams live tool-call activity to Discord during Claude turns. Three modes:

- `"off"` (default) — silent
- `"post"` — one Discord message per tool call, edited in-place on completion to show result/duration
- `"edit"` — one message per turn, grown in-place with the full tool chain as calls complete

**Implementation:** `ClaudeProjectProcess` polls the `.jsonl` transcript at `TMUX_POLL_INTERVAL_MS` (2s) to detect `tool_use`/`tool_result` blocks and emits `ToolProgressEvent`. `ProjectPool` forwards as `tool-progress` pool events. `server.ts:handleToolProgressEvent()` dispatches to Discord.

**Config:** Set `"progressMode": "edit"` on a project entry in `channels.json`, or set `defaults.progressMode` globally. `mcp__mcd__*` tool calls are always suppressed from progress output. Subprocess must be restarted (or lazy-respawn) to pick up config changes.

**Adaptive watchdog** (`stuckThresholdMinutes`): per-project override for the stuck-kill threshold. Default 5 min. Set higher for channels with long turns (e.g. TTS rendering, parallel subagents). Formula: `max(base, ceil(max_recent_turn * 1.5))`, capped at 30 min.

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
bun src/bot-peers.test.ts
bun src/shared-learnings.test.ts

# Typecheck
bun tsc --noEmit

# Start server (OPERATOR ONLY — never run this from inside the bot)
# MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts

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
- `/discord:project` skill verbs that proxy `create`/`clone` without typing in Discord
- Resume-broken-PR support (bot died mid-push)

Recently shipped (previously on this list): proactive respawn with backoff + circuit breaker (`ProjectPool.recordFailureAndMaybeRespawn`), 5-field cron scheduler syntax (#291), MCP tool round-trip tests (#295), `persistSessionAndRename` retry loop (6× at TUI-ready + per-deliver re-attempt), cross-project dialogue (`mcp__mcd__ask_project`, `share_learning`, `read_learnings`, `!project set --peers`).

---

## Related docs in repo

- `README.md` — install, day-to-day operator commands, status table
- `ARCHITECTURE.md` — deep-dive on design choices, per-component contracts, state files
- `DESIGN.md` — original pre-implementation design doc
- `ROADMAP.md` — phases done vs planned
- `templates/master.CLAUDE.md` — master channel system prompt template
