# Design: Per-Project PR Credential Store

**Change:** pr-credential-store

## Key decision — literal token storage

Transport credentials use env-var indirection (`resolveCredentialEnv` reads `process.env[cred.envVar]`, never the JSON). PR tokens invert this: the operator pastes a PAT into Discord once and the bot must persist it across restarts — there is no pre-existing bot-process env var to point at. So `prApi.token` is stored literally in `git-credentials.json`, protected by the existing insecure-mode load refusal (0o077 check) plus chmod-enforced 0600 on every save.

## Schema (src/git-credentials.ts)

```ts
const PrApiSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), token: z.string().min(1) }),
  z.object({ kind: z.literal('azdo'), token: z.string().min(1), org: z.string().min(1), project: z.string().min(1) }),
])
```

Each existing variant (github-pat / azure-pat / ssh-key) gains `prApi: PrApiSchema.optional()` via a shared `.extend()`.

New exports:
- `saveCredentials(creds, path?)` — `writeFileSync(..., { mode: 0o600 })` + `chmodSync(path, 0o600)` (writeFileSync mode is ignored for pre-existing files).
- `resolvePrApiEnv(cred)` — `{}` when no prApi; github → `GH_TOKEN`; azdo → `AZDO_TOKEN` + `AZURE_DEVOPS_EXT_PAT` (az CLI convention) + `AZDO_ORG` + `AZDO_PROJECT`.
- `describePrAuth(cred)` — `null` when no prApi; `'github ✓'`; `'azdo ✓ (org/project)'`. Token never appears — single choke-point for redaction.

## Spawn wiring (src/claude-process.ts)

Inside the existing `gitCredential` block (~line 490): after diff-injecting `buildGitEnv` vars, `for (const [k, v] of Object.entries(resolvePrApiEnv(cred))) addEnv(k, v)`. Same try/catch — a resolve failure logs and continues, never blocks spawn.

## CLI (src/master-commands.ts)

`handleSet` gains flags:
- `--pr-token-github <token>`
- `--pr-token-azdo <token>` + required `--azdo-org` + `--azdo-project`

Handler: resolve `entry.project.git?.credentials` (error if absent — transport alias is the storage key), `loadCredentials()`, set `prApi`, `saveCredentials()`. Reply: `✅ stored github PR token on alias \`X\` for **slug**` + `⚠ delete the Discord message containing the token now.` Mutually exclusive with each other; token value never echoed.

`show` (git block ~line 288): try-wrapped `loadCredentials()` + `describePrAuth()`; append `pr auth: <desc>` line when non-null. Unreadable creds file → silently skip (show must not fail).

## Testing

New `src/git-credentials.test.ts` (tmpdir fixtures):
- AC1/AC2: `resolvePrApiEnv` github/azdo env assembly; no-prApi → `{}`
- AC3: `saveCredentials` → stat mode 0600, including pre-existing looser-mode file
- AC4: `describePrAuth` output contains no token substring
- round-trip: save → load parses, insecure mode still refused
