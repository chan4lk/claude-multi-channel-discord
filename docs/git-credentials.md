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
