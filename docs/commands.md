# Command Reference

Full reference for `!project` commands typed in the master Discord channel.

All commands require the sender to be in `access.allowFrom`. The master channel is configured during bootstrap.

---

## Informational

### `!project help`
Prints a one-screen command reference in the master channel.

### `!project list`
Lists all registered project channels: slug, channel ID, model, provider, git remote (if any).

### `!project show <slug>`
Shows the full config for one project: channel ID, model, provider, git block, claude flags, current system prompt preview, live git status (if the project is a working tree).

### `!project usage` / `!project ps` / `!project top`
Snapshot of all currently running agent processes: PID, memory (RSS), CPU time, uptime, last activity timestamp. Reads from `/proc` — Linux only.

---

## Lifecycle

### `!project create`

```
!project create <channel-id> --slug <slug> --prompt "<prompt>" [options]
!project create --new-channel <name> --slug <slug> --prompt "<prompt>" [options]
```

Options:
| Flag | Description |
|------|-------------|
| `--model <name>` | Override default model for this channel (e.g. `haiku`, `opus`) |
| `--new-channel <name>` | Create a new Discord channel (find-or-create by name) |
| `--parent <category-id>` | Parent category for `--new-channel` |
| `--repo-dir <path>` | Symlink `projects/<slug>` → existing local checkout instead of mkdir |
| `--keep-existing-claudemd` | Don't overwrite CLAUDE.md if already present in `--repo-dir` |

### `!project clone`

```
!project clone <channel-id> --slug <slug> --repo <url> [options]
!project clone --new-channel <name> --slug <slug> --repo <url> [options]
```

Options:
| Flag | Description |
|------|-------------|
| `--branch <name>` | Base branch (defaults to repo default) |
| `--creds <alias>` | Credential alias from `git-credentials.json` |
| `--model <name>` | Override default model |
| `--new-channel <name>` | Create a new Discord channel (find-or-create) |
| `--parent <category-id>` | Parent category for `--new-channel` |
| `--prompt "<text>"` | Initial system prompt written to `projects/<slug>/CLAUDE.md` |

Rollback: if the clone or channel-creation fails partway through, any auto-created Discord channel is deleted. Pre-existing channels passed by ID are never touched.

### `!project set <slug> --prompt "<text>"`

Rewrites `projects/<slug>/CLAUDE.md` and kills the running subprocess so it picks up the new prompt on next message.

### `!project rename <slug> --slug <new-slug>`

Kills the running subprocess, renames the `projects/<slug>/` directory, and updates `channels.json`.

### `!project stop <slug>`

Kills the agent's tmux session. The agent lazy-respawns on the next incoming message to that channel.

### `!project rm <slug> --yes`

Archives `projects/<slug>/` to `projects/.archive/<slug>-<timestamp>/`, removes the entry from `channels.json` and `access.json`. Cannot remove the master project.

---

## Git

### `!project pull <slug>`

Runs `git pull --ff-only` on the base branch. Use this when the remote has diverged and the agent is refusing to commit.

### `!project remote <slug>`

Shows current remote URL and credential alias.

### `!project remote <slug> --set <url> --creds <alias>`

Updates the remote URL and/or credential alias. Kills the agent so the new git env takes effect on next spawn.

---

## Scheduling

### `!project schedule add <slug> --time HH:MM --message "<text>"`

Registers a daily job that injects `<text>` into the project channel at `HH:MM` (host local time). The agent responds as if a user typed the message.

### `!project schedule list`

Lists all schedules: ID, slug, time, last run, status.

### `!project schedule pause <id>` / `!project schedule resume <id>`

Pause or resume a schedule without deleting it.

### `!project schedule rm <id>`

Deletes a schedule.

---

## Provider routing

### `!project provider <slug>`

Shows current provider routing for the channel (subscription auth or API alias).

### `!project provider <slug> --set <alias>`

Routes the channel to the named provider alias (defined in `defaults.providers` in `channels.json`). Kills the agent so the new env takes effect.

### `!project provider <slug> --clear`

Reverts to Claude Code subscription auth.

---

## Natural language

The master channel's Claude agent can execute commands from plain-English instructions. Examples:

> "Clone the foo-api repo at github.com/org/foo-api into a channel called foo-api, use github-pat"

> "Stop the academy-videos agent — it seems stuck"

> "Show me what's running"

The agent runs the corresponding `!project ...` verb via its `run_master_command` tool and reports back. You see the exact command and output in the channel.

---

## Authorization

All `!project` commands require the sender's user ID to be in `access.allowFrom` in `access.json`. Destructive verbs (`rm`, `rename`, `remote --set`) additionally require `--yes`. The master channel itself is always in scope — no further channel allowlisting needed for the operator.
