import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

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
import { buildGitEnv, gitClone, gitPullFastForward, gitSetRemote, gitStatusSummary } from './git-ops.ts'
import { getCredential, loadCredentials } from './git-credentials.ts'
import { accessFile, archiveDir, projectClaudeMd, projectDir } from './paths.ts'
import { loadSchedules, newScheduleId, saveSchedules, type Schedule } from './schedules-config.ts'

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
  /**
   * Find-or-create a guild text channel by name in the master's guild.
   * If a channel with the given name (case-insensitive) already exists,
   * return its id without creating. Idempotent — survives retries from
   * master claude that fail mid-flow.
   */
  createDiscordChannel?: (name: string, opts?: { parent?: string }) => Promise<string>
  /**
   * Best-effort delete of a guild channel — used to roll back
   * `--new-channel` orphans when the rest of `clone` / `create` fails.
   * Logs and swallows errors; we never want a rollback failure to
   * obscure the original error.
   */
  deleteDiscordChannel?: (chatId: string) => Promise<void>
  /**
   * Snapshot of the project pool's live processes — used by `usage`.
   * Returns one entry per chat_id that has a tracked process (alive
   * or recently exited).
   */
  poolStats?: () => Promise<Array<{
    chatId: string
    slug: string
    alive: boolean
    pid: number | null
    cpuTimeMs?: number
    memoryMb?: number
    uptimeMs?: number
    lastActivityMs: number
  }>>
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
      return { kind: 'reply', text: await handleClone(rest, ctx) }
    case 'remote':
      return { kind: 'reply', text: await handleRemote(rest, ctx) }
    case 'pull':
      return { kind: 'reply', text: await handlePull(rest, ctx) }
    case 'usage':
    case 'ps':
    case 'top':
      return { kind: 'reply', text: await handleUsage(ctx) }
    case 'stop':
      return { kind: 'reply', text: await handleStop(rest, ctx) }
    case 'schedule':
      return { kind: 'reply', text: await handleSchedule(rest, ctx) }
    case 'provider':
      return { kind: 'reply', text: await handleProvider(rest, ctx) }
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
    `${prefix} show   <chat_id-or-slug>      — show config + prompt preview + git status`,
    `${prefix} status <chat_id-or-slug>      — alias for show`,
    `${prefix} create <chat_id-or--new-channel NAME> --slug X --prompt "..." [--model M] [--provider NAME] [--repo-dir PATH]`,
    `${prefix} clone  <chat_id-or--new-channel NAME> --slug X --repo URL [--branch BR] [--creds NAME] [--provider NAME]`,
    `${prefix} set    <chat_id-or-slug> --prompt "..."                — rewrite CLAUDE.md`,
    `${prefix} rename <chat_id-or-slug> --slug NEW                    — rename slug + dir`,
    `${prefix} remote <chat_id-or-slug> [--set URL] [--creds NAME]    — show/set git remote`,
    `${prefix} pull   <chat_id-or-slug>                               — git pull --ff-only`,
    `${prefix} usage                         — resource snapshot of running project subprocesses (alias: ps, top)`,
    `${prefix} stop   <chat_id-or-slug>                               — kill the project's subprocess; lazy-respawns on next message`,
    `${prefix} schedule add <chat_id-or-slug> --at HH:MM --prompt "..." [--max-runs N]   — daily recurring job`,
    `${prefix} schedule list [<chat_id-or-slug>]      — show all schedules (or just one project's)`,
    `${prefix} schedule pause/resume/rm <id>          — toggle or delete a schedule`,
    `${prefix} provider <chat_id-or-slug> [--set ALIAS | --clear]    — switch a project to a different provider (or back to Claude subscription)`,
    `${prefix} rm     <chat_id-or-slug> --yes                         — archive + remove`,
    `${prefix} help                          — this message`,
    '```',
    '_`--new-channel NAME` auto-creates the Discord channel (needs Manage Channels perm)._',
    '_`--repo-dir PATH` attaches a project to an existing local checkout via symlink._',
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
  const providerName = project.provider ?? config.defaults.provider
  if (providerName) {
    const def = config.defaults.providers[providerName]
    if (def) lines.push(`provider: ${providerName} → ${def.baseUrl} (key from \$${def.apiKeyEnv})`)
    else lines.push(`provider: ${providerName} (⚠ not in defaults.providers)`)
  } else {
    lines.push(`provider: (Claude subscription)`)
  }
  if (project.git) {
    lines.push(`remote: ${project.git.remote}`)
    lines.push(`branch: ${project.git.branch}`)
    lines.push(`creds:  ${project.git.credentials}`)
    // If the project dir is a git working tree, show live git status too.
    const dir = projectDir(project.slug)
    if (existsSync(dir)) {
      const status = gitStatusSummary(dir)
      if (status.ok) lines.push(`git: ${status.text}`)
    }
  } else {
    // Not configured in channels.json, but the dir might still be a repo
    // (e.g. attached via --repo-dir). Try a status anyway.
    const dir = projectDir(project.slug)
    if (existsSync(dir)) {
      const status = gitStatusSummary(dir)
      if (status.ok) lines.push(`git: ${status.text} (no remote in channels.json)`)
      else lines.push('git: (no remote configured)')
    } else {
      lines.push('git: (no remote configured)')
    }
  }
  lines.push('')
  lines.push('**system prompt** (first 500 chars):')
  lines.push('```')
  lines.push(promptPreview)
  lines.push('```')
  return lines.join('\n')
}

