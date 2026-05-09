import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

import { channelsFile } from './paths.ts'

export const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,30}$/

const SlugSchema = z.string().regex(SLUG_PATTERN, 'slug must be lowercase, 1-31 chars, [a-z0-9_-], start with a letter')
const ChatIdSchema = z.string().regex(/^\d{15,25}$/, 'chat_id must be a Discord snowflake (15-25 digits)')

const ProjectGitSchema = z.object({
  remote: z.string().url(),
  branch: z.string().min(1).default('main'),
  credentials: z.string().min(1),
})

const ProjectSchema = z.object({
  slug: SlugSchema,
  model: z.string().optional(),
  git: ProjectGitSchema.optional(),
})

const DefaultsGitSchema = z.object({
  userName: z.string().default('claude-bot'),
  userEmail: z.string().default('claude-bot@local'),
  credentials: z.string().optional(),
  branchPrefix: z.string().default('claude/'),
})

const DefaultsSchema = z.object({
  model: z.string().default('sonnet'),
  idleEvictMinutes: z.number().int().positive().default(15),
  maxConcurrent: z.number().int().positive().default(8),
  git: DefaultsGitSchema.default({}),
})

const MasterSchema = z.object({
  chatId: ChatIdSchema,
  commandPrefix: z.string().default('!project'),
})

export const ChannelsConfigSchema = z.object({
  version: z.literal(1).default(1),
  master: MasterSchema.optional(),
  defaults: DefaultsSchema.default({}),
  projects: z.record(ChatIdSchema, ProjectSchema).default({}),
})

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>
export type Project = z.infer<typeof ProjectSchema>

const EMPTY_CONFIG: ChannelsConfig = ChannelsConfigSchema.parse({})

export function loadConfig(path: string = channelsFile()): ChannelsConfig {
  if (!existsSync(path)) return EMPTY_CONFIG
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`failed to read ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  const result = ChannelsConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${path} failed schema validation:\n${result.error.toString()}`)
  }
  // Slug uniqueness guard — schema doesn't express it.
  const seen = new Set<string>()
  for (const [chatId, project] of Object.entries(result.data.projects)) {
    if (seen.has(project.slug)) {
      throw new Error(`duplicate slug "${project.slug}" (last seen on chat_id ${chatId})`)
    }
    seen.add(project.slug)
  }
  return result.data
}

export function saveConfig(config: ChannelsConfig, path: string = channelsFile()): void {
  // Re-parse to apply defaults and reject malformed in-memory mutations before persisting.
  const validated = ChannelsConfigSchema.parse(config)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export function findProjectByChatId(config: ChannelsConfig, chatId: string): Project | undefined {
  return config.projects[chatId]
}

export function findProjectBySlug(config: ChannelsConfig, slug: string): { chatId: string; project: Project } | undefined {
  for (const [chatId, project] of Object.entries(config.projects)) {
    if (project.slug === slug) return { chatId, project }
  }
  return undefined
}

export function isMasterChannel(config: ChannelsConfig, chatId: string): boolean {
  return config.master?.chatId === chatId
}

export function commandPrefix(config: ChannelsConfig): string {
  return config.master?.commandPrefix ?? '!project'
}
