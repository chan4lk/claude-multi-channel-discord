import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Path to the operator's optional user-level env file. Lives under XDG
 * (`~/.config/<project>/env`) so it isn't entangled with the runtime
 * state directory — losing/resetting channels doesn't drop keys.
 *
 * Format is plain shell-style KEY=VAL, one per line. Lines starting
 * with `#` are comments. Quoted values (single or double quotes) have
 * their wrapping quotes stripped. No variable expansion or command
 * substitution — values are taken literally. Empty lines are skipped.
 *
 * If the file is missing the loader returns {} and callers proceed
 * normally. If the file exists with group/world read bits set the
 * loader throws — same posture as git-credentials.json, since this is
 * where API keys live.
 */
export function userEnvFile(): string {
  return process.env.MCD_USER_ENV_FILE ?? join(homedir(), '.config', 'multi-channel-discord', 'env')
}

export class UserEnvError extends Error {}

/**
 * Parse a shell-style KEY=VAL file. Returns a plain object suitable
 * for Object.entries + addEnv()-style injection.
 */
export function loadUserEnv(path: string = userEnvFile()): Record<string, string> {
  if (!existsSync(path)) return {}
  // API keys live here. Same posture as git-credentials.json: refuse
  // to load if the file is group- or world-readable.
  const mode = statSync(path).mode & 0o777
  if (mode & 0o077) {
    throw new UserEnvError(`${path} has insecure mode ${mode.toString(8)}; chmod 0600 it before reuse`)
  }
  const raw = readFileSync(path, 'utf8')
  const out: Record<string, string> = {}
  let lineno = 0
  for (const lineRaw of raw.split(/\r?\n/)) {
    lineno += 1
    const line = lineRaw.trim()
    if (!line || line.startsWith('#')) continue
    // Reject anything that looks like a shell directive we don't
    // want to execute (export, unset, . source). The file is
    // KEY=VAL only — silent drop is friendlier than throwing on
    // a benign `export FOO=bar`, so we just ignore non-matching
    // lines and continue.
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    // Strip a single layer of matched single or double quotes.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}