// ─── mutation verbs ───────────────────────────────────────────────────────

async function handleCreate(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)

  const slug = flags.slug
  if (typeof slug !== 'string') return '`create` requires `--slug NAME`'
  if (!SLUG_PATTERN.test(slug)) return `slug "${slug}" must match ${SLUG_PATTERN}`

  const prompt = typeof flags.prompt === 'string' ? flags.prompt : null
  const model = typeof flags.model === 'string' ? flags.model : undefined
  if (!prompt) return '`create` requires `--prompt "..."` (use --prompt "" if you really want an empty CLAUDE.md)'

  // Channel id can come from a positional argument OR `--new-channel <name>`
  // which auto-creates a fresh guild text channel using the bot's
  // Manage Channels permission. (Idempotent — reuses an existing channel
  // with the same name if one's there.)
  const newChannelName = typeof flags['new-channel'] === 'string' ? flags['new-channel'] : null
  let chatId: string
  let createdChannelNote: string | null = null
  let weCreatedChannel = false

  if (newChannelName !== null) {
    if (!ctx.mutator?.createDiscordChannel) {
      return 'auto-create channel unavailable — bot client not wired into the mutator'
    }
    if (!/^[a-z0-9-]{1,90}$/.test(newChannelName)) {
      return 'channel name must match `[a-z0-9-]{1,90}` (Discord normalizes anything else)'
    }
    try {
      chatId = await ctx.mutator.createDiscordChannel(newChannelName, {
        parent: typeof flags.parent === 'string' ? flags.parent : undefined,
      })
      createdChannelNote = `Channel **#${newChannelName}** (id \`${chatId}\`).`
      weCreatedChannel = true
    } catch (err) {
      const msg = (err as Error).message
      if (/missing(.+)permission|access/i.test(msg)) {
        return `auto-create failed — bot is missing **Manage Channels** permission. Re-tick it under OAuth2 → URL Generator → Bot Permissions, open the regenerated URL and authorize. (${msg})`
      }
      return `auto-create channel failed: ${msg}`
    }
  } else if (positional.length > 0) {
    chatId = positional[0]!
    if (!/^\d{15,25}$/.test(chatId)) return `chat_id must be a Discord snowflake; got "${chatId}"`
  } else {
    return '`create` needs `<chat_id>` (positional) OR `--new-channel <name>` to auto-create one'
  }

  const rollback = async (reason: string): Promise<string> => {
    if (weCreatedChannel && ctx.mutator?.deleteDiscordChannel) {
      try {
        await ctx.mutator.deleteDiscordChannel(chatId)
      } catch (err) {
        process.stderr.write(`create rollback: deleteDiscordChannel failed: ${err}\n`)
      }
    }
    return reason
  }

  // Re-load fresh — caller's snapshot may be stale by the time this runs.
  const config = loadConfig()

  if (config.projects[chatId]) {
    return await rollback(`chat_id ${chatId} is already mapped to project "${config.projects[chatId]!.slug}"`)
  }
  if (findProjectBySlug(config, slug)) {
    return await rollback(`slug "${slug}" is already in use`)
  }

  const dir = projectDir(slug)
  if (existsSync(dir)) {
    return await rollback(`directory ${dir} already exists — pick a different slug or remove it first`)
  }

  // --repo-dir: attach this project to an EXISTING local directory instead
  // of mkdir-ing a fresh one. We symlink `projects/<slug>` → <repo-dir> so
  // claude's cwd is the real working tree (file edits, git status, etc.
  // all hit that dir directly). CLAUDE.md is written INTO that dir unless
  // it already exists (use --force-prompt to overwrite).
  const repoDirRaw = typeof flags['repo-dir'] === 'string' ? flags['repo-dir'] : null
  let repoDirNote: string | null = null
  if (repoDirRaw !== null) {
    let repoDir = repoDirRaw.startsWith('~/') ? repoDirRaw.replace(/^~/, process.env.HOME ?? '') : repoDirRaw
    if (!isAbsolute(repoDir)) repoDir = resolve(repoDir)
    if (!existsSync(repoDir)) return `--repo-dir "${repoDir}" does not exist`
    if (!statSync(repoDir).isDirectory()) return `--repo-dir "${repoDir}" is not a directory`

    // Parent dir must exist (it always should — channelsDir/projects).
    mkdirSync(join(dir, '..'), { recursive: true, mode: 0o700 })
    symlinkSync(repoDir, dir)

    const claudeMd = projectClaudeMd(slug)
    if (existsSync(claudeMd) && flags['force-prompt'] !== true) {
      repoDirNote = `Attached to **${repoDir}**. Kept existing CLAUDE.md (pass \`--force-prompt\` to overwrite).`
    } else {
      writeFileSync(claudeMd, `${prompt.trim()}\n`, { mode: 0o600 })
      repoDirNote = `Attached to **${repoDir}**. Wrote CLAUDE.md (${prompt.length} chars).`
    }
  } else {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // Append a stable Discord-conventions footer so newly-created projects
    // know how to reply, just like cloned ones do.
    const enriched = `${prompt.trim()}\n\n${defaultDiscordFooter()}`
    writeFileSync(projectClaudeMd(slug), `${enriched}\n`, { mode: 0o600 })
  }

  const provider = typeof flags.provider === 'string' ? flags.provider : undefined
  if (provider !== undefined && !config.defaults.providers[provider]) {
    return await rollback(`provider "${provider}" is not in defaults.providers — add it to channels.json first`)
  }

  const updated: ChannelsConfig = {
    ...config,
    projects: {
      ...config.projects,
      [chatId]: {
        slug,
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      },
    },
  }
  saveConfig(updated)

  // Also add the channel to access.json's groups so the gate() check
  // upstream server.ts runs lets messages from this channel through.
  // Without this, the bot silently drops everything in the new channel
  // before it reaches the project pool.
  const accessAdded = ensureChannelInAccessGroups(chatId)

  const lines = [
    `✅ project **${slug}** created for chat ${chatId}.`,
    `Working dir: \`${dir}\`${repoDirNote ? '  (symlink → repo)' : ''}`,
  ]
  if (repoDirNote) lines.push(repoDirNote)
  else lines.push(`CLAUDE.md: ${prompt.length} chars`)
  lines.push(`Model: ${model ?? config.defaults.model}`)
  lines.push(
    accessAdded
      ? `Access: added \`${chatId}\` to access.json groups (requireMention=false).`
      : `Access: \`${chatId}\` already in access.json groups.`,
  )
  if (createdChannelNote) lines.unshift(createdChannelNote)
  lines.push(`_Send a message in that channel to spawn the first subprocess._`)
  return lines.join('\n')
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

