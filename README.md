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

**Monitor channel health** with the heartbeat attention report:

```
!project heartbeat                   — severity-sorted report (🔴 blocked / 🟡 review / 🔵 info)
!project heartbeat --channel <slug>  — scan a single channel
!project heartbeat --quiet           — returns HEARTBEAT_OK when healthy (for scheduled runs)
```

Detects: unanswered questions (🔴), stuck tool calls (🟡), schedule-noop loops (🟡), circuit-open channels (🔴), idle specclaw changes (🔵). Each item shows the channel mention, a one-line summary, and a `↳` suggested action. See [templates/master.CLAUDE.md](./templates/master.CLAUDE.md) for scheduled-run setup.

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

## Cross-project dialogue (optional)

Lets two MCD project Claude sessions exchange messages directly — without operator relay — through constrained, mutual-consent peer links. Builds on the handoff plumbing but adds bidirectional threading, hop budgets, per-pair cooldowns, and a shared learnings board.

**Enable** by adding `peers` to both project entries in `channels.json` (consent must be mutual):

```jsonc
{
  "projects": {
    "<chat_id_A>": {
      "slug": "project-a",
      "peers": {
        "allow": ["project-b"],    // project-a allows project-b to message it
        "maxHops": 6,              // max deliveries per thread (default 6)
        "cooldownSeconds": 15      // min seconds between directed sends (default 15)
      }
    },
    "<chat_id_B>": {
      "slug": "project-b",
      "peers": { "allow": ["project-a"] }   // project-b allows project-a back
    }
  }
}
```

Limits-only defaults (no `allow`) can be set under `defaults.peers` in `channels.json`.

**Manage** the allowlist from the master channel:

```
!project set <slug> --peers <slug,slug,...>   — set/replace peer allow list (slugs must exist)
!project set <slug> --peers none              — remove peers block
```

**MCP tools** available to project sessions with `peers.allow` non-empty:

- `mcp__mcd__ask_project({ target_slug, text, thread_id? })` — send a message to another project. Returns `{ ok, thread_id, hop, max_hops }`. Omit `thread_id` to start a new thread; echo it in subsequent calls to continue.
- `mcp__mcd__share_learning({ text, tags? })` — append a timestamped, slug-attributed entry to the shared learnings board (`shared/learnings.md`).
- `mcp__mcd__read_learnings({ tags?, limit? })` — read from the shared board, newest-first. Optional tag filter (AND semantics) and result limit (default 20).

Master channel also gets `share_learning` / `read_learnings` but not `ask_project`.

**Loop guards:**

- `maxHops` — max deliveries on a single thread. Once reached, the tool returns an error; start a fresh thread to continue.
- `cooldownSeconds` — minimum gap between directed sends (source → target). Violations return an error with the wait remaining.
- Both guards are in-memory (reset on server restart). Restart forgiveness is acceptable and documented.
- The master project is never a valid `ask_project` target. Self-sends are rejected.

**Discord mirror:** On each successful delivery, a preview (first 200 chars) is posted to both channels — `🔁 → <target>: <preview>` and `🔁 from <source>: <preview>` — so the operator has live visibility. Mirror failures are logged and never fail the tool call.

**Shared learnings board:** `<MCD_CHANNELS_DIR>/shared/learnings.md`, one entry per line:

```
- [2026-07-16T04:55:00.000Z project-a] tmux send-keys drops Enter pre-TUI #tmux #claude-cli
```

Entry cap: 2 KB. File cap: 64 KB (oldest entries dropped on overflow). Writes are atomic (tmp + rename); directory created on first write. Any project session (or master) with peer access can read and write the board.

> **Cost caution:** Cross-project loops burn tokens on both sides. The hop budget stops runaway exchanges, but a pair configured with high `maxHops` and short `cooldownSeconds` can still accumulate cost quickly. Monitor with `!project usage`.

---

## Bot-peer dialogue (optional)

Lets an explicitly allowlisted external bot (e.g. Hermes) send messages into a specific project's Claude session, with hard loop-prevention.

**Enable** by adding `botPeers` to the project entry in `channels.json`:

