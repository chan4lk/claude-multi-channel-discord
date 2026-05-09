# Roadmap

Tracks what's done and what's planned. See [DESIGN.md](./DESIGN.md) for the original architecture.

---

## Done (phases 1–4 + side-by-side install)

| Phase | Commit | Summary |
|---|---|---|
| 1 | `8240b68` | `channels.json` registry, zod schema, atomic writes; `/discord:project init` skill |
| 2 | `0c32bab` | Master-channel command parser (`!project list/show/help`); systemd unit + tmux runner scaffolding |
| 3a | `c2451ff` | `ProjectPool` lifecycle on a mock backend (lazy spawn, LRU evict, idle evict, event stream) |
| 3b | `dc77642` | HTTP MCP server scaffold + `ClaudeProjectProcess` wrapper |
| 3c | `5257745` | Pool wired into `server.ts`; chunked Discord reply dispatch |
| —  | `9f0ebc4` | Per-project Claude CLI flags (`permissionMode`, `allowedTools`, `extraArgs`) |
| 4 | `517e719` | Mutation verbs (`!project create/set/rename/rm`) with `MasterMutator` interface |
| —  | `988b23d` | Side-by-side install: `MCD_CHANNELS_DIR` + `bin/setup-new-instance.sh` |
| —  | `70268f7` | Standalone-mode shutdown fix (skip stdio MCP transport when daemon-launched) |
| —  | `47bceb6` | MCP config key fix (`type: "http"` not `transport`); legacy fallthrough hardened |
| 3d | `fe1fb58` | tmux + send-keys for inbound delivery (interactive claude in PTY) |
| 3e | `a927358` | Stateless HTTP MCP + `--strict-mcp-config` + tmux readiness gate (`mcd` server name avoids upstream collision) |
| —  | `8872387` | `!project create/rm` syncs `access.json` groups |

Net: end-to-end working in single-user mode. Master channel commands work; project channels can be created from master, the per-channel Claude responds via `mcp__mcd__reply` driven by the user's Claude subscription, no API key.

---

## Planned (and now also done)

> **Update:** phases 4.5, 5, 5.5, 6, and 7 are merged. Remaining work is phase 8 (multi-user polish) and the smaller follow-ups at the bottom.

### Phase 4.5 — auto-create the Discord channel from `!project create` ✅

Today `!project create` requires an existing channel ID. New flag:

```
!project create --new-channel NAME --slug X --prompt "..." [--parent CATEGORY_ID]
```

Implementation sketch:

- In `handleCreate` (`src/master-commands.ts`), branch on flags: `--new-channel <name>` vs positional `<chat_id>`.
- `--new-channel` path: `discord.js` `guild.channels.create({ name, type: ChannelType.GuildText, parent })` against the master channel's guild. Use the returned `channel.id` for the existing flow.
- Bot needs the `Manage Channels` permission. Document it: re-tick `Manage Channels` in OAuth2 URL Generator, open the regenerated URL, "Authorize" — adds the perm to the existing bot role without re-inviting.
- Error path: `MissingPermissions` → reply with the exact docs link + the OAuth invite step.

Estimated diff: ~80 lines including help text + tests.

### Phase 5 — Git layer ✅

The motivating use case: a project channel maps to a git working tree, so chat-driven edits commit to a per-task branch and open a PR.

Verbs:

```
!project create <chat_id-or--new-channel> --slug X --prompt "..." --new-repo PROVIDER:OWNER/NAME --creds C
!project clone  <chat_id-or--new-channel> --slug X --repo URL [--branch BR] [--creds C] [--prompt "..."]
!project remote <chat_id-or-slug> [--set URL] [--creds C]
!project pull   <chat_id-or-slug>
!project status <chat_id-or-slug>     # extends current show with git status / ahead-behind / open PRs
```

`git-credentials.json` aliases (mode 0600):

```jsonc
{
  "github-default": { "type": "github-pat",  "envVar": "GITHUB_TOKEN" },
  "azure-default":  { "type": "azure-pat",   "envVar": "AZURE_DEVOPS_PAT" },
  "ssh-personal":   { "type": "ssh-key",     "keyPath": "~/.ssh/id_ed25519" }
}
```