// ─── git verbs (phase 5) ──────────────────────────────────────────────────

async function handleClone(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)

  const slug = flags.slug
  if (typeof slug !== 'string') return '`clone` requires `--slug NAME`'
  if (!SLUG_PATTERN.test(slug)) return `slug "${slug}" must match ${SLUG_PATTERN}`

  const repo = flags.repo
  if (typeof repo !== 'string') return '`clone` requires `--repo URL`'

  const branch = typeof flags.branch === 'string' ? flags.branch : undefined
  const credsAlias = typeof flags.creds === 'string' ? flags.creds : undefined
  const promptArg = typeof flags.prompt === 'string' ? flags.prompt : null
  const model = typeof flags.model === 'string' ? flags.model : undefined

  // Channel id (positional or auto-create) — same shape as create.
  const newChannelName = typeof flags['new-channel'] === 'string' ? flags['new-channel'] : null
  let chatId: string
  let createdChannelNote: string | null = null

  // Track whether we auto-created the channel — if anything below fails
  // we roll back by deleting it (so retries don't pile up orphan channels).
  let weCreatedChannel = false

  if (newChannelName !== null) {
    if (!ctx.mutator?.createDiscordChannel) return 'auto-create channel unavailable'
    if (!/^[a-z0-9-]{1,90}$/.test(newChannelName)) return 'channel name must match `[a-z0-9-]{1,90}`'
    try {
      chatId = await ctx.mutator.createDiscordChannel(newChannelName, {
        parent: typeof flags.parent === 'string' ? flags.parent : undefined,
      })
      createdChannelNote = `Channel **#${newChannelName}** (id \`${chatId}\`).`
      weCreatedChannel = true
    } catch (err) {
      return `auto-create channel failed: ${(err as Error).message}`
    }
  } else if (positional.length > 0) {
    chatId = positional[0]!
    if (!/^\d{15,25}$/.test(chatId)) return `chat_id must be a Discord snowflake; got "${chatId}"`
  } else {
    return '`clone` needs `<chat_id>` (positional) OR `--new-channel <name>`'
  }

  const rollback = async (reason: string): Promise<string> => {
    if (weCreatedChannel && ctx.mutator?.deleteDiscordChannel) {
      try {
        await ctx.mutator.deleteDiscordChannel(chatId)
      } catch (err) {
        process.stderr.write(`clone rollback: deleteDiscordChannel failed: ${err}\n`)
      }
    }
    return reason
  }

  const config = loadConfig()
  if (config.projects[chatId]) {
    return await rollback(`chat_id ${chatId} is already mapped to project "${config.projects[chatId]!.slug}"`)
  }
  if (findProjectBySlug(config, slug)) {
    return await rollback(`slug "${slug}" is already in use`)
  }

  const dir = projectDir(slug)
  if (existsSync(dir)) return await rollback(`directory ${dir} already exists`)

  // Resolve creds → env.
  let credEnv: NodeJS.ProcessEnv = process.env
  let cleanupCreds = () => {}
  if (credsAlias) {
    try {
      const creds = loadCredentials()
      const cred = getCredential(creds, credsAlias)
      const built = buildGitEnv(cred)
      credEnv = built.env
      cleanupCreds = built.cleanup
    } catch (err) {
      return await rollback(`credentials lookup failed: ${(err as Error).message}`)
    }
  }

  try {
    const result = gitClone({ repo, target: dir, branch, env: credEnv })
    if (!result.ok) {
      return await rollback(`git clone failed (exit ${result.code}):\n\`\`\`\n${(result.stderr || result.stdout).slice(0, 1500)}\n\`\`\``)
    }
  } finally {
    cleanupCreds()
  }

  // Per-project CLAUDE.md inside the cloned tree (only if absent).
  const claudeMd = projectClaudeMd(slug)
  let claudeMdNote: string
  if (existsSync(claudeMd)) {
    claudeMdNote = '_kept existing CLAUDE.md in the repo._'
  } else {
    const prompt = promptArg ?? defaultClonePrompt(slug, repo, branch ?? 'main')
    writeFileSync(claudeMd, `${prompt.trim()}\n`, { mode: 0o600 })
    claudeMdNote = `wrote CLAUDE.md (${prompt.length} chars)`
  }

  const cloneProvider = typeof flags.provider === 'string' ? flags.provider : undefined
  if (cloneProvider !== undefined && !config.defaults.providers[cloneProvider]) {
    return `provider "${cloneProvider}" is not in defaults.providers — add it to channels.json first`
  }

  // Register in channels.json with git block.
  const updated: ChannelsConfig = {
    ...config,
    projects: {
      ...config.projects,
      [chatId]: {
        slug,
        ...(model ? { model } : {}),
        ...(cloneProvider ? { provider: cloneProvider } : {}),
        git: {
          remote: repo,
          branch: branch ?? 'main',
          // Honour defaults.git.credentials when the operator didn't
          // pass --creds. Hardcoding "github-default" was a leftover
          // from before defaults.git existed.
          credentials: credsAlias ?? config.defaults.git.credentials ?? 'ssh-default',
        },
      },
    },
  }
  saveConfig(updated)
  ensureChannelInAccessGroups(chatId)

  const status = gitStatusSummary(dir)
  const lines: string[] = []
  if (createdChannelNote) lines.push(createdChannelNote)
  lines.push(`✅ project **${slug}** cloned from ${repo} for chat ${chatId}.`)
  lines.push(`Working dir: \`${dir}\``)
  lines.push(claudeMdNote)
  if (status.ok) lines.push(status.text)
  lines.push('_Send a message in that channel to spawn the first subprocess._')
  return lines.join('\n')
}

