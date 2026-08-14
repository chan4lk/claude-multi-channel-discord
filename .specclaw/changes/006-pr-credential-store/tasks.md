# Tasks: Per-Project PR Credential Store

**Change:** pr-credential-store
**Created:** 2026-07-12
**Total Tasks:** 5

## Tasks

### Wave 1 — Core

- [x] `T1` — Schema + IO in src/git-credentials.ts: PrApiSchema, prApi on all variants, saveCredentials (0600 chmod-enforced), resolvePrApiEnv, describePrAuth
  - Files: src/git-credentials.ts
  - Estimate: medium

### Wave 2 — Wiring

- [x] `T2` — Spawn env: inject resolvePrApiEnv vars in claude-process.ts gitCredential block
  - Files: src/claude-process.ts
  - Estimate: small
  - Depends: T1
- [x] `T3` — CLI: handleSet --pr-token-github / --pr-token-azdo (+ --azdo-org/--azdo-project); show pr-auth presence line
  - Files: src/master-commands.ts
  - Estimate: medium
  - Depends: T1

### Wave 3 — Tests + gate

- [x] `T4` — src/git-credentials.test.ts: env assembly (AC1/AC2), 0600 enforcement (AC3), redaction (AC4), round-trip
  - Files: src/git-credentials.test.ts
  - Estimate: medium
  - Depends: T1
- [x] `T5` — Full gate: all test suites + `bun tsc --noEmit`
  - Estimate: small
  - Depends: T2, T3, T4
