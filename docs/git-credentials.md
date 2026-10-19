# Git Credentials

How to configure credentials so project-channel agents can clone repos, push branches, and open PRs.

---

## `git-credentials.json`

Lives at `$MCD_CHANNELS_DIR/git-credentials.json` (mode 0600). Defines credential aliases that are referenced by name in `channels.json` and in `!project clone/create/remote` commands.

```jsonc
{
  "github-pat":  { "type": "github-pat",  "envVar": "GITHUB_TOKEN" },
  "azure-pat":   { "type": "azure-pat",   "envVar": "AZURE_DEVOPS_PAT" },
  "ssh-default": { "type": "ssh-key",     "keyPath": "~/.ssh/id_ed25519" },
  "ssh-azure":   { "type": "ssh-key",     "keyPath": "~/.ssh/id_rsa_azure" }
}
```

Create or edit this file by hand (or via master Claude: "add a github-pat credential alias called github-pat using GITHUB_TOKEN").

---

## Credential types

### `github-pat`

A GitHub personal access token. The token is read from the named environment variable at spawn time and injected via a temporary `GIT_ASKPASS` helper — it never appears in a URL or git config.

**Minimum scopes:** `repo` (for private repos) or `public_repo` (for public). Add `workflow` if agents need to trigger Actions.

```jsonc
{ "type": "github-pat", "envVar": "GITHUB_TOKEN" }
```

Set the env var in the bot's `.env` (not shell profile — systemd units don't source profile):

```sh
echo "GITHUB_TOKEN=ghp_xxxxxxxxxxxx" >> ~/.claude/channels/discord-multi/.env
chmod 0600 ~/.claude/channels/discord-multi/.env
```

### `azure-pat`

Azure DevOps personal access token. Same mechanism as `github-pat` — GIT_ASKPASS helper, token from env.

**Minimum scopes:** `Code (Read & Write)`.

```jsonc
{ "type": "azure-pat", "envVar": "AZURE_DEVOPS_PAT" }
```

### `ssh-key`

An SSH private key file. Sets `GIT_SSH_COMMAND='ssh -i <path> -o IdentitiesOnly=yes'` in the subprocess env so git uses exactly this key and ignores the agent.

```jsonc
{ "type": "ssh-key", "keyPath": "~/.ssh/id_ed25519" }
```

The key must be readable by the user running the bot. On GitHub: Settings → SSH keys → add the public key. On Azure DevOps: User Settings → SSH public keys.

---

## Provider credentials (non-Claude APIs)

Provider credentials (for routing projects to MiniMax, Bedrock, Vertex, etc.) are separate from git credentials. They live in `channels.json` under `defaults.providers`:

```jsonc
{
  "defaults": {
    "providers": {
      "minimax": {
        "baseUrl": "https://api.minimax.io/anthropic",
        "apiKeyEnv": "MINIMAX_API_KEY"
      }
    }
  }
}
```

Add the key to `.env`:

```sh
echo "MINIMAX_API_KEY=your-key-here" >> ~/.claude/channels/discord-multi/.env
```

Then route a project:

```
!project provider <slug> --set minimax
```

### Codex CLI authentication

Codex is a separate project runner, so `codex` is reserved and must not be added to `defaults.providers`. Install a Codex CLI with app-server support on the MCD host. Run `codex login` and `codex login status` as the same OS account that runs the bot, or supply a dedicated API key through the bot service environment. A login in an operator's personal shell does not automatically authenticate a system service.

For an API key, set the secret in the bot's environment, then name that environment variable in `channels.json`:

```jsonc
{
  "defaults": {
    "codex": {
      "binPath": "codex",
      "sandbox": "workspace-write",
      "approvalPolicy": "never",
      "apiKeyEnv": "MCD_CODEX_API_KEY"
    }
  }
}
```

MCD copies `MCD_CODEX_API_KEY` to `OPENAI_API_KEY` only in the Codex child process. The key value is never stored in `channels.json`. Omit `apiKeyEnv` when using the service account's Codex login. `workspace-write` and `never` are the defaults; `read-only` or `danger-full-access` sandbox access requires an explicit config change. Because approval prompts cannot be answered through MCD, `never` is the only supported approval policy.

```text
!project create --new-channel codex-lab --slug codex-lab --prompt "Work in this project" --provider codex
!project provider codex-lab --set minimax
!project provider codex-lab --set codex
!project provider codex-lab --clear
```

An existing git credential alias still supplies push and PR environment variables to the Codex child. If a saved Codex thread cannot resume, correct the login or move `projects/<slug>/.codex-thread-id` aside before sending the next message to start a fresh thread.

---

## Verify credentials

```sh
bin/check-env.sh
```

The "Git credentials" section checks each alias: PAT types verify the env var is set in the bot process; SSH types verify the key file is readable.

---

## Using credentials in commands

Pass the alias name with `--creds`:

```
!project clone --new-channel my-repo --slug my-repo \
  --repo https://github.com/owner/repo.git \
  --creds github-pat \
  --prompt "You work in my-repo."
```

The alias is stored in `channels.json` per-project and used on every subsequent agent spawn, so the agent can `git push` and `gh pr create` non-interactively throughout its lifetime.

---

## Defaults

Set a default credential for all projects in `channels.json`:

```jsonc
{
  "defaults": {
    "git": {
      "userName":  "mcd-bot",
      "userEmail": "mcd-bot@example.com",
      "credentials": "github-pat",
      "branchPrefix": "claude/"
    }
  }
}
```

Per-project `git.credentials` overrides this default.
