/**
 * Shared helpers for locating the Claude transcript directory for a project.
 *
 * Claude writes transcripts to `~/.claude/projects/<encoded-cwd>/` where the
 * encoded form replaces every non-alphanumeric character with `-`. Symlinked
 * project directories must be realpathed first because Claude resolves them
 * internally before encoding — if we don't do the same, our computed path
 * misses the actual transcript files.
 *
 * This module is intentionally small: it only encodes, locates, and stats
 * transcript files. Reading or parsing transcript content belongs elsewhere.
 */
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Encode a project cwd into the form Claude uses for its transcript directory.
 * Realpaths symlinks before encoding — critical invariant for session resume.
 */
export function encodeProjectCwd(cwd: string): string {
  let real = cwd
  try {
    real = realpathSync(cwd)
  } catch {}
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Return the path to the Claude transcript directory for a given project cwd.
 * Does not verify the directory exists.
 */
export function transcriptDirFor(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd))
}

/**
 * Return the mtime (epoch ms) of the most-recently-written `.jsonl` file in
 * the project's transcript directory, or null when the directory is missing or
 * contains no `.jsonl` files.
 */
export function newestTranscriptMtimeMs(cwd: string): number | null {
  const dir = transcriptDirFor(cwd)
  let files: string[]
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  if (files.length === 0) return null

  let newest = 0
  for (const file of files) {
    try {
      const mtime = statSync(join(dir, file)).mtimeMs
      if (mtime > newest) newest = mtime
    } catch {
      // skip unreadable entries
    }
  }
  return newest === 0 ? null : newest
}
