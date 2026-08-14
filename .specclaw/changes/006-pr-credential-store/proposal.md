# Proposal: Per-Project PR Credential Store

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

The specclaw lifecycle ends in a PR (`/specclaw:pr` needs a gh token, `/specclaw:pr-azdo` needs an ADO PAT), but MCD only provisions *git transport* credentials (`src/git-credentials.ts` aliases → `buildGitEnv()`). On 2026-07-12 the dstm-apps loop hard-blocked at the PR phase: branch pushed fine over SSH, but PR create/merge had no PAT. The operator had to be walked through creating a PAT and then **pasted it into the Discord channel in plaintext** (message `1525681176717561856`) — it landed in channel history and the session transcript, and was hand-written into an ad-hoc `.specclaw/.env` that only that one project knows about. Every future ADO-backed project will hit the same wall and repeat the same unsafe dance.

## Proposed Solution

Extend the credential alias system to carry PR-API tokens and export them at spawn:

1. **Schema** (`src/git-credentials.ts`): alias entries gain optional `prApi: { kind: 'github' | 'azdo', tokenEnv: string, org?, project? }` — or a parallel `pr-credentials` section; keep 0600 enforcement. Token values live in the credentials file, never in `channels.json`.
2. **Spawn env** (`src/claude-process.ts` via `buildGitEnv()` or a sibling `buildPrEnv()`): when the project's resolved credential alias has `prApi`, export the conventional vars into the subprocess: `GH_TOKEN` for github, `AZDO_TOKEN`/`AZURE_DEVOPS_EXT_PAT` (+ org/project) for azdo. specclaw's pr skills and `gh` pick them up with zero project-side config.
3. **CLI**: `!project set <slug> --pr-token-github <token>` / `--pr-token-azdo <token> --azdo-org X --azdo-project Y`, storing into the credentials file. Master-channel message containing the token is a known exposure; the handler should confirm storage and remind the operator to delete the Discord message.

## Scope

### In Scope
- `src/git-credentials.ts`: schema + IO for PR tokens (mode 0600)
- Spawn-time env export
- `src/master-commands.ts` set-flags
- Migration note: dstm-apps' `.specclaw/.env` → central store
- Tests: env assembly, file-mode enforcement, redaction in `show` output (never print tokens)

### Out of Scope
- OAuth/device-code flows (PAT paste is the reality; centralize + protect it)
- Token rotation/expiry tracking
- Per-schedule credentials

## Impact

- **Files affected:** 4 (estimated)
- **Complexity:** medium
- **Risk:** medium — secret handling; mitigations: 0600 file, redacted display, tokens only in subprocess env

## Open Questions

- Should `!project show` indicate PR-token presence (`pr auth: azdo ✓`)? Proposal: yes, presence only, never the value.

---

**To proceed:** Review this proposal and approve to begin planning.