async function handleRemote(rest: string[], _ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`remote` needs a chat_id or slug'
  const target = positional[0]!
  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const setUrl = typeof flags.set === 'string' ? flags.set : null
  const credsAlias = typeof flags.creds === 'string' ? flags.creds : null

  if (!setUrl && !credsAlias) {
    // Show only.
    if (!entry.project.git) return `**${entry.project.slug}**: no remote configured`
    return [
      `**${entry.project.slug}** remote:`,
      `url: ${entry.project.git.remote}`,
      `branch: ${entry.project.git.branch}`,
      `creds: ${entry.project.git.credentials}`,
    ].join('\n')
  }

  // Mutate. Requires an existing git block (use clone for first remote setup).
  if (!entry.project.git && !setUrl) {
    return 'this project has no git block yet — pass `--set URL --creds NAME` to attach one'
  }
  const newGit = {
    remote: setUrl ?? entry.project.git!.remote,
    branch: entry.project.git?.branch ?? 'main',
    credentials: credsAlias ?? entry.project.git?.credentials ?? 'github-default',
  }

  // Push the URL change to the actual git working tree's `origin` remote
  // so commands run inside the project pick it up automatically.
  if (setUrl) {
    const dir = projectDir(entry.project.slug)
    if (existsSync(dir)) {
      const r = gitSetRemote(dir, 'origin', setUrl)
      if (!r.ok) return `git remote set-url failed: ${(r.stderr || r.stdout).slice(0, 800)}`
    }
  }

  const updated: ChannelsConfig = {
    ...config,
    projects: { ...config.projects, [entry.chatId]: { ...entry.project, git: newGit } },
  }
  saveConfig(updated)
  return `✅ remote updated for **${entry.project.slug}**: \`${newGit.remote}\` (creds=${newGit.credentials})`
}

