# Setup Guide

Step-by-step from zero to a running multi-channel-discord bot.

---

## Prerequisites

You need these tools installed on the host machine before starting:

| Tool | Why | Install |
|------|-----|---------|
| **bun** ≥ 1.1 | Runs the bot | https://bun.sh |
| **claude CLI** | Per-channel agents | `npm i -g @anthropic-ai/claude-code` — must be logged in with `claude` |
| **tmux** | Keeps each agent alive in a PTY | `apt install tmux` / `brew install tmux` |
| **git** | Used by agents inside project channels | Usually pre-installed |
| **gh** (optional) | Agents can open PRs via `gh pr create` | https://cli.github.com |

Verify the lot with:

```sh
bin/check-env.sh
```

---

## Step 1 — Create a Discord application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it (e.g. `MyBot`). In the **Bot** tab:
   - Set a username.
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**.
   - Click **Reset Token**, copy the token — you'll need it in Step 3.
3. In **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `View Channels`, `Send Messages`, `Send Messages in Threads`, `Read Message History`, `Add Reactions`, `Manage Channels` (needed for `!project create --new-channel`)
4. Open the generated URL and invite the bot to your Discord server.

> **Get your IDs with Discord Developer Mode:** Settings → Advanced → Developer Mode → ON.
> Then right-click your user → **Copy User ID**, and right-click the channel you'll use as the master command channel → **Copy Channel ID**.

---

## Step 2 — Clone the repo

```sh
git clone https://github.com/chan4lk/claude-multi-channel-discord ~/dev/multi-channel-discord
cd ~/dev/multi-channel-discord
bun install
```

---

## Step 3 — Bootstrap the state directory

The bootstrap script writes all config files into a state directory (default `~/.claude/channels/discord-multi`). It never touches any upstream discord-plugin state.

The bot token is read from stdin — it never touches `argv` or shell history.

```sh
bin/setup-new-instance.sh \
  --state-dir ~/.claude/channels/discord-multi \
  --user-id   <your-discord-user-id> \
  --master    <master-channel-id> \
  --slug      master \
  --prompt    "You are the master controller. Be terse." \
  <<< "paste-your-token-here"
```

Or pipe from an env var:

```sh
echo "$DISCORD_BOT_TOKEN" | bin/setup-new-instance.sh \
  --state-dir ~/.claude/channels/discord-multi \
  --user-id   797184740293476362 \
  --master    1234567890123456789 \
  --slug      master \
  --prompt    "You are the master controller. Be terse."
```

This creates:

```
~/.claude/channels/discord-multi/
├── .env                  DISCORD_BOT_TOKEN (mode 0600)
├── access.json           only your user ID allowed (mode 0600)
├── channels.json         project registry, master pointer
└── projects/master/
    └── CLAUDE.md         master channel system prompt
```

---

## Step 4 — Start the bot

```sh
MCD_CHANNELS_DIR=~/.claude/channels/discord-multi bun server.ts
```

In your master Discord channel, type:

```
!project help
!project list
```

If both work, the bot is up. Leave it running and continue to Step 5.

---

## Step 5 — Verify the install

```sh
bin/check-env.sh
```

Checks: tools on PATH, state-dir layout, bot process + MCP port, tokens, git credentials, active tmux sessions. Exits 0 when all green.

---

## Step 6 — Run as a system service (optional but recommended)

### Linux (systemd user service)

```sh
cp systemd/multi-channel-discord.service ~/.config/systemd/user/
```

Edit the file and add your state dir:

```ini
[Service]
Environment=MCD_CHANNELS_DIR=%h/.claude/channels/discord-multi
```

Then enable:

```sh
systemctl --user daemon-reload
systemctl --user enable --now multi-channel-discord
systemctl --user status multi-channel-discord
```

Logs: `journalctl --user -u multi-channel-discord -f`

### macOS (launchd)

```sh
cp systemd/com.bistec.multi-channel-discord.plist ~/Library/LaunchAgents/
# Edit the plist to set your MCD_CHANNELS_DIR and repo path
launchctl load ~/Library/LaunchAgents/com.bistec.multi-channel-discord.plist
```

### Windows

Run `bin/Install-McdService.ps1` in PowerShell (as Administrator). Requires WSL or Git Bash for tmux — the bot won't function without tmux on Windows.

---

## Step 7 — Create your first project channel

Once the bot is running, from your **master Discord channel**:

```
!project create --new-channel my-project --slug my-project --prompt "You are a helpful coding assistant working in the my-project repo."
```

This creates a new Discord channel called `my-project` and registers it as a project. The next message sent to that channel will lazy-spawn a `claude` subprocess for it.

To attach to an existing git repo instead:

```
!project clone --new-channel my-repo --slug my-repo --repo https://github.com/owner/repo.git --creds github-pat --prompt "You work in the my-repo repository."
```

See [project-channels.md](./project-channels.md) for more detail on managing channels.

---

## Troubleshooting

**Bot doesn't respond in master channel**
- Check `!project help` — if no reply, the bot may not be connected to the gateway.
- Run `bin/check-env.sh` and look for failures.
- Check `journalctl --user -u multi-channel-discord -f` (or tmux window output if running manually).

**`tmux: command not found` in logs**
- Install tmux: `apt install tmux` or `brew install tmux`.
- Restart the bot after installing.

**"Detected a custom API key" dialog blocks a project channel**
- The TUI readiness gate auto-dismisses this. If it doesn't, kill the session with `!project stop <slug>` — it will respawn cleanly on the next message.

**Project channel stops responding**
- The agent's tmux session may have exited. Send any message to it — lazy-spawn will restart claude.
- Or check with `!project usage` in the master channel to see which sessions are alive.

**`--new-channel` fails with missing permissions**
- Re-do the OAuth2 URL Generator step and add `Manage Channels` permission, then re-invite the bot (just open the URL — it adds the permission without removing the bot from the server).

---

## Next steps

- [project-channels.md](./project-channels.md) — creating, cloning, and managing project channels
- [git-credentials.md](./git-credentials.md) — setting up git credentials for clone + push
- [commands.md](./commands.md) — full `!project` command reference
- [ARCHITECTURE.md](../ARCHITECTURE.md) — how the bot works under the hood
