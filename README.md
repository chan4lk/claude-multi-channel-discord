# multi-channel-discord

Project-aware Discord bot for Claude Code. One Discord bot, **many isolated channels** — each channel gets its own Claude Code subprocess, system prompt, conversation history, and git working tree.

Forked from [`anthropics/claude-plugins-official/external_plugins/discord`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) (Apache-2.0). Backwards-compatible with upstream when no `channels.json` is present.

---

## What it adds vs upstream

| | upstream | this fork |
|---|---|---|
| Message routing | one Claude session for all messages | per-channel Claude subprocess (lazy spawn, idle eviction) |
| System prompt | global (`CLAUDE.md` in cwd) | per channel (`projects/<slug>/CLAUDE.md`) |
| Conversation history | global | per channel (`--resume` across restarts) |
| Provisioning | manual config | `!project create/clone/...` from a master Discord channel |
| Git integration | — | clone repos, push branches, open PRs via Octokit / Azure DevOps REST |
| Provider routing | Claude subscription only | per-project routing to any Anthropic-compatible API (MiniMax, Bedrock, etc.) |
| Auth | Claude Code subscription | same — never API key |

---

## How it works

```
Discord (one bot) ─→ server.ts ─→ ProjectPool ─→ N × claude subprocesses
                          │              │              │
                          │              │              └── HTTP MCP →─┐
                          │              ├── Map<chat_id, process>      │
                          │              └── lazy spawn / idle evict    │
                          └── MasterMcpServer ←─────────────────────────┘
                                  └── one HTTP server, multiplexed by /mcp/<chat_id>
```

- Each project channel → one `claude` subprocess inside a detached tmux session.
- **Inbound:** Discord messages injected via `tmux send-keys` (keeps the warm interactive session).
- **Outbound:** Claude calls `mcp__mcd__reply` against the HTTP MCP server → Discord, chunked at 2000 chars.
- Cross-platform: HTTP-on-localhost works identically on Linux, macOS, and Windows.

---

## Quick start

### One-liner install (Linux / macOS)

```sh
curl -fsSL https://raw.githubusercontent.com/chan4lk/claude-multi-channel-discord/main/bin/install.sh | bash
```

Or via npx (requires Node.js):

```sh
npx mcd-setup
```

Windows (PowerShell 7+):

```powershell
irm https://raw.githubusercontent.com/chan4lk/claude-multi-channel-discord/main/bin/install.ps1 | iex
```

The installer detects your OS, installs bun + tmux, clones the repo, runs the interactive setup wizard, and registers a system service.

---

**1. Prerequisites:** `bun`, `claude` CLI (logged in), `tmux`, `git`. Optionally `gh` for PR workflows.

```sh
bin/check-env.sh   # verify everything is installed
```

**2. Clone and install:**

```sh
git clone https://github.com/chan4lk/claude-multi-channel-discord ~/dev/multi-channel-discord
cd ~/dev/multi-channel-discord
bun install
```