async function handlePull(rest: string[], _ctx: MasterContext): Promise<string> {
  const { positional } = parseFlags(rest)
  if (positional.length === 0) return '`pull` needs a chat_id or slug'
  const target = positional[0]!
  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const dir = projectDir(entry.project.slug)
  if (!existsSync(dir)) return `working dir missing: ${dir}`

  let credEnv: NodeJS.ProcessEnv = process.env
  let cleanupCreds = () => {}
  if (entry.project.git?.credentials) {
    try {
      const creds = loadCredentials()
      const cred = getCredential(creds, entry.project.git.credentials)
      const built = buildGitEnv(cred)
      credEnv = built.env
      cleanupCreds = built.cleanup
    } catch (err) {
      return `credentials lookup failed: ${(err as Error).message}`
    }
  }

  try {
    const r = gitPullFastForward(dir, entry.project.git?.branch, credEnv)
    if (!r.ok) {
      return `git pull --ff-only failed (exit ${r.code}):\n\`\`\`\n${(r.stderr || r.stdout).slice(0, 1500)}\n\`\`\``
    }
    const status = gitStatusSummary(dir)
    return `✅ pulled.\n${(r.stdout || '(no changes)').slice(0, 600)}\n${status.text}`
  } finally {
    cleanupCreds()
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Default system prompt baked into projects/<slug>/CLAUDE.md when
 * `!project clone` is invoked without an explicit --prompt. Tells the
 * subprocess claude how the repo, the operator, and git auth are set up
 * so it can do real work without bouncing back for clarification.
 */
async function handleUsage(ctx: MasterContext): Promise<string> {
  if (!ctx.mutator?.poolStats) {
    return 'pool stats not wired into the mutator (run from a live bot context)'
  }
  const rows = await ctx.mutator.poolStats()
  if (rows.length === 0) return '_no project subprocesses are currently spawned. (They start lazily on first message and idle-evict after 15min by default.)_'

  const now = Date.now()
  const fmtAgo = (ms: number) => {
    const s = Math.max(0, Math.round((now - ms) / 1000))
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.round(s / 60)}m`
    return `${Math.round(s / 3600)}h`
  }
  const fmtUp = (ms?: number) => {
    if (!ms) return '?'
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.round(s / 60)}m`
    return `${(s / 3600).toFixed(1)}h`
  }

  const lines = ['**Project subprocesses:**', '```']
  lines.push('slug                 alive  pid       mem(MB)  cpu(s)  up      last_act')
  for (const r of rows.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const slug = r.slug.padEnd(20).slice(0, 20)
    const alive = r.alive ? 'yes' : 'no '
    const pid = (r.pid ?? '-').toString().padStart(8)
    const mem = r.memoryMb !== undefined ? r.memoryMb.toFixed(0).padStart(7) : '      ?'
    const cpu = r.cpuTimeMs !== undefined ? (r.cpuTimeMs / 1000).toFixed(1).padStart(6) : '     ?'
    const up = fmtUp(r.uptimeMs).padStart(6)
    const last = fmtAgo(r.lastActivityMs).padStart(8)
    lines.push(`${slug}  ${alive}    ${pid}  ${mem}  ${cpu}  ${up}  ${last} ago`)
  }
  lines.push('```')
  return lines.join('\n')
}

/**
 * `!project schedule <subverb> ...` — daily HH:MM scheduler.
 *
 * Shapes:
 *   schedule add <chat_id-or-slug> --at HH:MM --prompt "..." [--max-runs N]
 *   schedule list [<chat_id-or-slug>]
 *   schedule pause <id>
 *   schedule resume <id>
 *   schedule rm <id>
 */
async function handleSchedule(rest: string[], _ctx: MasterContext): Promise<string> {
  const sub = rest[0]
  const tail = rest.slice(1)
  switch (sub) {
    case 'add':
      return await scheduleAdd(tail)
    case 'list':
    case undefined:
      return scheduleList(tail)
    case 'pause':
      return scheduleSetEnabled(tail, false)
    case 'resume':
      return scheduleSetEnabled(tail, true)
    case 'rm':
    case 'remove':
    case 'delete':
      return scheduleRemove(tail)
    default:
      return `unknown schedule subverb \`${sub}\`. valid: add, list, pause, resume, rm`
  }
}

async function scheduleAdd(tail: string[]): Promise<string> {
  const { positional, flags } = parseFlags(tail)
  if (positional.length === 0) return '`schedule add` needs a chat_id or slug as the first argument'

  const at = flags.at
  if (typeof at !== 'string') return '`schedule add` requires `--at HH:MM` (24h, host local time)'
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(at)) return `\`--at\` must be HH:MM, got "${at}"`

  const prompt = typeof flags.prompt === 'string' ? flags.prompt : null
  if (!prompt) return '`schedule add` requires `--prompt "..."` — what to ask the agent each fire'

  const maxRunsRaw = flags['max-runs']
  let maxRuns: number | null = null
  if (typeof maxRunsRaw === 'string') {
    const n = Number(maxRunsRaw)
    if (!Number.isInteger(n) || n <= 0) return `\`--max-runs\` must be a positive integer; got "${maxRunsRaw}"`
    maxRuns = n
  }

  const config = loadConfig()
  const target = positional[0]!
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const file = loadSchedules()
  const id = newScheduleId()
  const sched: Schedule = {
    id,
    chatId: entry.chatId,
    at,
    prompt,
    enabled: true,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
    maxRuns,
    runCount: 0,
  }
  file.schedules.push(sched)
  saveSchedules(file)

  return [
    `✅ scheduled job **${id}**`,
    `project: **${entry.project.slug}** (chat \`${entry.chatId}\`)`,
    `daily at: ${at} (host local time)`,
    `prompt: ${prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}`,
    maxRuns ? `max runs: ${maxRuns}` : '_no run cap (use `pause`/`rm` to stop)_',
  ].join('\n')
}

