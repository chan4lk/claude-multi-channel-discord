import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseFlags, splitArgv } from './argv.ts'
import {
  commandPrefix,
  findProjectByChatId,
  findProjectBySlug,
  isMasterChannel,
  loadConfig,
  saveConfig,
  SLUG_PATTERN,
  type ChannelsConfig,
  type Project,
} from './channels-config.ts'
import { accessFile, archiveDir, projectClaudeMd, projectDir } from './paths.ts'

export type MasterCommandResult =
  | { kind: 'no-master-configured' }
  | { kind: 'not-master' }
  | { kind: 'no-prefix' }
  | { kind: 'unauthorized' }
  | { kind: 'reply'; text: string }

export interface MasterContext {
  chatId: string
  userId: string
  config: ChannelsConfig
  authorizedUsers: string[]
  /**
   * Side-effects mutation verbs need. Optional so callers using only the
   * read-only verbs (or unit tests of the parser) can omit it.
   */
  mutator?: MasterMutator
}

export interface MasterMutator {
  /** Kill the project's running subprocess so next message lazy-respawns. */
  killProject: (chatId: string) => Promise<void>
}

const READ_VERBS = ['list', 'show', 'status', 'help'] as const
const MUTATION_VERBS = ['create', 'set', 'rename', 'rm'] as const
const PHASE_5_VERBS = ['clone', 'remote', 'pull'] as const

export async function handleMasterCommand(
  content: string,
  ctx: MasterContext,
): Promise<MasterCommandResult> {
  const { config, chatId, userId } = ctx

  if (!config.master) return { kind: 'no-master-configured' }
  if (!isMasterChannel(config, chatId)) return { kind: 'not-master' }

  const prefix = commandPrefix(config)
  const trimmed = content.trim()
  if (!trimmed.startsWith(prefix)) return { kind: 'no-prefix' }

  if (ctx.authorizedUsers.length === 0 || !ctx.authorizedUsers.includes(userId)) {
    return { kind: 'unauthorized' }
  }

  const after = trimmed.slice(prefix.length).trim()
  let argv: string[]
  try {
    argv = splitArgv(after)
  } catch (err) {
    return { kind: 'reply', text: `parse error: ${(err as Error).message}` }
  }

  if (argv.length === 0 || argv[0] === 'help') {
    return { kind: 'reply', text: helpText(prefix) }
  }

  const verb = argv[0]!
  const rest = argv.slice(1)

  switch (verb) {
    case 'list':
      return { kind: 'reply', text: handleList(config) }
    case 'show':
    case 'status':
      return { kind: 'reply', text: handleShow(config, rest) }
    case 'create':
      return { kind: 'reply', text: await handleCreate(rest, ctx) }
    case 'set':
      return { kind: 'reply', text: await handleSet(rest, ctx) }
    case 'rename':
      return { kind: 'reply', text: await handleRename(rest, ctx) }
    case 'rm':
      return { kind: 'reply', text: await handleRm(rest, ctx) }
    case 'clone':
    case 'remote':
    case 'pull':
      return {
        kind: 'reply',
        text: `\`${verb}\` lives in phase 5 (git layer). Not yet implemented.`,
      }
    default:
      return {
        kind: 'reply',
        text: `unknown verb \`${verb}\`. try one of: ${[...READ_VERBS, ...MUTATION_VERBS, ...PHASE_5_VERBS].join(', ')}`,
      }
  }
}

function helpText(prefix: string): string {
  return [
    '**Master commands**',
    '```',
    `${prefix} list                          — list all projects`,
    `${prefix} show   <chat_id-or-slug>      — show one project's config + prompt preview`,
    `${prefix} status <chat_id-or-slug>      — alias for show until git lands`,
    `${prefix} create <chat_id> --slug X --prompt "..." [--model M]   — register a new project`,
    `${prefix} set    <chat_id-or-slug> --prompt "..."                — rewrite CLAUDE.md (restarts subprocess)`,
    `${prefix} rename <chat_id-or-slug> --slug NEW                    — rename slug + dir`,
    `${prefix} rm     <chat_id-or-slug> --yes                         — archive project, kill subprocess`,
    `${prefix} help                          — this message`,
    '```',
    '_Phase 5 (`clone`, `remote`, `pull`) requires the git layer — coming next._',
  ].join('\n')
}

function handleList(config: ChannelsConfig): string {
  const entries = Object.entries(config.projects)
  if (entries.length === 0) return '_no projects configured yet — bootstrap with `/discord:project init` from a terminal._'

  const lines = ['**Projects:**', '```']
  const masterId = config.master?.chatId
  for (const [chatId, project] of entries.sort((a, b) => a[1].slug.localeCompare(b[1].slug))) {
    const tag = chatId === masterId ? '★' : ' '
    const model = project.model ?? config.defaults.model
    const repo = project.git?.remote ?? '(no remote)'
    lines.push(`${tag} ${project.slug.padEnd(20)} chat=${chatId}  model=${model}  ${repo}`)
  }
  lines.push('```')
  lines.push(`★ = master channel · ${entries.length} project${entries.length === 1 ? '' : 's'}`)
  return lines.join('\n')
}

