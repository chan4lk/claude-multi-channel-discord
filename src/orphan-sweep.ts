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
 */
import { spawnSync } from 'node:child_process'

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

  const ls = spawnSync('tmux', ['ls', '-F', '#{session_name}'], { encoding: 'utf8' })
  if (ls.error || ls.status !== 0) return result

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

  if (result.killed.length > 0 || result.errors.length > 0) {
    process.stderr.write(
      `orphan-sweep: ${result.killed.length} stale session(s) killed, ${result.errors.length} error(s)\n`,
    )
  }
  return result
}