function scheduleList(tail: string[]): string {
  const { positional } = parseFlags(tail)
  const config = loadConfig()
  const filterChatId = positional.length > 0
    ? (resolveTarget(config, positional[0]!)?.chatId ?? null)
    : null

  const file = loadSchedules()
  let rows = file.schedules
  if (filterChatId) rows = rows.filter((s) => s.chatId === filterChatId)

  if (rows.length === 0) {
    return filterChatId
      ? `_no schedules for "${positional[0]}"._`
      : '_no schedules configured. add one with `schedule add <slug> --at HH:MM --prompt "..."`._'
  }

  const lines = ['**Schedules:**', '```']
  lines.push('id                              slug                 at     enabled  runs   last_run')
  for (const s of rows.sort((a, b) => a.at.localeCompare(b.at))) {
    const project = config.projects[s.chatId]
    const slug = (project?.slug ?? '?').padEnd(20).slice(0, 20)
    const id = s.id.padEnd(30).slice(0, 30)
    const at = s.at.padEnd(5)
    const en = s.enabled ? 'yes' : 'no '
    const runs = s.maxRuns ? `${s.runCount}/${s.maxRuns}` : `${s.runCount}`
    const last = s.lastRunAt ?? '(never)'
    lines.push(`${id}  ${slug}  ${at}  ${en}    ${runs.padStart(5)}  ${last}`)
  }
  lines.push('```')
  return lines.join('\n')
}

