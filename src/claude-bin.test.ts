/**
 * bun src/claude-bin.test.ts
 * Backend selection + claude binary resolution (plain harness, no bun:test).
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSessionBackend, resolveClaudeBin } from './claude-bin.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

check('backend: win32 defaults to headless', defaultSessionBackend({}, 'win32') === 'headless')
check('backend: linux defaults to tmux', defaultSessionBackend({}, 'linux') === 'tmux')
check('backend: env override wins', defaultSessionBackend({ MCD_SESSION_BACKEND: 'headless' }, 'linux') === 'headless')
check('backend: bogus env ignored', defaultSessionBackend({ MCD_SESSION_BACKEND: 'screen' }, 'darwin') === 'tmux')

check('bin: explicit override wins', resolveClaudeBin('/x/claude', { MCD_CLAUDE_BIN: '/y' }, 'win32') === '/x/claude')
check('bin: MCD_CLAUDE_BIN next', resolveClaudeBin(undefined, { MCD_CLAUDE_BIN: '/y' }, 'win32') === '/y')
check('bin: non-win32 uses plain PATH lookup', resolveClaudeBin(undefined, { PATH: '/nowhere' }, 'linux') === 'claude')

const root = mkdtempSync(join(tmpdir(), 'claude-bin-test-'))
try {
  // PATH with only a .cmd shim is skipped; a dir with claude.exe is found.
  const shimDir = join(root, 'shim')
  const exeDir = join(root, 'exe')
  mkdirSync(shimDir)
  mkdirSync(exeDir)
  writeFileSync(join(shimDir, 'claude.cmd'), '@echo off')
  writeFileSync(join(exeDir, 'claude.exe'), '')
  const sep = process.platform === 'win32' ? ';' : ':'
  check(
    'bin: win32 finds claude.exe on PATH, skipping .cmd shims',
    resolveClaudeBin(undefined, { Path: `${shimDir}${sep}${exeDir}` }, 'win32') === join(exeDir, 'claude.exe'),
  )

  // Desktop-app bundle: newest claude.exe by mtime wins.
  const appData = join(root, 'appdata')
  const older = join(appData, 'Claude', 'claude-code', '2.1.9', 'aaa')
  const newer = join(appData, 'Claude', 'claude-code', '2.1.10', 'bbb')
  mkdirSync(older, { recursive: true })
  mkdirSync(newer, { recursive: true })
  writeFileSync(join(older, 'claude.exe'), '')
  writeFileSync(join(newer, 'claude.exe'), '')
  utimesSync(join(older, 'claude.exe'), new Date(1_000_000), new Date(1_000_000))
  check(
    'bin: win32 falls back to newest desktop-app bundle',
    resolveClaudeBin(undefined, { Path: shimDir, APPDATA: appData }, 'win32') === join(newer, 'claude.exe'),
  )
  // MSIX-packaged desktop app: outside the package, the bundle lives under
  // %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude.
  const localAppData = join(root, 'local')
  const pkg = join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code', '2.1.11', 'ccc')
  mkdirSync(pkg, { recursive: true })
  writeFileSync(join(pkg, 'claude.exe'), '')
  check(
    'bin: win32 finds the MSIX-packaged bundle via LOCALAPPDATA',
    resolveClaudeBin(undefined, { Path: shimDir, APPDATA: join(root, 'no-such-appdata'), LOCALAPPDATA: localAppData }, 'win32') === join(pkg, 'claude.exe'),
  )

  check('bin: win32 with nothing found returns claude', resolveClaudeBin(undefined, { Path: shimDir }, 'win32') === 'claude')
} finally {
  rmSync(root, { recursive: true, force: true })
}

if (failed > 0) {
  console.log(`${failed} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
