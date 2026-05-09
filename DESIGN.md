# multi-channel-discord

Forks Apache-2.0 [`claude-channel-discord`](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/discord) v0.0.4 into a project-aware Discord bot. One bot, many channels, each channel = an isolated Claude Code subprocess working inside a git working tree.

## Goals

- One Discord bot per host. ≤50 active "projects" (Discord channels).
- Each project has independent: system prompt, Claude Code session, git working tree, optional remote.
- Driven by the operator's Claude subscription via `claude` CLI subprocesses (Anthropic forbids subscription OAuth in the Agent SDK; Claude Code is the only sanctioned subscription path).
- Project lifecycle controlled from a designated **master channel** by the operator.
- Code work commits to a **per-task branch** and opens a PR (GitHub or Azure DevOps).

## Architecture at a glance

```
Discord ─→ server.ts ─→ Project Pool ─→ N × claude (subscription)
              │              │
              │              └── Map<chat_id, ClaudeProcess>
              │                  - lazy spawn per chat_id
              │                  - idle eviction (default 15m)
              │                  - cwd = projects/<slug>/ (a git work tree)
              │
              ├── access.json          (existing, unchanged — gates inbound messages)
              ├── channels.json        (NEW — project registry, master channel, defaults)
              ├── git-credentials.json (NEW, mode 0600 — env-var refs / SSH key paths)
              └── projects/<slug>/     (NEW — git repo per project, contains CLAUDE.md)
```

## File layout (all under `~/.claude/channels/discord/`)

```
server.ts                  forked plugin master loop
package.json               adds @octokit/rest, ws, fast-glob (existing deps kept)
access.json                unchanged
channels.json              NEW — project registry
git-credentials.json       NEW — credential aliases (mode 0600)
projects/<slug>/           NEW — one git working tree per project
  .git/
  CLAUDE.md                per-project system prompt
  .session-id              last Claude Code session id (for --resume)
projects/.archive/         soft-deleted projects, suffixed with timestamp
```

## channels.json schema

```jsonc
{
  "master": {
    "chatId": "1496366925192630313",
    "commandPrefix": "!project"
  },
  "defaults": {
    "model": "sonnet",
    "idleEvictMinutes": 15,
    "maxConcurrent": 8,
    "git": {
      "userName":  "claude-bot",
      "userEmail": "claude-bot@example.com",
      "credentials": "github-default",
      "branchPrefix": "claude/"
    }
  },
  "projects": {
    "<chat_id>": {
      "slug": "support-bot",
      "model": "sonnet",                     // override default
      "git": {                                // optional; if absent, project is solo
        "remote": "https://github.com/owner/repo.git",
        "branch": "main",                     // base branch for PRs
        "credentials": "github-default"       // refers to git-credentials.json key
      }
    }
  }
}
```

Slug constraints: `^[a-z][a-z0-9_-]{0,30}$`, unique. Bootstrap requires terminal skill `/discord:project init`.

## git-credentials.json schema

```jsonc
{
  "github-default": { "type": "github-pat",  "envVar": "GITHUB_TOKEN" },
  "azure-default":  { "type": "azure-pat",   "envVar": "AZURE_DEVOPS_PAT" },
  "ssh-personal":   { "type": "ssh-key",     "keyPath": "~/.ssh/id_ed25519" }
}
```

Subprocess env constructed per-project:
- `github-pat` / `azure-pat`: token loaded from env (or env file fallback) and exposed via a `GIT_ASKPASS` script — never written into URLs or git config.
- `ssh-key`: subprocess inherits `GIT_SSH_COMMAND='ssh -i <path> -o IdentitiesOnly=yes'`.

## Master-channel commands (parsed by server.ts)

```
!project init   --master <chat_id>            # bootstrap; only callable once via terminal skill
!project create <chat_id> --slug X --prompt "..." [--model M] [--new-repo PROVIDER:OWNER/NAME --creds C]
!project clone  <chat_id> --slug X --repo <url> [--branch BR] [--creds NAME] [--prompt "..."]
!project set    <chat_id> --prompt "..."      # rewrites CLAUDE.md
!project rename <chat_id> --slug NEW
!project remote <chat_id> [--set URL] [--creds NAME]
!project status <chat_id>                     # working tree + ahead/behind + open PRs
!project pull   <chat_id>                     # explicit ff-only pull on base branch
!project list
!project rm     <chat_id> --yes               # archives projects/<slug> → projects/.archive/<slug>-<ts>/
!project help
```

Commands run only when:
- `chat_id == master.chatId`, AND
- `userId ∈ access.allowFrom`, AND
- For destructive verbs (`rm`, `remote --set`, `rename`), explicit `--yes` is required.

## Push/PR workflow (option b — selected by operator)

When a chat in a project channel asks to "commit" or "push":
1. Claude Code (running in `projects/<slug>/`) creates a new branch: `<branchPrefix><slug>/<ts>-<short-desc>`.
2. Stages and commits using the configured `user.name` / `user.email`.
3. `git push -u origin <branch>` using the credential helper.
4. Opens a PR via:
   - GitHub: Octokit `pulls.create` with `base: git.branch`, `head: <branch>`, title from commit subject, body summarizing the change.
   - Azure DevOps: REST `POST {org}/{project}/_apis/git/repositories/{repo}/pullrequests` (PAT auth).
5. Replies in the Discord channel with the PR URL.

Subprocess startup always runs `git pull --ff-only origin <git.branch>`. If non-FF, the bot replies "remote diverged from `<branch>`, resolve manually" and refuses commits/pushes until cleared with `!project pull`.

## Bootstrap order

1. Terminal: `/discord:project init --master <chat_id> --prompt "..."` — writes `channels.json`, creates the master project entry, lays down `projects/master/CLAUDE.md`.
2. From master channel: `!project create <other_chat_id> --slug X --prompt "..."`
3. To attach a new project to an existing repo: `!project clone <chat_id> --slug X --repo <url>`.

## Out of scope (v1)

- Discord-side `/project new` available to non-operators (always master-channel-gated).
- Per-project allowlists beyond what `access.json groups[].allowFrom` already supports.
- Cross-project handoff or @mentions across projects.
- Auto-commit-on-edit (commits remain user-driven via chat).
- Branch protection / required reviews / draft PRs (use upstream repo settings instead).
- Force pushes, rebases, history rewrites — bot will refuse.

## Migration plan

1. Run alongside the current single-session bot for ~1 week. New Discord application, token in `~/.claude/channels/discord/.env.projects`. `claude-discord-runner.sh` learns a `--mode projects` flag selecting the new server.ts.
2. Once smoke tests pass with 2-3 projects, swap `claude-discord.service` to invoke the new mode.
3. Old single-session bot stays installable as fallback by reverting the runner flag.

## Implementation phases

1. **Registry + bootstrap skill** — `channels.json` IO, validation, `/discord:project init` terminal skill.
2. **Master command parser** — `!project ...` handler in server.ts; non-destructive verbs first (`list`, `status`, `set`).
3. **Project pool** — `Map<chat_id, ClaudeProcess>` with lazy spawn, idle eviction, max-concurrent cap.
4. **Per-project MCP relay** — pipe Discord messages for one chat_id into one Claude Code subprocess, ferry replies back.
5. **Git layer** — clone/init, credential helper, branch creation.
6. **PR layer** — GitHub Octokit + Azure DevOps REST.
7. **Destructive verbs + smoke tests**.
