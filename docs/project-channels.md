# Project Channels

How to create and manage per-channel Claude agents from the master Discord channel.

All commands below are typed in the **master Discord channel** by an authorized user.

---

## Create a channel (no git)

Creates a Discord channel and registers it as a project. The agent runs in an empty directory — good for chat-only assistants.

```
!project create --new-channel <name> --slug <slug> --prompt "<system prompt>"
```

Or use an existing Discord channel by ID:

```
!project create <channel-id> --slug <slug> --prompt "<system prompt>"
```

Options:
- `--model haiku` — override the default model for this channel
- `--parent <category-id>` — place the new channel under a Discord category

---

## Clone a repo into a channel

Creates a channel whose agent works inside a real git checkout. The agent can read/edit files, commit, push, and open PRs.

```
!project clone --new-channel <name> --slug <slug> --repo <git-url> --creds <alias> --prompt "<prompt>"
```

Options:
- `--branch <name>` — base branch (default: repo default branch)
- `--creds <alias>` — credential alias from `git-credentials.json` (see [git-credentials.md](./git-credentials.md))
- `--new-channel <name>` — create the Discord channel; or pass an existing `<channel-id>` as the first positional arg

The clone runs `git clone <url>` into `projects/<slug>/` using the resolved credential env. On each agent spawn, the agent is told to `git pull --ff-only` before making changes.

---

## Attach an existing local repo

If you already have a checkout on the same machine, symlink it instead of cloning:

```
!project create <channel-id> --slug <slug> --repo-dir /path/to/existing/repo --prompt "<prompt>"
```

`projects/<slug>` becomes a symlink to the real repo. The agent's cwd is the real repo path so edits and git commands work directly.

---

## Inspect a channel

```
!project list                  # all registered channels
!project show <slug>           # config + prompt preview + git status
!project usage                 # live resource snapshot (pid, memory, cpu, uptime) for all running agents
```

---

## Edit a channel's system prompt

```
!project set <slug> --prompt "<new system prompt>"
```

The running agent is killed so it picks up the new CLAUDE.md on next spawn.

---

## Stop / restart an agent

```
!project stop <slug>
```

Kills the tmux session. The agent lazy-respawns on the next incoming message. Use this when an agent is stuck or you want to force a fresh session.

---

## Remove a channel

```
!project rm <slug> --yes
```

- Archives `projects/<slug>/` → `projects/.archive/<slug>-<timestamp>/` (not deleted).
- Removes the entry from `channels.json` and `access.json`.
- Cannot remove the master project.

---

## Rename a channel

```
!project rename <slug> --slug <new-slug>
```

Kills the running agent first (to avoid pulling cwd from under it), renames the directory, and updates `channels.json`.

---

## Git operations on a channel

```
!project pull <slug>          # git pull --ff-only on the base branch
!project remote <slug>        # view current remote URL + creds alias
!project remote <slug> --set <url> --creds <alias>   # change remote
```

---

## Switch AI provider

By default all channels use the operator's Claude Code subscription. To route a channel to a different Anthropic-compatible API (e.g. MiniMax):

```
!project provider <slug> --set <alias>    # alias from defaults.providers in channels.json
!project provider <slug> --clear          # revert to subscription auth
!project provider <slug>                  # show current routing
```

The running agent is killed automatically; next spawn uses the new env.

See [git-credentials.md](./git-credentials.md) for provider config.

---

## Scheduled messages

Send a synthetic message to a project channel on a daily schedule:

```
!project schedule add <slug> --time 09:00 --message "Morning standup: what did you finish yesterday, what's today's plan?"
!project schedule list
!project schedule pause <id>
!project schedule resume <id>
!project schedule rm <id>
```

Times are in the host machine's local timezone. The scheduler fires within ~60s of the scheduled time and deduplicates across bot restarts (won't re-fire if the bot restarts after the scheduled time on the same day).

---

## Natural language commands (master Claude)

The master channel's Claude agent understands plain English and can execute commands on your behalf. Instead of typing exact syntax, you can say:

> "Clone the agent-nexus repo at github.com/chan4lk/agent-nexus into a new channel called agent-nexus, use the github-pat credential"

The master Claude translates this to `!project clone ...` and runs it via its `run_master_command` tool. You still see the exact command and output in the channel.

---

## Tips

- **Slug** must match `^[a-z][a-z0-9_-]{0,30}$` and be unique across all projects.
- **`--new-channel` is find-or-create** — retrying a failed `clone` won't create duplicate channels.
- **Symlinked channels** (from `--repo-dir`) are fully supported including session resume and watchdog.
- **Idle eviction** — agents not receiving messages for `defaults.idleEvictMinutes` (default 15) are killed to reclaim memory. They respawn on next message. Override per-project in `channels.json`.
