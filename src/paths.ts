import { homedir } from 'node:os'
import { join } from 'node:path'

const CHANNELS_DIR_ENV = process.env.MCD_CHANNELS_DIR
export const CHANNELS_DIR = CHANNELS_DIR_ENV ?? join(homedir(), '.claude', 'channels', 'discord')

export const ACCESS_FILE = join(CHANNELS_DIR, 'access.json')
export const CHANNELS_FILE = join(CHANNELS_DIR, 'channels.json')
export const CREDS_FILE = join(CHANNELS_DIR, 'git-credentials.json')

export const PROJECTS_DIR = join(CHANNELS_DIR, 'projects')
export const ARCHIVE_DIR = join(PROJECTS_DIR, '.archive')

export const projectDir = (slug: string): string => join(PROJECTS_DIR, slug)
export const projectClaudeMd = (slug: string): string => join(projectDir(slug), 'CLAUDE.md')
export const projectSessionFile = (slug: string): string => join(projectDir(slug), '.session-id')
