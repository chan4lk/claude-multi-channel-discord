/**
 * Resolve the `claude` executable and the session backend for this host.
 *
 * Windows can't spawn a `.cmd`/`.bat` shim without a shell, and libuv's
 * PATH search only appends `.exe`/`.com`, so a PATH that only carries a
 * `claude.cmd` wrapper makes `spawn('claude')` fail with ENOENT. On win32
 * we therefore resolve a real `claude.exe`, in order:
 *   1. explicit override (option / MCD_CLAUDE_BIN)
 *   2. `claude.exe` on PATH (native installer puts it in ~/.local/bin)
 *   3. the newest CLI bundled with the Claude desktop app
 *      (%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe). The app
 *      is MSIX-packaged, so outside the package that folder really lives at
 *      %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude.
 * Elsewhere PATH lookup of plain `claude` is left to the OS.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export type SessionBackend = 'tmux' | 'headless'

/**
 * tmux keeps an interactive claude warm in a real PTY; it doesn't exist on
 * native Windows, so win32 defaults to the headless stream-json backend.
 * MCD_SESSION_BACKEND=tmux|headless overrides (e.g. headless on Linux).
 */
export function defaultSessionBackend(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): SessionBackend {
  const v = env.MCD_SESSION_BACKEND?.trim().toLowerCase()
  if (v === 'tmux' || v === 'headless') return v
  return platform === 'win32' ? 'headless' : 'tmux'
}

/** Every `claude-code` dir the desktop app may have written, packaged or not. */
function bundledClaudeRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = []
  if (env.APPDATA) roots.push(join(env.APPDATA, 'Claude', 'claude-code'))
  if (env.LOCALAPPDATA) {
    const pkgs = join(env.LOCALAPPDATA, 'Packages')
    try {
      for (const p of readdirSync(pkgs)) {
        if (p.startsWith('Claude_')) roots.push(join(pkgs, p, 'LocalCache', 'Roaming', 'Claude', 'claude-code'))
      }
    } catch { /* no Packages dir */ }
  }
  return roots
}

function newestBundledClaude(env: NodeJS.ProcessEnv): string | null {
  let best: { path: string; mtime: number } | null = null
  for (const base of bundledClaudeRoots(env)) {
    let versions: string[]
    try { versions = readdirSync(base) } catch { continue }
    for (const ver of versions) {
      const verDir = join(base, ver)
      let hashes: string[]
      try { hashes = readdirSync(verDir) } catch { continue }
      for (const h of hashes) {
        const exe = join(verDir, h, 'claude.exe')
        try {
          const m = statSync(exe).mtimeMs
          if (!best || m > best.mtime) best = { path: exe, mtime: m }
        } catch { /* not a CLI dir */ }
      }
    }
  }
  return best?.path ?? null
}

export function resolveClaudeBin(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (override) return override
  if (env.MCD_CLAUDE_BIN) return env.MCD_CLAUDE_BIN
  if (platform !== 'win32') return 'claude'
  for (const dir of (env.Path ?? env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const exe = join(dir, 'claude.exe')
    if (existsSync(exe)) return exe
  }
  return newestBundledClaude(env) ?? 'claude'
}
