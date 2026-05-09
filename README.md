# multi-channel-discord

Project-aware Discord bot for Claude Code. One Discord bot, **many isolated channels**, each with its own system prompt, conversation history, and (eventually) git working tree + PR workflow.

> Status: **work in progress.** Phases 1–3c are merged on `main` and pass typecheck + all in-tree smoke tests. End-to-end with a live Claude subprocess has not been verified yet — see [Status](#status).

Forked from [`anthropics/claude-plugins-official/external_plugins/discord`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) (Apache-2.0). Backwards-compatible with the upstream behavior when no `channels.json` is present.

📖 **For runtime architecture, debugging notes, and the master CLAUDE.md template, read [`ARCHITECTURE.md`](./ARCHITECTURE.md).**

## What it adds vs upstream

| | upstream | this fork |
|---|---|---|
| Message routing | one Claude session for all messages | per-channel Claude subprocess (lazy spawn, idle eviction, cap) |
| System prompt | global (CLAUDE.md in cwd) | per channel (`projects/<slug>/CLAUDE.md`) |
| History | global | per channel (Claude session resume per-project) |
| Provisioning | manual config | `!project create/clone/...` from a master Discord channel + `/discord:project` skill |
| Git/PR (planned) | — | clone existing repo, branch-and-PR commits via GitHub Octokit / Azure DevOps REST |
| Auth model | uses Claude subscription via Claude Code CLI | same — subscription only, never API key |

## How it works

```
Discord (one bot) ─→ server.ts ─→ ProjectPool ─→ N × claude subprocesses
                          │              │              │
                          │              │              └── HTTP MCP →─┐
                          │              │                              │
                          │              ├── Map<chat_id, process>      │
                          │              └── lazy spawn / idle evict    │
                          │                                              │
                          └── MasterMcpServer ←─────────────────────────┘
                                  └── one in-process http.Server, multiplexed by URL path
                                      `/mcp/<chat_id>`
```

- Each project channel ⇒ one `claude` subprocess running in `projects/<slug>/`.
- The subprocess is given an `--mcp-config` pointing at `http://127.0.0.1:<port>/mcp/<chat_id>` so its tool calls (currently `reply`) are bound to the right Discord channel.
- Inbound Discord messages reach Claude as `notifications/claude/channel` MCP notifications, scoped to the channel's MCP session.
- Outbound replies stream from Claude → master MCP server → pool → Discord, chunked at the upstream 2000-char limit.

Cross-platform: HTTP-on-localhost works identically on Linux, macOS, and Windows. No Unix sockets, no named pipes.

## Status

Phases merged:

| Phase | What | Tests |
|---|---|---|
| 1 | `channels.json` registry, `/discord:project init` skill, file layout | smoke ✓ |
| 2 | Master-channel command parser (`!project list/show/help`) | 20/20 ✓ |
| 3a | ProjectPool lifecycle on a Mock backend | 18/18 ✓ |
| 3b | HTTP MCP server (just `reply` tool) + ClaudeProjectProcess wrapper | 7/7 ✓ |
| 3c | Pool wired into `server.ts`; chunked Discord reply dispatch; clean shutdown | typecheck ✓ |

Not yet:
- Phase 4: mutation verbs (`!project create`, `clone`, `set`, `rm`) — still stubbed
- Phase 5: git layer (clone/init), credential helper, branch/PR workflow
- Phase 6: cross-platform deploy (macOS launchd, Windows service)
- Tools other than `reply` on the master MCP server (`react`, `edit_message`, `download_attachment`, `fetch_messages`)

Live smoke against a real `claude` CLI: not yet performed. The single-session passthrough is **identical to upstream** when `channels.json` doesn't exist, so the fork is safe to run in single-session mode while phase 3c stabilizes.

## Side-by-side install (recommended for first time)

Most operators are already running the upstream `claude-channel-discord` bot. To trial this fork without taking the existing bot offline, **register a second Discord application with its own bot token** and run the new bot in a separate state directory.

```sh
git clone https://github.com/chan4lk/claude-multi-channel-discord ~/dev/multi-channel-discord
cd ~/dev/multi-channel-discord
bun install
```

Then in the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create a new application (e.g. "MultiBot Dev")
2. Bot tab → set username → enable **Message Content Intent**
3. Reset Token, copy it
4. OAuth2 → URL Generator: scope `bot`, permissions `View Channels, Send Messages, Send Messages in Threads, Read Message History, Add Reactions`. Open the URL and invite the new bot to the **same server** as your existing one — it'll appear as a second member.
5. With Discord Developer Mode on, copy your User ID and the Channel ID you want as master (a fresh test channel is safest — your existing bot is still listening on the old channels).

Finally, run the bootstrap helper. Token is read from stdin so it never lands in `argv`:

```sh
bin/setup-new-instance.sh \
  --state-dir ~/.claude/channels/discord-multi \
  --user-id   <your-discord-user-id> \
  --master    <master-channel-id> \
  --slug      master \
  --prompt    "You are the master controller. Be terse." \
  <<< "$DISCORD_BOT_TOKEN"
```

That writes a fresh `.env`, `access.json`, `channels.json`, and `projects/master/CLAUDE.md` under the chosen state dir — completely isolated from your existing bot's `~/.claude/channels/discord/`. Now start the new bot:

```sh
MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts
```

When you're happy, install it as a user systemd service:

```sh
cp systemd/multi-channel-discord.service ~/.config/systemd/user/
# edit to add: Environment=MCD_CHANNELS_DIR=%h/.claude/channels/discord-multi
systemctl --user daemon-reload
systemctl --user enable --now multi-channel-discord
```

The old bot keeps running in `~/.claude/channels/discord/` — no overlap.

> **Windows / shell-less environments:** `bin/setup-new-instance.sh` uses bash. Either run it under Git Bash / WSL, or perform the four file-writes by hand: `.env` (mode 0600), `access.json` (your user ID in `allowFrom`), then `bun src/init.ts ...`.

Once running, in the master Discord channel:

```
!project help
!project list
!project show <slug>
```

Mutation verbs (`create`, `clone`, …) are stubbed — say "phase 4" until those land.

## Repository layout

```
server.ts               main entry point — Discord client + glue
src/
  channels-config.ts    channels.json schema + IO
  git-credentials.ts    git-credentials.json schema + IO
  paths.ts              filesystem layout (lazy getters, MCD_CHANNELS_DIR override)
  init.ts               bootstrap CLI (also called by the skill)
  argv.ts               argv splitter + flag parser
  master-commands.ts    `!project ...` parser + handlers
  master-mcp-server.ts  HTTP MCP server, multiplexed by chat_id URL
  claude-process.ts     ClaudeProjectProcess (real subprocess wrapper)
  project-process.ts    ProjectProcess interface + MockProjectProcess
  project-pool.ts       lazy spawn, LRU eviction, idle eviction, event stream
  discord-chunk.ts      reply chunking at Discord's 2000-char limit
  *.test.ts             in-process smoke tests (`bun src/<name>.test.ts`)
skills/
  access/               upstream — kept
  configure/            upstream — kept
  project/              this fork — terminal-side project management
systemd/                example user-systemd unit (Linux deploy)
bin/
  tmux-runner.sh        optional supervisor for live-attach debugging
DESIGN.md               full design doc
ACCESS.md               upstream — Discord access model
```

## License

Apache-2.0, inherited from upstream. See [LICENSE](./LICENSE).