function scheduleSetEnabled(tail: string[], enabled: boolean): string {
  if (tail.length === 0) return `\`${enabled ? 'resume' : 'pause'}\` needs a schedule id`
  const id = tail[0]!
  const file = loadSchedules()
  const s = file.schedules.find((x) => x.id === id)
  if (!s) return `no schedule with id \`${id}\``
  s.enabled = enabled
  saveSchedules(file)
  return `✅ schedule **${id}** ${enabled ? 'resumed' : 'paused'}`
}

function scheduleRemove(tail: string[]): string {
  if (tail.length === 0) return '`rm` needs a schedule id'
  const id = tail[0]!
  const file = loadSchedules()
  const idx = file.schedules.findIndex((x) => x.id === id)
  if (idx < 0) return `no schedule with id \`${id}\``
  const removed = file.schedules.splice(idx, 1)[0]!
  saveSchedules(file)
  return `🗑 schedule **${removed.id}** removed (was for chat \`${removed.chatId}\` at ${removed.at})`
}

/**
 * `!project provider <slug>` — view the current provider routing
 * `!project provider <slug> --set <alias>` — switch (kills the running
 *     subprocess so the next message respawns with the new env)
 * `!project provider <slug> --clear` — back to Claude subscription
 *
 * Use case: claude hits a rate limit → switch the project to a
 * fallback provider with a single command instead of editing
 * channels.json + restarting.
 */
async function handleProvider(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) {
    return '`provider` needs a chat_id or slug. usage: `provider <slug> [--set <alias> | --clear]`'
  }
  const target = positional[0]!
  const setAlias = typeof flags.set === 'string' ? flags.set : null
  const clear = flags.clear === true

  if (setAlias && clear) return 'pass either `--set <alias>` or `--clear`, not both'

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  // Read-only: show current routing.
  if (!setAlias && !clear) {
    const name = entry.project.provider ?? config.defaults.provider
    if (!name) return `**${entry.project.slug}**: provider = (Claude subscription)`
    const def = config.defaults.providers[name]
    if (!def) return `**${entry.project.slug}**: provider = ${name} ⚠ not in defaults.providers`
    return `**${entry.project.slug}**: provider = ${name} → ${def.baseUrl} (key from $${def.apiKeyEnv})`
  }

  // Mutate. --set must reference a known alias.
  if (setAlias) {
    if (!config.defaults.providers[setAlias]) {
      const known = Object.keys(config.defaults.providers).join(', ') || '(none configured)'
      return `provider alias "${setAlias}" is not in defaults.providers. known: ${known}`
    }
    const def = config.defaults.providers[setAlias]!
    if (!process.env[def.apiKeyEnv]) {
      return `provider "${setAlias}" needs env var \`${def.apiKeyEnv}\` set on the bot process — restart the bot with that var defined`
    }
  }

  const updatedProject = { ...entry.project }
  if (setAlias) {
    updatedProject.provider = setAlias
  } else {
    delete updatedProject.provider
  }
  const updated: ChannelsConfig = {
    ...config,
    projects: { ...config.projects, [entry.chatId]: updatedProject },
  }
  saveConfig(updated)

  // Kill the running subprocess so next message respawns with the
  // new env. Without this the live tmux+claude keeps using the old
  // provider until idle-evict fires.
  let respawnNote = '_subprocess will respawn on next message with the new provider._'
  if (ctx.mutator?.killProject) {
    try {
      await ctx.mutator.killProject(entry.chatId)
      respawnNote = '_subprocess killed; next message will spawn it with the new provider._'
    } catch (err) {
      respawnNote = `_kill failed: ${(err as Error).message}; restart the project manually._`
    }
  }

  if (clear) {
    return [`✅ **${entry.project.slug}** now uses Claude subscription auth.`, respawnNote].join('\n')
  }
  const def = config.defaults.providers[setAlias!]!
  return [
    `✅ **${entry.project.slug}** routed to provider **${setAlias}** → ${def.baseUrl}`,
    respawnNote,
  ].join('\n')
}

