import { NextRequest } from 'next/server'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { requireSession } from '../../../src/security'

export const dynamic = 'force-dynamic'

export interface ProjectConfig {
  slug: string
  model: string | null
  progressMode: string | null
  stuckThresholdMinutes: number | null
  healthScoreThreshold: number | null
  allowedTools: string[]
  disallowedTools: string[]
  permissionMode: string | null
}

export interface ProjectConfigResponse {
  config: ProjectConfig
  defaults: Omit<ProjectConfig, 'slug'>
}

interface ClaudeConfig {
  permissionMode?: string
  allowedTools?: string[]
  disallowedTools?: string[]
}

interface ChannelEntry {
  slug?: string
  model?: string
  progressMode?: string
  stuckThresholdMinutes?: number
  healthScoreThreshold?: number
  claude?: ClaudeConfig
}

interface ChannelsJson {
  projects?: Record<string, ChannelEntry>
  defaults?: {
    model?: string
    progressMode?: string
    stuckThresholdMinutes?: number
    healthScoreThreshold?: number
    claude?: ClaudeConfig
  }
}

function mcdDir(): string {
  return process.env.MCD_CHANNELS_DIR ?? path.join(os.homedir(), '.claude', 'channels', 'discord-multi')
}

function readChannels(dir: string): ChannelsJson | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'channels.json'), 'utf-8')) as ChannelsJson }
  catch { return null }
}

function writeChannelsAtomic(dir: string, data: ChannelsJson): void {
  const dest = path.join(dir, 'channels.json')
  const tmp = dest + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, dest)
}

function entryForSlug(channels: ChannelsJson, slug: string): ChannelEntry | null {
  if (!channels.projects) return null
  for (const entry of Object.values(channels.projects)) {
    if (entry.slug === slug) return entry
  }
  return null
}

function buildConfig(slug: string, entry: ChannelEntry, defaults: ChannelsJson['defaults']): ProjectConfig {
  return {
    slug,
    model: entry.model ?? null,
    progressMode: entry.progressMode ?? null,
    stuckThresholdMinutes: entry.stuckThresholdMinutes ?? null,
    healthScoreThreshold: entry.healthScoreThreshold ?? null,
    allowedTools: entry.claude?.allowedTools ?? [],
    disallowedTools: entry.claude?.disallowedTools ?? [],
    permissionMode: entry.claude?.permissionMode ?? null,
  }
}

function buildDefaults(defaults: ChannelsJson['defaults']): Omit<ProjectConfig, 'slug'> {
  return {
    model: defaults?.model ?? null,
    progressMode: defaults?.progressMode ?? null,
    stuckThresholdMinutes: defaults?.stuckThresholdMinutes ?? null,
    healthScoreThreshold: defaults?.healthScoreThreshold ?? null,
    allowedTools: defaults?.claude?.allowedTools ?? [],
    disallowedTools: defaults?.claude?.disallowedTools ?? [],
    permissionMode: defaults?.claude?.permissionMode ?? null,
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const slug = new URL(req.url).searchParams.get('slug')
  if (!slug) return Response.json({ error: 'slug required' }, { status: 400 })

  const dir = mcdDir()
  const channels = readChannels(dir)
  if (!channels) return Response.json({ error: 'channels.json not found' }, { status: 500 })

  const entry = entryForSlug(channels, slug)
  if (!entry) return Response.json({ error: `Project "${slug}" not found` }, { status: 404 })

  return Response.json({
    config: buildConfig(slug, entry, channels.defaults),
    defaults: buildDefaults(channels.defaults),
  } satisfies ProjectConfigResponse)
}

export async function PUT(req: NextRequest): Promise<Response> {
  const unauth = await requireSession()
  if (unauth) return unauth

  let body: {
    slug: string
    model?: string | null
    progressMode?: string | null
    stuckThresholdMinutes?: number | null
    healthScoreThreshold?: number | null
    allowedTools?: string[]
    disallowedTools?: string[]
    permissionMode?: string | null
  }
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { slug } = body
  if (!slug || !/^[a-zA-Z0-9_-]+$/.test(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const dir = mcdDir()
  const channels = readChannels(dir)
  if (!channels) return Response.json({ error: 'channels.json not found' }, { status: 500 })

  // Find the chat_id key for this slug
  let chatId: string | null = null
  if (channels.projects) {
    for (const [id, entry] of Object.entries(channels.projects)) {
      if (entry.slug === slug) { chatId = id; break }
    }
  }
  if (!chatId) return Response.json({ error: `Project "${slug}" not found` }, { status: 404 })

  const entry = channels.projects![chatId]

  // Apply updates
  if ('model' in body) entry.model = body.model ?? undefined
  if ('progressMode' in body) entry.progressMode = body.progressMode ?? undefined
  if ('stuckThresholdMinutes' in body) {
    const v = body.stuckThresholdMinutes
    entry.stuckThresholdMinutes = (typeof v === 'number' && v >= 1 && v <= 60) ? v : undefined
  }
  if ('healthScoreThreshold' in body) {
    const v = body.healthScoreThreshold
    entry.healthScoreThreshold = (typeof v === 'number' && v >= 0 && v <= 100) ? v : undefined
  }

  if ('allowedTools' in body || 'disallowedTools' in body || 'permissionMode' in body) {
    if (!entry.claude) entry.claude = {}
    if ('allowedTools' in body) entry.claude.allowedTools = body.allowedTools ?? []
    if ('disallowedTools' in body) entry.claude.disallowedTools = body.disallowedTools ?? []
    if ('permissionMode' in body) entry.claude.permissionMode = body.permissionMode ?? undefined
  }

  // Clean up empty arrays / undefined values
  if (entry.claude) {
    if (!entry.claude.allowedTools?.length) delete entry.claude.allowedTools
    if (!entry.claude.disallowedTools?.length) delete entry.claude.disallowedTools
    if (!entry.claude.permissionMode) delete entry.claude.permissionMode
    if (!Object.keys(entry.claude).length) delete entry.claude
  }

  writeChannelsAtomic(dir, channels)

  return Response.json({
    config: buildConfig(slug, entry, channels.defaults),
    defaults: buildDefaults(channels.defaults),
  } satisfies ProjectConfigResponse)
}
