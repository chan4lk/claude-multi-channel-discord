# Architecture

How the bot actually works at runtime, what each component owns, and the design choices that survived live debugging. Read [DESIGN.md](./DESIGN.md) for the original (pre-implementation) vision and [ROADMAP.md](./ROADMAP.md) for what's shipped versus planned.

---

## Process layout

```
   Discord Gateway (WSS)
              │
              ▼
        bun server.ts                                        ← single long-lived process
        ├─ discord.js Client                                   (the bot's identity)
        ├─ MasterMcpServer                                     stateless HTTP, port = ephemeral
        │     └─ POST /mcp/<chat_id>     ← claude --mcp-config
        ├─ ProjectPool                                         lazy-spawn, LRU+idle evict, msg-id dedup
        │     └─ Map<chat_id, ClaudeProjectProcess>
        │              └─ tmux session "mcd-<slug>-<ts>"       ← detached PTY
        │                      └─ claude --strict-mcp-config
        │                              ├─ stdin/stdout: tmux PTY  ← we send-keys here
        │                              └─ MCP HTTP client → /mcp/<chat_id>  ← reply tool & friends
        ├─ master-channel command parser                       intercepts !project ... in master only
        └─ legacy upstream MCP plumbing (skipped in standalone mode via MCD_CHANNELS_DIR)
```

One `bun` process owns the Discord gateway connection. Per-channel agents are isolated `claude` processes inside detached tmux sessions, driven by injected keystrokes and a shared HTTP MCP server.

---

## Why this shape (the choices that survived debugging)

### tmux + send-keys for inbound, HTTP MCP for outbound

We tried two approaches before this:

1. **Long-lived `claude --mcp-config <us>` listening for `notifications/claude/channel`** — works for the upstream Discord plugin because it's invoked with `--channels plugin:discord@claude-plugins-official`, a flag that activates *channel mode* and turns those notifications into prompts. The public CLI doesn't expose `--channels` for arbitrary MCP servers, so claude received our notifications and ignored them.
2. **Per-turn `claude -p "<msg>"`** — works headlessly but spawns a fresh process per message (~3-5s cold start) and loses the warm session.

The pattern that stuck:

- **`tmux new-session -d -s mcd-<slug>-<ts> 'claude --mcp-config ... --strict-mcp-config'`** keeps claude in interactive TUI mode (TTY = the tmux pane) without us holding a terminal.
- **Inbound** = `tmux send-keys -t <session> -l <text>; sleep 120ms; tmux send-keys C-m` injects the Discord message as if the operator typed it.
- **Outbound** = claude calls `mcp__mcd__reply` against our HTTP MCP server; the server pushes the reply through the pool to the discord.js client.

That's an asymmetric pattern (different transport in vs out) but each direction uses the path the CLI actually supports.

### `--strict-mcp-config` + server name `mcd`

Our server is named **`mcd`** (multi-channel-discord), not `discord`. The upstream `claude-plugins-official` discord plugin auto-loads in every claude session and registers an MCP server also called `discord`. Claude couldn't disambiguate the two `reply` tools and consistently chose the upstream one — which then refused with "channel not allowlisted" because its `access.json` belongs to a different bot.

Two fixes in combination:

- Rename ours to `mcd` so Claude sees `mcp__mcd__reply` vs `mcp__discord__reply`.
- Pass `--strict-mcp-config` so claude only loads MCP servers from our `--mcp-config` file. The upstream plugin still appears in disk discovery (it triggers a one-time approval dialog), but the actual server isn't started — we auto-dismiss that dialog with `3` + Enter inside `waitForTuiReady`.

### Stateless HTTP MCP, transport-per-request

`StreamableHTTPServerTransport` in *stateful* mode (sessionIdGenerator returning a UUID) deadlocked on reconnects: claude's MCP client opens a new SSE stream on each reconnect attempt, and the server rejects it with "Conflict: Only one SSE stream is allowed per session" / "Server already initialized." The fix is the SDK's canonical stateless example — `sessionIdGenerator: undefined` and a fresh `Server` + `Transport` per POST. Each request connect/handle/close is independent. Works reliably; downside is no server-initiated notifications, which we don't need (send-keys is the inbound path).

### TUI-readiness gate