async function handleStop(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional } = parseFlags(rest)
  if (positional.length === 0) return '`stop` needs a chat_id or slug'
  const target = positional[0]!
  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  if (!ctx.mutator?.killProject) return 'kill not wired (run from a live bot context)'
  try {
    await ctx.mutator.killProject(entry.chatId)
  } catch (err) {
    return `kill failed: ${(err as Error).message}`
  }
  return `✅ stopped **${entry.project.slug}**. The next message in that channel will spawn a fresh subprocess.`
}

/**
 * Discord-conventions footer baked into every freshly-created project's
 * CLAUDE.md so Claude knows how to reply (mcd vs upstream tools) and can
 * use the bot's tool surface immediately.
 */
function defaultDiscordFooter(): string {
  return [
    '# Discord conventions',
    '',
    'Inbound messages arrive wrapped in `<channel source="discord" ...>BODY</channel>` envelopes — BODY is what the operator typed. Respond by calling `mcp__mcd__reply` with `{ text, reply_to? }`. Do NOT call `mcp__discord__reply`. Don\'t print transcript text outside the reply tool — Discord users only see what `mcp__mcd__reply` emits. Keep replies brief.',
    '',
    'Other available tools (when needed): `mcp__mcd__react`, `mcp__mcd__edit_message`, `mcp__mcd__download_attachment`, `mcp__mcd__fetch_messages`.',
    '',
    '# Git + shell',
    '',
    'You have Bash (auto permission mode), `git`, and `gh` (GitHub CLI). Authentication is preconfigured via `GIT_ASKPASS` or `GIT_SSH_COMMAND` for HTTPS / SSH respectively — `git push` and `gh pr create` work without token prompts. For commits, prefer feature branches over committing to `main`. `git clone` works for pulling additional repos when you need to inspect dependencies.',
  ].join('\n')
}

function defaultClonePrompt(slug: string, repo: string, baseBranch: string): string {
  return [
    `You are the assistant for the **${slug}** project.`,
    '',
    `Working directory: this is a git checkout of ${repo} (base branch \`${baseBranch}\`). Commands run from here.`,
    'You can use Bash freely (auto permission mode). Useful binaries on PATH: git, gh (GitHub CLI), node/npm, bun, python.',
    '',
    '# Git workflow',
    '',
    '- Always `git pull --ff-only origin ' + baseBranch + '` before starting work.',
    '- Make changes on a feature branch — never commit directly to `' + baseBranch + '`. Branch names: `claude/<short-task>` or `<operator-handle>/<topic>`.',
    '- Stage and commit small focused units. Use clear commit messages with the *why*, not just the *what*.',
    '- Push the branch (`git push -u origin <branch>`). Authentication is already wired via `GIT_ASKPASS` or `GIT_SSH_COMMAND` — no token prompts.',
    '- Open a pull request with `gh pr create --base ' + baseBranch + ' --title "..." --body "..."`. Reply in Discord with the PR URL.',
    '- For small fixes, request review in the PR body or `@mention` the operator.',
    '',
    '# Cloning additional repos',
    '',
    'If you need to look at another repo: `git clone <url>` into a sibling directory under `~/.claude/channels/discord-multi/projects/' + slug + '/_deps/<name>` or wherever fits. Don\'t pollute this working tree with unrelated code.',
    '',
    '# Discord conventions',
    '',
    'Inbound messages arrive wrapped in `<channel source="discord" ...>BODY</channel>` envelopes — BODY is what the operator typed. Respond by calling `mcp__mcd__reply` with `{ text, reply_to? }`. Do NOT call `mcp__discord__reply`. Don\'t print transcript text outside the reply tool — Discord users only see what `mcp__mcd__reply` emits. Keep replies brief; for long output, post the highlights and offer to dig in.',
    '',
    'Other tools (`mcp__mcd__react`, `mcp__mcd__edit_message`, `mcp__mcd__download_attachment`, `mcp__mcd__fetch_messages`) are available when useful — for example `download_attachment` to grab an inbound file, or `react` for a fast acknowledgment before a long task.',
  ].join('\n')
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
