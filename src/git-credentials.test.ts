/**
 * bun src/git-credentials.test.ts
 *
 * Tests for src/git-credentials.ts PR-API credential store — AC1/AC2 env
 * assembly, AC3 0600 enforcement on save, AC4 redaction, round-trip.
 */
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  describePrAuth,
  loadCredentials,
  resolvePrApiEnv,
  saveCredentials,
  type Credential,
  type CredentialsFile,
} from './git-credentials.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

const TOKEN_GH = 'ghp_secret1234567890'
const TOKEN_ADO = 'ado_secret0987654321'

const githubCred: Credential = {
  type: 'ssh-key',
  keyPath: '~/.ssh/id_ed25519',
  prApi: { kind: 'github', token: TOKEN_GH },
}
const azdoCred: Credential = {
  type: 'azure-pat',
  envVar: 'ADO_TRANSPORT_PAT',
  prApi: { kind: 'azdo', token: TOKEN_ADO, org: 'bistec', project: 'dstm-apps' },
}
const bareCred: Credential = { type: 'ssh-key', keyPath: '~/.ssh/id_ed25519' }

// ── AC1: github prApi → GH_TOKEN ─────────────────────────────────────────────

{
  const env = resolvePrApiEnv(githubCred)
  check('AC1: github prApi → GH_TOKEN set', env.GH_TOKEN === TOKEN_GH)
  check('AC1: github prApi → no azdo vars', env.AZDO_TOKEN === undefined && env.AZURE_DEVOPS_EXT_PAT === undefined)
}

// ── AC2: azdo prApi → PAT + org/project vars ─────────────────────────────────

{
  const env = resolvePrApiEnv(azdoCred)
  check('AC2: azdo prApi → AZDO_TOKEN', env.AZDO_TOKEN === TOKEN_ADO)
  check('AC2: azdo prApi → AZURE_DEVOPS_EXT_PAT', env.AZURE_DEVOPS_EXT_PAT === TOKEN_ADO)
  check('AC2: azdo prApi → AZDO_ORG', env.AZDO_ORG === 'bistec')
  check('AC2: azdo prApi → AZDO_PROJECT', env.AZDO_PROJECT === 'dstm-apps')
}

// ── no prApi → empty env ─────────────────────────────────────────────────────

{
  check('no prApi → empty env', Object.keys(resolvePrApiEnv(bareCred)).length === 0)
}

// ── AC3: saveCredentials enforces 0600, including pre-existing loose file ────

{
  const dir = mkdtempSync(join(tmpdir(), 'git-creds-test-'))
  const path = join(dir, 'git-credentials.json')
  try {
    const creds: CredentialsFile = { 'ssh-default': githubCred }
    saveCredentials(creds, path)
    check('AC3: fresh save → mode 0600', (statSync(path).mode & 0o777) === 0o600)

    chmodSync(path, 0o644)
    saveCredentials(creds, path)
    check('AC3: re-save over 0644 file → chmod back to 0600', (statSync(path).mode & 0o777) === 0o600)

    // Round-trip: what we saved parses back with prApi intact.
    const loaded = loadCredentials(path)
    check('round-trip: prApi survives save/load', loaded['ssh-default']?.prApi?.kind === 'github')

    // Insecure mode still refused on load.
    chmodSync(path, 0o644)
    let threw = false
    try { loadCredentials(path) } catch { threw = true }
    check('AC3: 0644 file refused on load', threw)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── legacy file without prApi still parses ───────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'git-creds-test-'))
  const path = join(dir, 'git-credentials.json')
  try {
    writeFileSync(path, JSON.stringify({ 'gh': { type: 'github-pat', envVar: 'GH_PAT' } }), { mode: 0o600 })
    const loaded = loadCredentials(path)
    check('legacy: alias without prApi parses', loaded['gh']?.type === 'github-pat')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── AC4: describePrAuth is presence-only, never leaks tokens ─────────────────

{
  const gh = describePrAuth(githubCred)
  const ado = describePrAuth(azdoCred)
  check('AC4: github presence string', gh === 'github ✓')
  check('AC4: azdo presence string includes org/project', ado === 'azdo ✓ (bistec/dstm-apps)')
  check('AC4: no token substring in github output', !gh!.includes(TOKEN_GH))
  check('AC4: no token substring in azdo output', !ado!.includes(TOKEN_ADO))
  check('AC4: no prApi → null', describePrAuth(bareCred) === null)
}

// ── summary ──────────────────────────────────────────────────────────────────

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