function handleShow(config: ChannelsConfig, rest: string[]): string {
  const { positional } = parseFlags(rest)
  if (positional.length === 0) return '`show` needs an argument: a chat_id or a slug'
  const target = positional[0]!

  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const { chatId, project } = entry
  const model = project.model ?? config.defaults.model
  const promptPreview = readClaudeMdPreview(project.slug)

  const lines = [
    `**${project.slug}**${chatId === config.master?.chatId ? ' (master)' : ''}`,
    `chat_id: \`${chatId}\``,
    `model: ${model}`,
  ]
  if (project.git) {
    lines.push(`remote: ${project.git.remote}`)
    lines.push(`branch: ${project.git.branch}`)
    lines.push(`creds:  ${project.git.credentials}`)
  } else {
    lines.push('git: (no remote configured)')
  }
  lines.push('')
  lines.push('**system prompt** (first 500 chars):')
  lines.push('```')
  lines.push(promptPreview)
  lines.push('```')
  return lines.join('\n')
}

// ─── mutation verbs ───────────────────────────────────────────────────────

async function handleCreate(rest: string[], _ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`create` needs a chat_id as the first argument'
  const chatId = positional[0]!
  if (!/^\d{15,25}$/.test(chatId)) return `chat_id must be a Discord snowflake; got "${chatId}"`

  const slug = flags.slug
  if (typeof slug !== 'string') return '`create` requires `--slug NAME`'
  if (!SLUG_PATTERN.test(slug)) return `slug "${slug}" must match ${SLUG_PATTERN}`

  const prompt = typeof flags.prompt === 'string' ? flags.prompt : null
  const model = typeof flags.model === 'string' ? flags.model : undefined
  if (!prompt) return '`create` requires `--prompt "..."` (use --prompt "" if you really want an empty CLAUDE.md)'

  // Re-load fresh — caller's snapshot may be stale by the time this runs.
  const config = loadConfig()

  if (config.projects[chatId]) {
    return `chat_id ${chatId} is already mapped to project "${config.projects[chatId]!.slug}"`
  }
  if (findProjectBySlug(config, slug)) {
    return `slug "${slug}" is already in use`
  }

  const dir = projectDir(slug)
  if (existsSync(dir)) {
    return `directory ${dir} already exists — pick a different slug or remove it first`
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(projectClaudeMd(slug), `${prompt.trim()}\n`, { mode: 0o600 })

  const updated: ChannelsConfig = {
    ...config,
    projects: {
      ...config.projects,
      [chatId]: { slug, ...(model ? { model } : {}) },
    },
  }
  saveConfig(updated)

  // Also add the channel to access.json's groups so the gate() check
  // upstream server.ts runs lets messages from this channel through.
  // Without this, the bot silently drops everything in the new channel
  // before it reaches the project pool.
  const accessAdded = ensureChannelInAccessGroups(chatId)

  return [
    `✅ project **${slug}** created for chat ${chatId}.`,
    `Working dir: \`${dir}\``,
    `CLAUDE.md: ${prompt.length} chars`,
    `Model: ${model ?? config.defaults.model}`,
    accessAdded ? `Access: added \`${chatId}\` to access.json groups (requireMention=false).` : `Access: \`${chatId}\` already in access.json groups.`,
    `_Send a message in that channel to spawn the first subprocess._`,
  ].join('\n')
}

/**
 * Add chatId to access.json's groups map if not present. Mirrors what
 * `/discord:access group add <id> --no-mention` would do via the upstream
 * skill — we just write the same JSON shape directly. Returns true if we
 * actually wrote a change, false if the entry was already present.
 */
function ensureChannelInAccessGroups(chatId: string): boolean {
  const path = accessFile()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  let access: {
    dmPolicy?: string
    allowFrom?: string[]
    groups?: Record<string, { requireMention?: boolean; allowFrom?: string[] }>
    pending?: Record<string, unknown>
    [k: string]: unknown
  }
  try {
    access = JSON.parse(raw)
  } catch {
    return false
  }
  if (!access.groups) access.groups = {}
  if (access.groups[chatId]) return false
  access.groups[chatId] = { requireMention: false, allowFrom: [] }
  writeFileSync(path, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 })
  return true
}