Claude's Ink-based TUI takes 3-15s to render the prompt after `claude` boots. If we send-keys before the prompt is up, the text lands but the Enter key gets dropped (input handler not bound yet). `ClaudeProjectProcess.waitForTuiReady` polls the tmux pane for two markers — the `❯` cursor and the "auto mode on" footer — and only proceeds once both are visible. It also auto-dismisses two interactive dialogs that claude sometimes shows on first run:

- `New MCP server found in .mcp.json: <name>` → send `3` + Enter (skip; we ignore other MCP configs anyway).
- `Do you trust the files in this folder?` → send Enter (accept default).

After the first inbound, `tuiReady = true` is sticky and subsequent deliveries skip the wait.

---

## Per-component contract

### `MasterMcpServer` (`src/master-mcp-server.ts`)

Plain Node `http.createServer` listening on `127.0.0.1:<ephemeral>`. Routes by URL: only `POST /mcp/<chat_id>` is accepted; GET and DELETE return 405. For each POST it:

1. Reads JSON body from the request stream.
2. Builds a fresh `Server` configured with the chat-specific instructions (chat_id baked into the system prompt) and tool handlers (also chat-id closed).
3. Connects a new `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` and calls `transport.handleRequest(req, res, body)`.
4. Closes server + transport when the response closes.

Tool surface (per chat session):

- `mcp__mcd__reply` — always available. `{ text, reply_to? }` → routed via the pool's `onReply` to `dispatchProjectReply` → discord.js `channel.send`. Replies chunked at the upstream 2000-char limit, honoring `access.replyToMode` and `access.chunkMode`.
- `mcp__mcd__react`, `mcp__mcd__edit_message`, `mcp__mcd__download_attachment`, `mcp__mcd__fetch_messages` — available when constructed with a `Client` (which `server.ts` always passes). Direct discord.js calls.
- `mcp__mcd__run_master_command` — **only available in the master channel session** (gate: `chatId === getMasterChatId()`). Takes `{ command }` (everything after `!project`), routes through `handleMasterCommand`, returns the parser's reply text. This is what makes the master claude conversational — natural-language asks turn into real verbs without operator typing.
- `mcp__mcd__ask_project` — **only available when the project's config has `peers.allow` non-empty** (gate: `peerSource(chatId) !== null`). Delivers a message to another project session via `pool.deliver`, enforcing mutual consent, per-thread hop budget, and per-pair cooldown. Returns `{ ok, thread_id, hop, max_hops }`. Master is never a valid target.
- `mcp__mcd__share_learning` / `mcp__mcd__read_learnings` — available to any session with `peers.allow` non-empty **or** the master channel. Read/write the shared learnings board via `src/shared-learnings.ts`. See the SharedLearnings section below.

Cross-project constraint state is held in two `MasterMcpServer` instance maps (process lifetime, reset on restart):
- `threadHops: Map<string, number>` — thread_id → deliveries so far; FIFO-pruned at 500 entries.
- `pairLastSentMs: Map<string, number>` — `"src→dst"` → last delivery timestamp (ms).

### `Scheduler` (`src/scheduler.ts`)

Persistent cron-lite. Reads/writes `~/.claude/channels/discord-multi/schedules.json`. Ticks every 60s, walks the schedules table, fires anything that's due via `pool.deliver(chatId, syntheticEnvelope)`. Synthetic envelopes have `messageId = "sched-<id>-<ts>"` (so the dedup TTL doesn't collide with real Discord inbounds) and `userId = "__mcd_scheduler__"` (so the log distinguishes operator-typed messages from machine-fired ones).

