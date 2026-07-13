# Verify Report: pr-credential-store

**Date:** 2026-07-12
**Verdict:** 🟢 PASS

## Gate results

| Check | Result |
|-------|--------|
| `bun src/git-credentials.test.ts` | ✅ all checks passed (17 checks, new suite) |
| `bun src/master-commands.test.ts` | ✅ all checks passed |
| `bun src/scheduler.test.ts` | ✅ all scheduler checks passed |
| `bun src/project-pool.test.ts` | ✅ all checks passed |
| `bun src/master-mcp-server.test.ts` | ✅ all checks passed |
| `bun src/specclaw-status.test.ts` | ✅ all checks passed |
| `bun tsc --noEmit` | ✅ clean |

## Acceptance criteria

- **AC1** ✅ — `prApi: { kind: 'github' }` → `resolvePrApiEnv` yields `GH_TOKEN`, injected at spawn via existing gitCredential block.
- **AC2** ✅ — `prApi: { kind: 'azdo' }` → `AZDO_TOKEN`, `AZURE_DEVOPS_EXT_PAT`, `AZDO_ORG`, `AZDO_PROJECT`.
- **AC3** ✅ — `saveCredentials` writes 0600 and chmods pre-existing looser files back to 0600; insecure-mode load refusal still enforced.
- **AC4** ✅ — `show` uses `describePrAuth` (presence-only choke-point): `github ✓` / `azdo ✓ (org/project)`; token-substring assertions in tests; `set` confirmation names kind + alias only and reminds operator to delete the Discord message.
- **AC5** ✅ — 17-check suite covers env assembly, mode enforcement, redaction, round-trip, legacy parse; tsc clean.

## Commits

- `a6633e2` T1 — prApi schema, saveCredentials 0600, resolvePrApiEnv, describePrAuth
- `6bb0e67` T2 — inject PR-API env vars at spawn
- `28e404f` T3 — set flags + show pr-auth presence
- `109a3ef` T4 — tests
