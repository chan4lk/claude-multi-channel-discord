# Operator Guide — multi-channel-discord (`bun server.ts`)

This doc is for `openclaw` (or any operator) who needs to understand how the server runs, how to restart it, and how to diagnose problems.

---

## How the server runs

```
bin/restart-server.sh
       │
       └── tmux new-session -s mcd  ──► bun server.ts
                                              │
                               MCD_CHANNELS_DIR=~/.claude/channels/discord-multi
```

- Server runs as `bun server.ts` inside a tmux session named **`mcd`**.
- State directory: `~/.claude/channels/discord-multi/` (override with `MCD_CHANNELS_DIR`).
- Each Discord channel spawns its own Claude subprocess in a separate tmux session named `mcd-<slug>-<timestamp>`.

**To watch live logs:**
```sh
tmux attach -t mcd
# detach: Ctrl-B D
```

---

## Restart

**From outside the bot** (a separate terminal, not a Claude subprocess):

```sh
cd ~/dev/multi-channel-discord
bin/restart-server.sh
```

If you use systemd instead:
```sh
bin/install-service.sh --restart
```

> ⚠️ Never restart from inside a Claude Code session running as a project channel — that kills the subprocess that's running you.

---

## Key files

| Path | Purpose |
|------|---------|
| `server.ts` | Entry point — Discord client, MCP server, ProjectPool glue |
| `src/project-pool.ts` | Lazy-spawn + LRU eviction of Claude subprocesses |
| `src/claude-process.ts` | Wraps one tmux+claude subprocess per channel |
| `src/master-mcp-server.ts` | HTTP MCP server Claude calls to reply to Discord |
| `src/master-commands.ts` | `!project ...` command parser |
| `~/.claude/channels/discord-multi/channels.json` | Project registry (slugs, models, voice config, etc.) |
| `~/.claude/channels/discord-multi/.env` | `DISCORD_BOT_TOKEN` (mode 0600) |
| `~/.claude/channels/discord-multi/projects/<slug>/` | Per-channel working tree |
| `~/.claude/channels/discord-multi/projects/<slug>/.session-id` | Claude session UUID for `--resume` |

---

## Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `MCD_CHANNELS_DIR` | `~/.claude/channels/discord-multi` | State directory |
| `MCD_TMUX_SESSION` | `mcd` | Tmux session name for the server |
| `MCD_REPO_DIR` | auto-detected from script path | Repo root |
| `BUN_BIN` | auto-detected | Path to `bun` binary |

---

## Common problems and fixes

### Bot not responding to messages

1. Check server is running: `tmux has-session -t mcd && echo running || echo dead`
2. If dead: `bin/restart-server.sh`
3. If running, check logs: `tmux attach -t mcd` — look for error lines

### `/voice join` slash command missing

Slash commands register on startup. After a code update:
```sh
bin/restart-server.sh
```
Guild-scoped commands appear instantly (as of the latest code). Global commands take up to 1 hour.

### Claude subprocess stuck / not replying

The stuck-watchdog fires after 5 minutes of no reply + no transcript writes. It kills and respawns on the next message.

To manually kill a stuck channel subprocess:
```sh
# Find the tmux session for slug "myproject"
tmux ls | grep mcd-myproject
tmux kill-session -t mcd-myproject-<timestamp>
```
Next message to that channel auto-respawns Claude.

### Session not resuming (Claude lost conversation history)

Each channel stores its session UUID in `projects/<slug>/.session-id`. If missing or stale, Claude starts fresh.

Check:
```sh
cat ~/.claude/channels/discord-multi/projects/<slug>/.session-id
```

If the file is missing, Claude will create a new session on next spawn (no history). This is safe — history isn't lost in Claude's backend, only the resume pointer is missing.

### "channel not allowlisted" error from Claude

Claude picked up the upstream `discord` plugin instead of the `mcd` plugin. This should not happen with `--strict-mcp-config` — but if it does, check the `.mcp.json` in the project dir:
```sh
cat ~/.claude/channels/discord-multi/projects/<slug>/.mcp.json
```
The server name must be `mcd`, not `discord`. If wrong, stop the pool entry and let it respawn.

### Bot posts duplicate messages

Message dedup is keyed on Discord message ID in `project-pool.ts`. Duplicates happen if the same message ID hits the pool twice (Discord retry). Check for `dedup` log lines in the server output.

### Voice not working

1. Check `channels.json` has `voice.enabled: true` for the project.
2. Check `MCD_WHISPER_MODEL` env var points to a valid faster-whisper model path.
3. Check Python subprocess for faster-whisper is available: `python3 -c "import faster_whisper"`
4. Join a voice channel first, then `/voice join` in the text channel.

---

## Checking what's running

```sh
# Server process
tmux ls | grep '^mcd:'

# All channel subprocesses
tmux ls | grep '^mcd-'

# Active projects
cat ~/.claude/channels/discord-multi/channels.json | python3 -m json.tool | grep slug
```

---

## Safe restart sequence (full)

1. `tmux attach -t mcd` — check for any in-flight activity, detach when clear
2. `bin/restart-server.sh` — kills `mcd` session, starts fresh
3. `tmux attach -t mcd` — confirm gateway reconnected ("gateway connected as …")
4. Test with a message in a project channel

---

## What NOT to do

- Don't run `pkill -f 'bun server.ts'` — matches both this bot and the upstream bot if both run on the same machine.
- Don't kill the `mcd` tmux session from inside a Claude project subprocess — that kills your own session.
- Don't edit `channels.json` while the server is running — use `!project set` commands instead (they write atomically).