`hasFiredToday()` keys off `lastRunAt` to dedup ticks within a minute and to avoid double-fires across bot restarts (a 09:00 schedule won't re-fire if the bot restarts at 09:30 on the same day). `maxRuns` auto-pauses runaway loops.

v1 timing: daily HH:MM, host local zone. The schema reserves a `cron` field for full-cron support. Surface from master is `!project schedule add/list/pause/resume/rm`.

Crucially, the scheduler doesn't know what kind of agent the project runs. It dispatches through `ProjectPool.deliver()` which dispatches to `ProjectProcess.deliver()`. Today the implementation is `ClaudeProjectProcess` spawning `claude`; nothing in the scheduler care if a future project runs MiniMax via the Anthropic-compatible API or some other CLI.

### Backlog autopilot (`src/backlog.ts` + `Scheduler.registerAutopilotSweep()`)

Config-driven sweep (behaviour-mirror-sweep pattern, NOT a schedules.json entry — the schedule schema is Discord-snowflake-bound and static-prompt) that drives a project through its backlog. Per-project `autopilot` block in `channels.json` holds user settings (`enabled`, `file`, `intervalMinutes`, `stallThreshold`, `respectHeartbeatWindow`) plus MCD-maintained runtime state (`state`, `seededAt`, `seedGoal`, `lastFireAt`, `zeroDeltaCount`, `lastSnapshot`) — same mutable-config precedent as `lastInjectedAt`.

State machine: `seeding → running → halted | complete`. Fresh enable with no backlog → seed injection (MCD asks the project's Claude to author `BACKLOG.md`; goal from `--seed` or derived from CLAUDE.md); no backlog after 2 intervals → escalate + halt. Running → interval-gated nudges ("work the next unchecked item"), fired only when idle (`ProjectPool.isBusy`, 5-min grace) and inside `heartbeat.window`; `stallThreshold` consecutive zero-delta snapshots → halt + master escalation; specclaw guardrail halt (`detectSpecclawHalt`) suspends the same way. All done → 🏁 announce, `complete`; new items → auto re-arm. `halted` requires manual `set --autopilot on` re-arm.

Backlog source auto-detection: `.specclaw/STATUS.md` present → specclaw flavor (pending proposals + active-change `tasks.md` checkboxes); else markdown checkboxes in the backlog file. All parsing/transition logic is pure (`src/backlog.ts`, clock injected) — the sweep in `scheduler.ts` only does IO and side effects. Envelopes use `userId = "__mcd_autopilot__"`, `messageId = "autopilot-<chatId>-<ts>"`; fires append to `scheduler-history.jsonl`.

### Backlog stall watch (`src/backlog.ts` + `Scheduler.registerBacklogWatchSweep()`)

Passive, days-scale counterpart to autopilot: it never injects prompts, it only watches snapshots and alerts master when a backlog stops moving. Motivation: a project's backlog item sat "pending merge" for 10 days unnoticed because activity on *other* changes masked the stale one (dstm-apps, 2026-07-25).

`registerBacklogWatchSweep({ getChannels, saveChannels, projectDirFor, onAlert?, mcdDir, sweepIntervalMs? })` starts an unref'd `setInterval` (default 1 h) over `runBacklogWatchSweep`. Per project the sweep skips, in order: the master project; projects with `autopilot.enabled` (one stall owner per project — autopilot escalates its own stalls); `backlogWatch.enabled === false` (resolution: project → `defaults.backlogWatch` → built-in `true`); and projects where `detectBacklogSource()` returns `'none'` (same source detection as autopilot — specclaw wins over `BACKLOG.md`). `staleBacklogDays` resolves project → defaults → built-in 3; values < 1 clamp back to 3 inside the pure evaluator.

Decision logic is pure: `evaluateBacklogWatch({ snap, runtime, staleBacklogDays, nowMs })` returns one of four `BacklogWatchAction` kinds plus a runtime patch —

- `init` — no persisted history yet; sets `lastSnapshot` + `lastDeltaAt` to now (no fabricated staleness).
- `delta` — done/total moved; records the new snapshot, resets `lastDeltaAt`, and clears the alert latch (`lastAlertAt: undefined` in the patch → key deleted on merge), so a backlog that moves then re-stalls re-alerts after a fresh full window.
- `alert { openCount, staleDays }` — open items exist, no movement for ≥ `staleBacklogDays`, and no alert within the same window (re-alert throttle); sets `lastAlertAt`.
- `none` — nothing to do, empty patch.

Runtime (`lastSnapshot`, `lastDeltaAt`, `lastAlertAt`) lives on the project's `backlogWatch` block in `channels.json` — same MCD-maintained mutable-config precedent as autopilot's runtime fields. The sweep re-reads the config before persisting each patch (read-merge-write, `undefined` keys deleted) so it never clobbers concurrent edits with a stale copy.

On `alert`, `server.ts` renders the digest and posts it to the master channel: `📋 **<slug>**: backlog stalled — N open item(s), no movement for D+ day(s)` followed by the open items from `listOpenItems()` (unchecked task text for file flavor, not-done change-dir names for specclaw; capped at 10 with a `(+N more)` tail) and a disable hint (`backlogWatch.enabled: false`). Per-project errors are logged and never abort the sweep.

### Provider routing

Projects default to the operator's Claude Code subscription auth (no API key, no env override at spawn). To route specific projects to a different Anthropic-compatible API:

```jsonc
"defaults": {
  "providers": {
    "minimax": {
      "baseUrl": "https://api.minimax.io/anthropic",
      "apiKeyEnv": "MINIMAX_API_KEY"
    }
  }
}
```

Then `!project create --provider minimax --model MiniMax-M2.7 ...` (or `clone --provider minimax ...`). At spawn time `resolveProvider()` looks up the alias, reads the API key from the bot's process env (`MINIMAX_API_KEY`), and `ClaudeProjectProcess` sets `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` in the subprocess env. The per-channel claude is otherwise identical — same MCP config, same git env, same TUI dance — it just calls MiniMax instead of Anthropic when it generates.

Mixing providers across channels is fine. Subscription-auth projects coexist with API-key-auth projects in the same bot process.

### WhatsApp adapter (`src/whatsapp-adapter.ts`)

WhatsApp is a third platform alongside Discord and Teams. `WhatsAppAdapter` wraps a single **Baileys** (`@whiskeysockets/baileys`) WebSocket — one socket, all WhatsApp projects, multiplexed by JID. The adapter mirrors the Teams adapter contract at the same three seams `server.ts` uses for all platforms:

- **Inbound:** Baileys `messages.upsert` events are matched to a project by the sender's JID (stored as `whatsappJid` on the project entry), wrapped into an `InboundEnvelope`, and handed to `ProjectPool.deliver()` — identical to the Teams path.
- **Outbound (`postReply`):** `mcp__mcd__reply` calls land in `MasterMcpServer`; the pool's `onReply` callback calls `WhatsAppAdapter.postReply(chatId, text)` which sends the message via Baileys.
- **Progress updates (`updateActivity`):** `post`/`edit` progress modes work over WhatsApp with parity to Discord and Teams.

The project's `platform` field (`'discord' | 'teams' | 'whatsapp'`) is the dispatch switch in `server.ts` — the pool and subprocess layers are platform-agnostic.

**Auth and pairing:** The adapter is enabled when `MCD_CHANNELS_DIR/whatsapp-auth/` exists or `WHATSAPP_ENABLED=1` is set. On first run with no stored session, Baileys generates a QR code which the adapter renders as a PNG and posts to the master Discord channel. The operator scans it; Baileys completes auth and writes multi-file credentials to `whatsapp-auth/` (mode 0600). Subsequent restarts resume from stored credentials without re-pairing.

**Access control:** The sender's E.164 number is checked against the existing `access.allowFrom` list — no separate allowlist.

**ToS caveat:** Baileys is an unofficial WhatsApp Web client not sanctioned by Meta/WhatsApp. Deployment in production or at scale risks number bans; use a dedicated self-hosted account.

### `ClaudeProjectProcess` (`src/claude-process.ts`)

One per project (`Map<chat_id, ClaudeProjectProcess>` lives in the pool). Wraps a single tmux session running `claude --mcp-config <tmpfile> --strict-mcp-config --permission-mode auto [--model M] [--allowed-tools ...] [--disallowed-tools ...] [--resume <session-id>] [<extraArgs>...]`.

Lifecycle:

- `start()` — writes `--mcp-config` to a tmpfile (mode 0600), constructs the spawn env (project's git credential alias resolved into `GIT_ASKPASS` or `GIT_SSH_COMMAND` so `git push`/`gh pr create` work non-interactively), and runs `tmux new-session -d -s mcd-<slug>-<ts> -x 200 -y 50 -c <projectDir> '<cmd>'`. After the call returns the pane is alive but claude is still warming up.
- `deliver(envelope)` — gates on `waitForTuiReady`, then `tmux send-keys -l <text>; sleep 120ms; tmux send-keys C-m`. The text body is wrapped in the upstream `<channel source="discord" chat_id="..." message_id="..." user="..." ts="...">BODY</channel>` envelope so the project's CLAUDE.md guidance applies.
- `getStats()` — resolves the claude PID via `tmux list-panes -F '#{pane_pid}'` then walks `/proc/<pid>/task/<pid>/children` for the first `comm == claude/node`. Reads `/proc/<pid>/{stat,status,uptime}` for cpu time / VmRSS / start time. POSIX-only; returns null on non-Linux. Surfaced via `!project usage`.
- `kill(reason)` — `tmux kill-session -t <name>`. Marks dead, fires exit handlers, and tears down the master MCP session for this chat (the master MCP server's `closeChat` is now a no-op under stateless transport but the call is preserved for symmetry).
- Alive-check timer polls `tmux has-session` every 5s; when the session disappears (claude exited on its own, or systemd / operator killed tmux), the process is marked dead and the next inbound to this chat lazy-respawns it.

### `ProjectPool` (`src/project-pool.ts`)

`Map<chat_id, ClaudeProjectProcess>` plus policy:

- **Lazy spawn** — `deliver()` reuses the cached process if alive, else spawns through the configured factory.
- **`maxConcurrent` cap** — when full, evicts the LRU process to make room. Pool-full evictions fire `kind: "evict", reason: "pool-full"` on the event stream.
- **Idle eviction** — a 30s timer kills processes idle longer than `defaults.idleEvictMinutes`. Idle is measured via each process's `lastActivityMs()` — which only bumps on deliveries and MCP tool calls, never on turn work. That gap killed a healthy session mid-build on 2026-07-25 (long turn, zero MCP calls), so the sweep now consults `transcriptMtimeMs()` (one `statSync` on the session `.jsonl`) before killing: when `transcriptMtime >= idleCutoff` the agent is mid-turn — the kill is vetoed and a `kind: "evict-skip"` event fires with `sinceActivityMs` / `sinceTranscriptMs` instead. Transcript stale, absent, or unresolvable ⇒ evict as before.
- **Stuck watchdog** — the same sweep kills a process whose deliver got no `reply` tool call within the (adaptive, per-project `stuckThresholdMinutes`) threshold, gated on `pendingDeliverAtMs() !== null`. Two vetoes protect legitimate long turns: (1) a fresh `transcriptMtimeMs()` within the threshold ⇒ `kind: "progress-skip"` instead of a kill; (2) end-of-turn detection — `ClaudeProjectProcess`'s transcript watcher parses each `type: "system", subtype: "turn_duration"` record and calls `noteTurnComplete()`, which pushes the duration into `turnHistory` and resets `pendingDeliverAtMs()` to null. A turn that finishes without a reply tool call (e.g. a heartbeat answered "no reply") therefore never leaves the watchdog armed — before this, the flag stayed set forever and produced an hourly kill/respawn loop (observed 2026-07-25).
- **Message-ID dedup** — Discord gateway resumes can replay events; the pool drops duplicate `(chatId, messageId)` arrivals within a 60s TTL window.
- **`acceptReply`** — entry point used by the master MCP server's `reply` callback. Looks up the matching process, calls its internal `acceptReply` to bump activity and fan out, which itself fires the pool's `onReply` (the canonical Discord-dispatch path).
- **`snapshot()`** — used by `!project usage`. Iterates tracked processes and calls each `getStats()` best-effort.

### Orphan session sweep (`src/orphan-sweep.ts`)

The pool's map is in-memory and tmux sessions are detached, so a server restart orphans the whole previous generation of `mcd-<slug>-<ts>` sessions — invisible to idle-evict and the watchdog. At boot, before `client.login()` (and therefore before the pool can spawn anything), `sweepOrphanSessions()` lists tmux sessions and kills every name matching `/^mcd-.+-[a-z0-9]{4,12}$/` — a fresh server owns none, so every match is a leftover. The bare `mcd` server session has no timestamp tail and never matches. Kills are logged to stderr; a summary posts to the master channel on `clientReady` when ≥1 died. tmux errors (no server, no sessions) mean "nothing to sweep", never a boot failure. `defaults.orphanSweep: false` disables it — required if multiple MCD instances share one tmux server. `findOrphanSessions()` is pure and covered by `src/orphan-sweep.test.ts`.

### `SharedLearnings` (`src/shared-learnings.ts`)

Manages `<MCD_CHANNELS_DIR>/shared/learnings.md` — a markdown log shared across all project sessions that have peer access. No database; the file is human-editable and grep-able.

Entry format: `- [<ISO-ts> <slug>] <text> #tag1 #tag2`

```
- [2026-07-16T04:55:00.000Z project-a] tmux send-keys drops Enter pre-TUI #tmux #claude-cli
```

Two exported functions:

- `appendLearning({ slug, text, tags? })` — formats and appends one entry. Rejects entries over 2 KB. Drops oldest lines to keep the file under 64 KB. Atomic write (tmp + rename). Creates the `shared/` directory on first call.
- `readLearnings({ tags?, limit? })` — reads the file, filters by tags (AND semantics), returns entries newest-first up to `limit` (default 20). Returns an empty list when the file is absent.

Tag normalization: strip leading `#`, lowercase, drop empties. Tags in entries are stored with `#` prefix.

This module is intentionally small — no caching, no indexing, no schema. At 64 KB the file fits in memory; single-process serial tool calls mean concurrent-write races don't occur in practice.

### `BotPeerGate` (`src/bot-peers.ts`)

Loop-prevention gate for bot-peer inbound messages (FR3/FR4/NFR1/NFR2). All state is in-memory — a process restart resets counters (documented, acceptable).

```
client.on('messageCreate')
  ├─ msg.author.bot?
  │    └─ handleBotInbound(msg)
  │         ├─ project has botPeers.allow containing author id?   ── no → drop
  │         ├─ channelId === master.chatId?                        ── yes → drop (hard exclusion)
  │         ├─ botPeerGate.check(channelId, limits)
  │         │     ├─ 'drop-cooldown'  → silent drop (stderr log)
  │         │     ├─ 'limit'          → drop; post one-time notice (latched until human resets)
  │         │     └─ 'deliver'        → pool.deliver({...envelope, authorType:'bot'}); recordDelivery()
  │         └─ (skip sendTyping / ackReaction)
  └─ human path (unchanged) ── on project-pool delivery → botPeerGate.recordHuman(channelId)
```

In-memory state: `consecutive: Map<chatId, number>`, `lastDeliveryMs: Map<chatId, number>`, `noticeSent: Set<chatId>`. `recordHuman(chatId)` clears all three for that channel. `check()` is read-only — the caller calls `recordDelivery()` only after a successful `pool.deliver()`.

**Effective limits** resolve as: project `botPeers.{maxConsecutive,cooldownSeconds}` → `defaults.botPeers` → built-in (5 / 30). The `allow` list is always per-project only — no default allowlist.

**Envelope labeling:** When a bot message passes the gate, `InboundEnvelope.authorType` is set to `'bot'` and `formatPrompt` emits `author_type="bot"` in the `<channel>` tag so the session knows it is talking to a machine peer.

### Master command parser (`src/master-commands.ts`)

`handleMasterCommand` takes a content line + a `MasterContext` (chatId, userId, current config, authorizedUsers, optional MasterMutator). It:

1. Returns immediately if no master is configured, the chat isn't master, the message doesn't start with the prefix, or the user isn't authorized.
2. Tokenizes the rest into argv (`splitArgv` — bash-like, no eval).
3. Dispatches to the matching verb handler.

Verbs and their handlers:

| verb | mutates | surface |
|---|---|---|
| `list` | — | `loadConfig().projects` table |
| `show` / `status` | — | config + prompt preview + live `gitStatusSummary()` if the dir is a working tree |
| `create` | `channels.json`, `access.json`, `projects/<slug>/`, optional Discord channel | with `--repo-dir` symlinks to an existing checkout instead of mkdir; with `--new-channel` does a find-or-create on the master's guild |
| `clone` | `channels.json`, `access.json`, `projects/<slug>/.git/...`, optional Discord channel | runs `git clone` with the resolved credential env; rolls back any auto-created channel on failure |
| `set` | `projects/<slug>/CLAUDE.md`; optionally kills running subprocess; `--bot-peers`/`--peers` update `channels.json` | claude re-reads CLAUDE.md on next spawn; `--bot-peers <csv> --yes` / `--bot-peers none`; `--peers <slug,...>` / `--peers none` |
| `rename` | `channels.json`, `projects/<slug>/` directory | kills running subprocess first to avoid pulling cwd out from under it |
| `remote` | `channels.json` git block; optionally `git remote set-url` | view-only when called without `--set` |
| `pull` | working tree | `git pull --ff-only`; refuses on non-FF |
| `usage` / `ps` / `top` | — | calls `pool.snapshot()` and renders a code-block table |
| `stop` | running subprocess only | tells operator subprocess will respawn on next message |
| `schedule add/list/pause/resume/rm` | `schedules.json` | daily HH:MM jobs; fires synthetic envelopes through `pool.deliver` |
| `provider` | `channels.json` projects[].provider | view current routing, `--set ALIAS` to switch, `--clear` to revert; auto-kills the subprocess so the new env takes effect on next message |
| `rm` | `channels.json`, `access.json`, archives `projects/<slug>` to `projects/.archive/<slug>-<ts>/` | requires `--yes`; refuses to remove the master project |
| `help` | — | one-screen reference |

The `MasterMutator` interface is the dependency-injection seam — the parser doesn't know about discord.js or the pool. `server.ts:buildMutator()` wires the live versions; tests substitute mocks.

---

## State files

```
~/.claude/channels/discord-multi/
├── .env                       DISCORD_BOT_TOKEN, mode 0600
├── access.json                allowFrom + groups, mode 0600
├── channels.json              project registry + master pointer + defaults
├── git-credentials.json       credential aliases (mode 0600)
├── schedules.json             daily HH:MM cron-lite, mode 0600
├── inbox/                     downloaded attachments (one file per call)
├── shared/
│   └── learnings.md           cross-project learnings board (created on first share_learning call)
├── whatsapp-auth/             Baileys multi-file auth state (mode 0600); presence enables WhatsApp
└── projects/
    ├── master/
    │   └── CLAUDE.md          deployed from templates/master.CLAUDE.md by setup-new-instance.sh
    ├── <slug>/                per-project working dir (or symlink with --repo-dir)
    │   ├── CLAUDE.md          per-project system prompt
    │   ├── .session-id        last claude session id, for --resume across restarts
    │   └── .git/              when cloned, an actual git working tree
    └── .archive/              soft-deleted projects, suffixed with timestamp
```

`MCD_CHANNELS_DIR` env var overrides the path so multiple bot instances can run side-by-side on the same host (each pointing at its own state dir).

`channels.json` schema highlights:

- `master.chatId` + `master.commandPrefix` (default `!project`)
- `defaults.{model, idleEvictMinutes, maxConcurrent, git.{userName,userEmail,credentials,branchPrefix}, claude.{permissionMode,allowedTools,disallowedTools,extraArgs}, providers.<alias>.{baseUrl,apiKeyEnv}, provider?}`
- `projects[<chat_id>].{slug, model?, git?, claude?, provider?, platform?, whatsappJid?, botPeers?, peers?}` — per-project overrides; `platform` is `'discord' | 'teams' | 'whatsapp'` (default `'discord'`); `whatsappJid` (e.g. `15551234567@s.whatsapp.net`) is required when `platform === 'whatsapp'`; `peers: { allow: slug[], maxHops?, cooldownSeconds? }` enables cross-project dialogue when non-empty and mutual
- `defaults.peers.{maxHops?, cooldownSeconds?}` — limits-only defaults for cross-project dialogue; built-in fallbacks: maxHops 6, cooldownSeconds 15

`git-credentials.json` aliases (mode 0600 enforced by the loader):

```jsonc
{
  "ssh-default": { "type": "ssh-key", "keyPath": "~/.ssh/id_ed25519" },
  "ssh-azure":   { "type": "ssh-key", "keyPath": "~/.ssh/id_rsa_azure" },
  "github-pat":  { "type": "github-pat", "envVar": "GITHUB_TOKEN" },
  "azure-pat":   { "type": "azure-pat",  "envVar": "AZURE_DEVOPS_PAT" }
}
```

`buildGitEnv()` resolves an alias into a `NodeJS.ProcessEnv` block: SSH keys export `GIT_SSH_COMMAND='ssh -i <key> -o IdentitiesOnly=yes'`; PATs install a tmp `GIT_ASKPASS` helper that echoes the token (kept off the command line). The per-project Claude subprocess inherits these vars via `tmux new-session`'s `-c <cwd>` + env spawn, so `git push` and `gh pr create` work non-interactively from inside the agent.

---

## Master CLAUDE.md (the natural-language layer)

The master project's `CLAUDE.md` lives at `~/.claude/channels/discord-multi/projects/master/CLAUDE.md`. It's deployed from [`templates/master.CLAUDE.md`](./templates/master.CLAUDE.md) by [`bin/setup-new-instance.sh`](./bin/setup-new-instance.sh) on first install. The operator is expected to edit it over time — that's their per-host config.

It teaches the master claude:

- The Discord envelope shape and which `reply` tool to use.
- The `run_master_command` tool, with a natural-language → verb table covering every shipped command.
- Failure-handling discipline: surface errors verbatim, never auto-retry with permuted flags.
- The full command reference (same as `!project help`).
- Which credential aliases exist on this host and how to rewrite HTTPS git URLs to SSH.
- Design tips: when to prefer `clone` over `create`, when to confirm before destructive verbs, what to do when the bot is missing a permission.

The template is intentionally generic — operators with different SSH-key paths, different orgs, etc. should edit the live file. The repo template is a starting point.

---

## Operational quirks worth remembering

- **`pkill -f 'bun server.ts'` matches both this bot AND the upstream `claude-channel-discord` plugin's bun process.** Always filter by cwd first: `pgrep -f 'bun' | xargs -I {} sh -c 'cwd=$(readlink /proc/{}/cwd); [[ "$cwd" == */multi-channel-discord ]] && echo {}'` — or just kill by known pid.
- **`--new-channel` is now find-or-create** (case-insensitive name match against the guild cache), so master claude retrying a failed clone doesn't pile up orphans. Pre-existing channels passed by snowflake id are never modified.
- **Failed `clone` / `create` rollback the auto-created channel** but leave operator-created ones alone. `bin/cleanup-orphan-channels.sh` is a manual recovery tool for any old orphans before this fix landed.
- **Master claude is told to STOP and ASK on failure** rather than retry blindly. Earlier the operator hit a 6-channel orphan situation when claude looped through repo-URL permutations.
- **Send-keys requires the TUI ready signal** (`❯` + auto-mode footer) before injection. Two dialogs are auto-dismissed: workspace-trust (Enter) and discovery `New MCP server found in .mcp.json` (`3` + Enter — safe with `--strict-mcp-config`).
- **Stateless HTTP MCP** means there's no server-initiated notification path. We don't need one — send-keys delivers inbound — but vestigial method stubs (`isChatReady`, `waitForChatReady`, `closeChat`, `notifyChat`) are kept as one-line no-ops for callers that hadn't been migrated.

---

## Testing surface

In-process tests live next to source. Run a suite with `bun src/<name>.test.ts`.

- `src/master-commands.test.ts` — argv parser, flag parser, every verb branch, mutator-mock interactions, claudeArgs merging; `--peers` set/clear/validation.
- `src/project-pool.test.ts` — lifecycle (lazy spawn, reuse, unknown-chat rejection, LRU at maxConcurrent, idle eviction with fake clock, shutdown propagation).
- `src/master-mcp-server.test.ts` — listener bind, URL routing, 404 / 405 paths, stop cleanliness; `ask_project` gating (AC1–AC7, AC10), `share_learning`/`read_learnings` tool gating.
- `src/bot-peers.test.ts` — `BotPeerGate`: consecutive counter, notice latch, cooldown (fake clock), human reset, limit-lowered edge case; `effectiveBotPeerLimits` fallback chain.
- `src/shared-learnings.test.ts` — `appendLearning`/`readLearnings`: tag filter, newest-first, limit, 64 KB rotation (oldest dropped), 2 KB entry rejection.

Total: ~110 checks at last count. `bun tsc --noEmit` covers types across the whole project.

---

## See also

- [`README.md`](./README.md) — install + day-to-day operator commands
- [`DESIGN.md`](./DESIGN.md) — original design doc (pre-implementation)
- [`ROADMAP.md`](./ROADMAP.md) — what shipped vs what's planned
- [`templates/master.CLAUDE.md`](./templates/master.CLAUDE.md) — the master prompt template deployed by `setup-new-instance.sh`