async function handleSet(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`set` needs a chat_id or slug'
  const target = positional[0]!

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const prompt = typeof flags.prompt === 'string' ? flags.prompt : null
  if (prompt === null) return '`set` requires `--prompt "..."`'

  writeFileSync(projectClaudeMd(entry.project.slug), `${prompt.trim()}\n`, { mode: 0o600 })

  // Trigger a respawn so the new prompt takes effect on the next message.
  // CLAUDE.md is read at session start; an in-flight session would otherwise
  // keep using the old text.
  let respawnNote = '_subprocess will respawn on next message._'
  if (flags['no-restart'] !== true && ctx.mutator) {
    try {
      await ctx.mutator.killProject(entry.chatId)
      respawnNote = '_subprocess killed; next message will spawn it with the new prompt._'
    } catch (err) {
      respawnNote = `_kill failed: ${(err as Error).message}; restart manually if needed._`
    }
  }

  return [`✅ rewrote CLAUDE.md for **${entry.project.slug}** (${prompt.length} chars).`, respawnNote].join('\n')
}

async function handleRename(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`rename` needs a chat_id or slug'
  const target = positional[0]!

  const newSlug = flags.slug
  if (typeof newSlug !== 'string') return '`rename` requires `--slug NEW`'
  if (!SLUG_PATTERN.test(newSlug)) return `slug "${newSlug}" must match ${SLUG_PATTERN}`

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`
  if (entry.project.slug === newSlug) return `project ${target} already has slug "${newSlug}"`
  if (findProjectBySlug(config, newSlug)) return `slug "${newSlug}" is already in use`

  // Kill before moving so the running subprocess doesn't have a vanishing cwd.
  if (ctx.mutator) {
    try {
      await ctx.mutator.killProject(entry.chatId)
    } catch (err) {
      return `kill before rename failed: ${(err as Error).message}`
    }
  }

  const oldDir = projectDir(entry.project.slug)
  const newDir = projectDir(newSlug)
  if (existsSync(oldDir)) {
    if (existsSync(newDir)) return `target directory ${newDir} already exists`
    renameSync(oldDir, newDir)
  }

  const updated: ChannelsConfig = {
    ...config,
    projects: {
      ...config.projects,
      [entry.chatId]: { ...entry.project, slug: newSlug },
    },
  }
  saveConfig(updated)

  return `✅ renamed **${entry.project.slug}** → **${newSlug}**.`
}

async function handleRm(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`rm` needs a chat_id or slug'
  const target = positional[0]!
  if (flags.yes !== true) {
    return `_destructive: pass \`--yes\` to confirm._\nWill archive the project's working dir and remove it from channels.json. CLAUDE.md content + git history (if any) are preserved under \`projects/.archive/\`.`
  }

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  if (entry.chatId === config.master?.chatId) {
    return `refusing to rm the master project. If you really want to repoint master, edit channels.json by hand.`
  }

  if (ctx.mutator) {
    try {
      await ctx.mutator.killProject(entry.chatId)
    } catch (err) {
      return `kill before rm failed: ${(err as Error).message}`
    }
  }

  const oldDir = projectDir(entry.project.slug)
  if (existsSync(oldDir)) {
    mkdirSync(archiveDir(), { recursive: true, mode: 0o700 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const archiveTarget = join(archiveDir(), `${entry.project.slug}-${stamp}`)
    renameSync(oldDir, archiveTarget)
  }

  const projects = { ...config.projects }
  delete projects[entry.chatId]
  saveConfig({ ...config, projects })

  // Drop the channel from access.json groups too, so the gate stops
  // accepting messages from it (the bot would otherwise still relay
  // them to the legacy MCP path or, in standalone mode, drop them with
  // a confusing diagnostic).
  removeChannelFromAccessGroups(entry.chatId)

  return `✅ archived project **${entry.project.slug}** and removed from channels.json.\n_(working tree moved under \`projects/.archive/\` — manual cleanup if you want it gone.)_`
}

function removeChannelFromAccessGroups(chatId: string): void {
  const path = accessFile()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return
  }
  let access: {
    groups?: Record<string, unknown>
    [k: string]: unknown
  }
  try {
    access = JSON.parse(raw)
  } catch {
    return
  }
  if (!access.groups || !access.groups[chatId]) return
  delete access.groups[chatId]
  writeFileSync(path, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 })
}

// ─── helpers ──────────────────────────────────────────────────────────────

function resolveTarget(
  config: ChannelsConfig,
  target: string,
): { chatId: string; project: Project } | undefined {
  if (/^\d{15,25}$/.test(target)) {
    const project = findProjectByChatId(config, target)
    if (project) return { chatId: target, project }
    return undefined
  }
  return findProjectBySlug(config, target)
}

function readClaudeMdPreview(slug: string, max = 500): string {
  const path = projectClaudeMd(slug)
  if (!existsSync(path)) return '(no CLAUDE.md on disk)'
  try {
    const stat = statSync(path)
    if (stat.size === 0) return '(empty)'
    const raw = readFileSync(path, 'utf8')
    if (raw.length <= max) return raw.trim()
    return `${raw.slice(0, max).trim()}\n… [+${raw.length - max} chars truncated]`
  } catch (err) {
    return `(read failed: ${(err as Error).message})`
  }
}
