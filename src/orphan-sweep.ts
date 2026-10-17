/**
 * Boot-time orphan session sweep.
 *
 * Every MCD server restart used to leak one warm `claude` subprocess per
 * active channel: the pool's session map is in-memory, tmux sessions are
 * detached, and session names embed a spawn timestamp
 * (`mcd-<slug>-<base36ts>`, see claude-process.ts), so a new server
 * generation spawns fresh sessions instead of reattaching and the old
 * ones run forever — invisible to idle-evict and the watchdog, which only
 * reach pool-tracked processes.
 *
 * A freshly booted server owns zero project sessions, so at boot every
 * tmux session matching the project-session pattern is by definition an
 * orphan from a dead generation. Killing them loses nothing: each project
 * resumes via `.session-id` + `--resume` on its next inbound message,
 * exactly as after a normal idle-evict.
 *
 * Opt out with `defaults.orphanSweep: false` in channels.json (required
 * when multiple MCD instances share one tmux server).
 *
 * The headless backend has no tmux server to list; each child's pid is
 * recorded in `projects/<slug>/.headless-pid` instead, and the sweep kills
 * any recorded pid that is still a claude running with an MCD mcp-config.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { projectsDir } from './paths.ts'

/**
 * Filter tmux session names down to MCD project sessions.
 *
 * Pattern: `mcd-<slug>-<base36 timestamp>`. The suffix produced by
 * `Date.now().toString(36)` is 8 chars in 2026; 4–12 tolerates decades of
 * clock drift while excluding hand-named sessions like `mcd-server`. The
 * bare `mcd` server session has no suffix and never matches.
 */
export function findOrphanSessions(names: string[]): string[] {
  return names.filter((n) => /^mcd-.+-[a-z0-9]{4,12}$/.test(n))
}

export interface SweepResult {
  killed: string[]
  errors: string[]
}

/**
 * List tmux sessions and kill every MCD project session. Never throws:
 * a missing tmux server (or zero sessions) is "nothing to sweep", and a
 * failed kill is collected and skipped so the rest still die.
 */
export function sweepOrphanSessions(): SweepResult {
  const result: SweepResult = { killed: [], errors: [] }

  sweepHeadlessPids(result)
  sweepTmuxSessions(result)

  if (result.killed.length > 0 || result.errors.length > 0) {
    process.stderr.write(
      `orphan-sweep: ${result.killed.length} stale session(s) killed, ${result.errors.length} error(s)\n`,
    )
  }
  return result
}

/**
 * True when pid is a live claude that MCD spawned: its argv carries our
 * `mcd-<slug>-*` --mcp-config. Checking the image name alone isn't enough —
 * a recycled pid can belong to an unrelated claude (e.g. the desktop app's
 * own sessions, which also run claude.exe in stream-json mode).
 */
function isMcdClaudePid(pid: number): boolean {
  let cmdline = ''
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
      { encoding: 'utf8', windowsHide: true },
    )
    cmdline = r.stdout ?? ''
  } else {
    const r = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' })
    cmdline = r.stdout ?? ''
  }
  return /claude/i.test(cmdline) && /mcd-[^\\/\s]+[\\/]mcp-config\.json/.test(cmdline)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sweepHeadlessPids(result: SweepResult): void {
  let slugs: string[]
  try {
    slugs = readdirSync(projectsDir())
  } catch {
    return
  }
  for (const slug of slugs) {
    const pidFile = join(projectsDir(), slug, '.headless-pid')
    if (!existsSync(pidFile)) continue
    let pid: number
    try {
      pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10)
      rmSync(pidFile, { force: true })
    } catch {
      continue
    }
    // A recycled pid that now belongs to something else is left alone.
    if (!Number.isFinite(pid) || !isMcdClaudePid(pid)) continue
    const name = `headless:${slug}(${pid})`
    const kill = process.platform === 'win32'
      ? spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true })
      : spawnSync('kill', [String(pid)], { encoding: 'utf8' })
    // taskkill /T exits non-zero when a grandchild already exited mid-walk,
    // even though the target died; what matters is that the pid is gone.
    if ((kill.error || kill.status !== 0) && pidAlive(pid)) {
      result.errors.push(`${name}: ${kill.error?.message ?? ((kill.stderr ?? '').trim() || 'kill failed')}`)
      process.stderr.write(`orphan-sweep: failed to kill ${name}\n`)
      continue
    }
    result.killed.push(name)
    process.stderr.write(`orphan-sweep: killed ${name}\n`)
  }
}

function sweepTmuxSessions(result: SweepResult): void {
  const ls = spawnSync('tmux', ['ls', '-F', '#{session_name}'], { encoding: 'utf8' })
  if (ls.error || ls.status !== 0) return

  const names = (ls.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  for (const name of findOrphanSessions(names)) {
    const kill = spawnSync('tmux', ['kill-session', '-t', name], { encoding: 'utf8' })
    if (kill.error || kill.status !== 0) {
      const detail = kill.error?.message ?? (kill.stderr ?? '').trim()
      result.errors.push(`${name}: ${detail || 'kill-session failed'}`)
      process.stderr.write(`orphan-sweep: failed to kill ${name}\n`)
      continue
    }
    result.killed.push(name)
    process.stderr.write(`orphan-sweep: killed ${name}\n`)
  }
}