Each ClaudeProjectProcess spawn gets the right env (PAT via `GIT_ASKPASS` helper, never URL-embedded; SSH via `GIT_SSH_COMMAND`). On every spawn: `git pull --ff-only` first; non-FF refuses commits/pushes until `!project pull` resolves.

Push/PR flow (option **(b)** from the original design call):

1. Claude (via chat) creates branch `<branchPrefix><slug>/<ts>-<short>`.
2. Stages, commits with `user.name`/`user.email` from `defaults.git`.
3. `git push -u origin <branch>` using credential helper.
4. Opens PR via Octokit (`pulls.create`) or Azure DevOps REST.
5. Reply chunk in Discord channel includes the PR URL.

### Phase 5.5 — `--cwd` / `--repo-dir` for existing repos ✅

Currently `!project create` always `mkdir`s `projects/<slug>/`. To attach a project channel to an existing local checkout (like this very repo on dev boxes), allow:

```
!project create <chat_id> --slug X --repo-dir /home/openclaw/dev/multi-channel-discord --prompt "..."
```

Implementation: instead of mkdir + write CLAUDE.md, symlink `projects/<slug>` → `<repo-dir>` and write CLAUDE.md INTO the repo (or skip if one already exists with `--keep-existing-claudemd`). The Claude subprocess's `cwd` becomes the real repo, so file edits and git commands work directly.

### Phase 6 — Cross-platform deploy ✅

Add to `systemd/`:

- `multi-channel-discord.plist` — macOS launchd
- `Install-McdService.ps1` — Windows scheduled task / `nssm` wrapper

Document `tmux` dependency clearly: required on Linux/macOS, requires WSL or future node-pty fallback on Windows.

### Phase 7 — Tool surface parity with upstream ✅

Master MCP server currently ships only `reply`. Port the rest from upstream `server.ts`:

- `react(message_id, emoji)` — sets reaction on inbound msg
- `edit_message(message_id, text)` — for streaming partial replies
- `download_attachment(chat_id, message_id)` — fetches inbound files
- `fetch_messages(chat_id, before?, limit?)` — Discord history pagination

These all run against the master process's `discord.js` client — same code paths upstream uses, just lifted into chat-id-aware closures inside `MasterMcpServer.buildServer()`.

### Phase 8 — Multi-user, cross-project, polish (partial ✅)

Done:
- ✅ Natural-language master via `mcp__mcd__run_master_command` (master claude executes commands the operator describes in plain English).
- ✅ Auto-loaded git/Discord workflow guidance baked into every project's CLAUDE.md (clone + create paths). Agents now know about `git push`, `gh pr create`, and how to use `mcp__mcd__reply` without being told.
- ✅ Discord gateway-resume dedup: pool drops duplicate `messageCreate` events by `(chatId, messageId)` with a 60s TTL.
- ✅ Stale `notifyChat` / `isChatReady` / `waitForChatReady` / `closeChat` stubs in MasterMcpServer collapsed to one-line no-ops.

Remaining:
- Per-channel allowlists beyond what `access.json groups[].allowFrom` covers (e.g. role-based)
- Cross-project handoff (`@<slug> please finish this`)
- `/discord:project` skill verbs that proxy to the master via the Gateway's RPC (so a terminal user can drive `create/clone` without typing in Discord)
- Explicit auto-respawn on `claude` crash inside the tmux session (currently lazy-respawns on next message; a watchdog would respawn proactively)
- Resume-broken-PR support (when the bot died mid-push)

---

## Smaller follow-ups (good first issues)

- Tool tests: HTTP probe → `mcp__mcd__reply` round-trip with a mock OutboundReply sink (no live claude needed).
- Replace stale comments referencing the legacy notify path that we no longer use in standalone mode.
- Coalesce duplicate inbound `messageCreate` events (Discord gateway resume edge case) by `messageId` TTL cache in the pool.
- Auto-update `defaults.maxConcurrent` when running on small VMs (RAM heuristic).
- Discord-side `/project new` slash command (in-Discord variant of `!project create`) gated to the master channel.
