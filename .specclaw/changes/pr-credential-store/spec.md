# Spec: Per-Project PR Credential Store

**Change:** pr-credential-store
**Created:** 2026-07-12

## Overview

The lifecycle's PR phase hard-blocks on missing API tokens: git transport works (SSH), but `gh` / `/specclaw:pr-azdo` need a PAT the subprocess doesn't have. Extend the credential alias system to carry PR-API tokens (stored in the 0600 `git-credentials.json`), export conventional env vars at spawn, and add `!project set` flags so the operator can store a pasted token safely.

## Functional Requirements

- **FR1** — Schema (`src/git-credentials.ts`): every credential alias variant gains optional `prApi`:
  - `{ kind: 'github', token }` or `{ kind: 'azdo', token, org, project }`
  - Token value stored literally in `git-credentials.json` — the file is already 0600-enforced on load; unlike transport creds there is no bot-process env var to alias (operator pastes a PAT once).
- **FR2** — `saveCredentials()` writes the file with mode 0600 (chmod-enforced even when the file pre-exists).
- **FR3** — `resolvePrApiEnv(cred)`:
  - `github` → `GH_TOKEN`
  - `azdo` → `AZDO_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `AZDO_ORG`, `AZDO_PROJECT`
  - no `prApi` → `{}`
- **FR4** — Spawn (`src/claude-process.ts`): after `buildGitEnv()`, inject `resolvePrApiEnv(cred)` vars into the subprocess env.
- **FR5** — CLI (`src/master-commands.ts` `handleSet`): `--pr-token-github <token>` and `--pr-token-azdo <token> --azdo-org X --azdo-project Y` store `prApi` on the project's resolved `git.credentials` alias. Errors when the project has no credentials alias. Confirmation names kind + alias only (never the token) and reminds the operator to delete the Discord message.
- **FR6** — `!project show` displays PR-token presence only: `pr auth: github ✓` / `pr auth: azdo ✓ (org/project)` via `describePrAuth()`.

## Acceptance Criteria

- AC1: Alias with `prApi.github` → subprocess env contains `GH_TOKEN`
- AC2: Alias with `prApi.azdo` → subprocess env contains PAT + org/project vars
- AC3: Credentials file mode 0600 enforced on write
- AC4: `show` displays token presence only, never values
- AC5: Tests for env assembly + redaction; `bun tsc --noEmit` clean

## Out of Scope

- OAuth/device-code flows, token rotation, per-schedule credentials.