```jsonc
{
  "projects": {
    "<chat_id>": {
      "slug": "my-project",
      "botPeers": {
        "allow": ["123456789012345678"],  // Discord user ids of trusted bots
        "maxConsecutive": 5,              // max bot turns before human reset (default 5)
        "cooldownSeconds": 30             // min seconds between bot deliveries (default 30)
      }
    }
  }
}
```

Limits-only defaults (no `allow`) can be set under `defaults.botPeers` in `channels.json`.

**Manage** from the master channel:

```
!project set <slug> --bot-peers <id,id,...> --yes   — set/replace allowlist (requires --yes)
!project set <slug> --bot-peers none                 — remove botPeers block (no --yes needed)
```

**Limits and semantics:**

- `maxConsecutive` — consecutive bot deliveries since the last human message. On breach, a one-time notice is posted to the channel; further messages are dropped silently until a human sends a message to that channel, which resets the counter and notice latch.
- `cooldownSeconds` — bot messages arriving faster than this are dropped silently (no counter increment, no notice).
- The master channel is always excluded — bot messages to the master are dropped regardless of config.
- Gate state is in-memory; a bot restart resets all counters.

> **Cost caution:** Bot-to-bot loops burn tokens quickly. The consecutive limit stops runaway exchanges, but allowlisting a chatty bot against a project that replies verbosely can still accumulate cost fast. Monitor usage with `!project usage`.

---

## Hermes bridge (optional)

> **⚠️ Security:** Hermes runs with `--yolo` (auto-approved tools) as the same OS user as MCD. Anyone in `access.allowFrom` can execute arbitrary ops on the host through it. Leave disabled unless you need it.

Delegates host-level ops tasks — **including restarting MCD itself** — to a locally installed [hermes-agent](https://github.com/nousresearch/hermes-agent). MCD spawns a detached one-shot `hermes -z "<prompt>"` run that survives MCD's own death; Hermes reports the result back to the master channel using its own Discord credentials (`hermes send`), so the loop closes even while the bot is down.

**1. Enable** in `channels.json`:

```jsonc
"defaults": {
  "hermes": {
    "enabled": true,
    "binPath": "/home/<user>/.local/bin/hermes",  // absolute path recommended
    "yolo": true,                                  // default true; headless runs hang without it
    "extraArgs": []                                // appended verbatim to the hermes argv
  }
}
```

Hermes itself must already be set up on the host (provider auth + Discord gateway credentials for `hermes send` — verify with `hermes send --list`).

**2. Use** from the master channel (or ask master Claude, which calls the `hermes_run` MCP tool):

```
!project hermes "restart the MCD server"          — launch a run (replies with run id + log path)
!project hermes "deploy tax-help-sl" --model MiniMax-M3
!project hermes "..." --no-report                 — skip the Hermes-side report-back
!project hermes --tail <run-id> [--lines 40]      — inspect a run's log
```

Run logs and metadata live under `<MCD_CHANNELS_DIR>/hermes-runs/`.

**Restart-MCD recipe:** `!project hermes "Restart the MCD Discord bot: kill the bun server.ts process whose cwd is */multi-channel-discord, then start it again with MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts inside the mcd tmux session, verify it comes up"` — the wrapped prompt already tells Hermes to wait 5 seconds before destructive steps and to report back via `hermes send` when done.

MCD never kills a Hermes run (it can't own the pid across its own restarts). If a run hangs: `--tail` to inspect, then kill manually — find it with `pgrep -af 'hermes.*-z'`.

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
  hermes-bridge.ts          detached hermes-agent ops runs (!project hermes)
  git-credentials.ts        credential aliases (mode 0600 enforced)
  scheduler.ts              daily HH:MM cron-lite
  shared-learnings.ts       shared learnings board (shared/learnings.md)
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
| 8 | Natural-language master, provider routing, scheduler, session resume, watchdog, heartbeat attention report |

See [ROADMAP.md](./ROADMAP.md) for remaining work.

---

## License

Apache-2.0, inherited from upstream. See [LICENSE](./LICENSE).