**3. Create a Discord bot** at [discord.com/developers/applications](https://discord.com/developers/applications):
- Enable **Message Content Intent** in the Bot tab.
- OAuth2 → URL Generator: scope `bot`, permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History, Add Reactions, Manage Channels.
- Invite the bot to your server. Copy your **User ID** and the **master channel ID** (requires Developer Mode).

**4. Bootstrap:**

```sh
bin/setup-new-instance.sh \
  --state-dir ~/.claude/channels/discord-multi \
  --user-id   <your-discord-user-id> \
  --master    <master-channel-id> \
  --slug      master \
  --prompt    "You are the master controller. Be terse." \
  <<< "$DISCORD_BOT_TOKEN"
```

**5. Run:**

```sh
MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts
```

In the master Discord channel:

```
!project help
!project list
```

**6. Create your first project channel** (from the master channel):

```
!project create --new-channel my-project --slug my-project --prompt "You are a helpful coding assistant."
```

Or clone a repo into a channel:

```
!project clone --new-channel my-repo --slug my-repo --repo https://github.com/owner/repo.git --creds github-pat --prompt "You work in the my-repo repository."
```

---

## WhatsApp setup (optional)

> **⚠️ Unofficial client — ToS risk:** WhatsApp support is powered by **Baileys**, an unofficial WhatsApp Web library. Use violates WhatsApp's Terms of Service and can result in your number being permanently banned. Only use with a personal or dedicated self-hosted account.

**1. Enable:** Create the auth directory before starting the server:

```sh
mkdir -p ~/.claude/channels/discord-multi/whatsapp-auth
chmod 700 ~/.claude/channels/discord-multi/whatsapp-auth
```

Or set `WHATSAPP_ENABLED=1` in your environment. Either way, the adapter activates on the next server start.

**2. Pair:** On first run the bot posts a QR code image to your master Discord channel. Open WhatsApp on your phone → Linked Devices → Link a Device, and scan the QR within 60 seconds. The session is then saved to `whatsapp-auth/` and persists across restarts.

**3. Bind a project:** In `channels.json`, set `platform` and `whatsappJid` on the project entry:

```jsonc
{
  "projects": {
    "<chat_id>": {
      "slug": "my-whatsapp-project",
      "platform": "whatsapp",
      "whatsappJid": "15551234567@s.whatsapp.net"
    }
  }
}
```

`whatsappJid` is the contact's phone number in E.164 format with the `@s.whatsapp.net` suffix. Once set, messages from that contact route to the project's Claude subprocess and replies go back over WhatsApp.

Access control reuses `access.allowFrom` — the sender's E.164 number must be in the allowlist. Inbound media surfaces as attachment summaries; files are not downloaded.

---

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/setup.md](./docs/setup.md) | Complete setup walkthrough — prerequisites, Discord app, bootstrap, system service, troubleshooting |
| [docs/project-channels.md](./docs/project-channels.md) | Creating, cloning, managing, and scheduling project channels |
| [docs/git-credentials.md](./docs/git-credentials.md) | Configuring git credentials (GitHub PAT, Azure PAT, SSH keys) and provider API keys |
| [docs/commands.md](./docs/commands.md) | Full `!project` command reference |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Runtime architecture, design decisions, per-component contracts |
| [DESIGN.md](./DESIGN.md) | Original design doc |
| [ROADMAP.md](./ROADMAP.md) | Phase history and remaining work |

---

## Repository layout

```
server.ts                   main entry point
src/
  channels-config.ts        channels.json schema + IO
  paths.ts                  filesystem layout (MCD_CHANNELS_DIR override)
  init.ts                   bootstrap CLI
  argv.ts                   bash-like argv splitter
  master-commands.ts        !project parser + verb handlers
  master-mcp-server.ts      HTTP MCP server, multiplexed by chat_id
  claude-process.ts         ClaudeProjectProcess (tmux/claude subprocess wrapper)
  project-process.ts        ProjectProcess interface + MockProjectProcess
  project-pool.ts           lazy spawn, LRU eviction, idle eviction, dedup
  discord-chunk.ts          2000-char reply chunker
  git-ops.ts                buildGitEnv, gitStatusSummary, gitPull
  git-credentials.ts        credential aliases (mode 0600 enforced)
  scheduler.ts              daily HH:MM cron-lite
  *.test.ts                 in-process smoke tests (bun src/<name>.test.ts)
docs/                       setup and operator guides
skills/                     Claude Code terminal skills
systemd/                    service files (Linux systemd, macOS launchd, Windows PS1)
bin/
  setup-new-instance.sh     bootstrap helper
  check-env.sh              install verification
  cleanup-orphan-channels.sh  manual recovery for stale Discord channels
  tmux-runner.sh            optional supervisor for live-attach debugging
templates/
  master.CLAUDE.md          master channel system prompt template
```

---

## Status

All phases complete and running in production (as of 2026-05-16).

| Phase | What |
|-------|------|
| 1 | `channels.json` registry, `/discord:project init` skill |
| 2 | Master-channel command parser |
| 3a–3e | ProjectPool, HTTP MCP, tmux+send-keys, stateless transport, TUI gate |
| 4 | Mutation verbs (`create`, `clone`, `set`, `rename`, `rm`) |
| 4.5 | `--new-channel` find-or-create, rollback on failure |
| 5 | Git layer: credential helper, `git clone`, `buildGitEnv` |
| 5.5 | `--repo-dir` symlink mode for existing local repos |
| 6 | Cross-platform deploy (systemd, launchd, Windows PS1) |
| 7 | Full MCP tool surface (`react`, `edit_message`, `download_attachment`, `fetch_messages`) |
| 8 | Natural-language master, provider routing, scheduler, session resume, watchdog |

See [ROADMAP.md](./ROADMAP.md) for remaining work.

---

## License

Apache-2.0, inherited from upstream. See [LICENSE](./LICENSE).
