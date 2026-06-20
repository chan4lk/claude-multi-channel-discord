import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * All paths are computed lazily so MCD_CHANNELS_DIR can be set after import
 * (notably by tests using mkdtempSync), and so symlink swaps of the home
 * directory are honored without restart.
 */
export function channelsDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? join(homedir(), '.claude', 'channels', 'discord')
}

export function accessFile(): string {
  return join(channelsDir(), 'access.json')
}

export function channelsFile(): string {
  return join(channelsDir(), 'channels.json')
}

export function credsFile(): string {
  return join(channelsDir(), 'git-credentials.json')
}

export function memoryDbFile(): string {
  return join(channelsDir(), 'memory.db')
}

export function projectsDir(): string {
  return join(channelsDir(), 'projects')
}

export function archiveDir(): string {
  return join(projectsDir(), '.archive')
}

export function projectDir(slug: string): string {
  return join(projectsDir(), slug)
}

export function projectClaudeMd(slug: string): string {
  return join(projectDir(slug), 'CLAUDE.md')
}

export function projectSessionFile(slug: string): string {
  return join(projectDir(slug), '.session-id')
}
