import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { parseFlags, splitArgv } from './argv.ts'
import { type MemoryStore, type MemoryType } from './memory-store.ts'
import { backupMemory, type R2Config } from './memory-backup.ts'
import {
  commandPrefix,
  findProjectByChatId,
  findProjectBySlug,
  isMasterChannel,
  loadConfig,
  resolveCollabTarget,
  saveConfig,
  SLUG_PATTERN,
  type AutopilotConfig,
  type ChannelsConfig,
  type ProgressMode,
  type Project,
} from './channels-config.ts'
import { assertSafeGitRef, buildGitEnv, gitClone, gitPullFastForward, gitSetRemote, gitStatusSummary } from './git-ops.ts'
import { describePrAuth, getCredential, loadCredentials, saveCredentials, type PrApi } from './git-credentials.ts'
import { accessFile, archiveDir, channelsDir, projectClaudeMd, projectDir, projectGoalFile } from './paths.ts'
import { IntervalSchema, loadSchedules, newScheduleId, saveSchedules, validateCron, type Schedule } from './schedules-config.ts'
import { buildAttentionReport } from './heartbeat.ts'
import { readSpecclawStatus } from './specclaw-status.ts'
import { launchHermesRun, tailHermesRun, listRecentRuns } from './hermes-bridge.ts'
import { detectBacklogSource, snapshotBacklog } from './backlog.ts'
import { loadRegistry, type HandoffRecord } from './handoffs.ts'

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
  memoryStore?: MemoryStore
  getCircuitStates?: () => Map<string, { circuitOpen: boolean; backoffUntil?: number }>
  /** Injectable spawn function for hermes bridge (tests mock this). */
  hermesSpawnFn?: (...args: any[]) => any
  /** Injectable handoff-registry loader (tests avoid the filesystem). */
  loadHandoffRegistry?: () => HandoffRecord[]
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
const MUTATION_VERBS = ['create', 'set', 'rename', 'rm', 'memory', 'hermes'] as const
const PHASE_5_VERBS = ['clone', 'remote', 'pull'] as const

function appendCommandLog(
  userId: string,
  verb: string,
  args: string[],
  outcomeSnippet: string,
  error?: string,
): void {
  const mcdDir = process.env.MCD_CHANNELS_DIR
  if (!mcdDir) return
  try {
    // Never persist secrets. `teams-setup <APP_ID> <APP_SECRET>` carries a
    // client secret in args[1]; redact it (and any obvious token-shaped arg).
    let safeArgs = args
    if (verb === 'teams-setup' && args.length >= 2) {
      safeArgs = args.map((a, i) => (i === 1 ? '<redacted>' : a))
    }
    const logPath = join(mcdDir, 'command-log.jsonl')
    const entry =
      JSON.stringify({ ts: new Date().toISOString(), userId, verb, args: safeArgs, outcomeSnippet: outcomeSnippet.slice(0, 150), error: error ?? null }) + '\n'
    appendFileSync(logPath, entry, { mode: 0o600 })
    try { chmodSync(logPath, 0o600) } catch { /* pre-existing file perms */ }
  } catch {
    // Non-fatal
  }
}

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

  let result: MasterCommandResult
  let logError: string | undefined
  try {
    switch (verb) {
      case 'list':
        result = { kind: 'reply', text: handleList(config) }; break
      case 'show':
      case 'status':
        result = { kind: 'reply', text: handleShow(config, rest) }; break
      case 'create':
        result = { kind: 'reply', text: await handleCreate(rest, ctx) }; break
      case 'set':
        result = { kind: 'reply', text: await handleSet(rest, ctx) }; break
      case 'rename':
        result = { kind: 'reply', text: await handleRename(rest, ctx) }; break
      case 'rm':
        result = { kind: 'reply', text: await handleRm(rest, ctx) }; break
      case 'clone':
        result = { kind: 'reply', text: await handleClone(rest, ctx) }; break
      case 'remote':
        result = { kind: 'reply', text: await handleRemote(rest, ctx) }; break
      case 'pull':
        result = { kind: 'reply', text: await handlePull(rest, ctx) }; break
      case 'usage':
      case 'ps':
      case 'top':
        result = { kind: 'reply', text: await handleUsage(ctx) }; break
      case 'stop':
        result = { kind: 'reply', text: await handleStop(rest, ctx) }; break
      case 'schedule':
        result = { kind: 'reply', text: await handleSchedule(rest, ctx) }; break
      case 'provider':
        result = { kind: 'reply', text: await handleProvider(rest, ctx) }; break
      case 'model':
        result = { kind: 'reply', text: await handleModel(rest, ctx) }; break
      case 'progress':
        result = { kind: 'reply', text: await handleProgress(rest, ctx) }; break
      case 'teams-setup':
        result = { kind: 'reply', text: handleTeamsSetup(rest) }; break
      case 'heartbeat':
        result = { kind: 'reply', text: handleHeartbeat(rest, ctx) }; break
      case 'memory':
        result = { kind: 'reply', text: await handleMemory(rest, ctx) }; break
      case 'branch':
        result = { kind: 'reply', text: await handleBranch(rest, ctx) }; break
      case 'hermes':
        result = { kind: 'reply', text: await handleHermes(rest, ctx) }; break
      case 'backlog':
        result = { kind: 'reply', text: await handleBacklog(rest, ctx) }; break
      case 'collab':
        result = { kind: 'reply', text: handleCollab(rest, ctx) }; break
      default:
        result = {
          kind: 'reply',
          text: `unknown verb \`${verb}\`. try one of: ${[...READ_VERBS, ...MUTATION_VERBS, ...PHASE_5_VERBS].join(', ')}`,
        }
    }
  } catch (err) {
    logError = (err as Error).message
    throw err
  } finally {
    const snippet = result! && result.kind === 'reply' ? result.text : ''
    appendCommandLog(userId, verb, rest, snippet, logError)
  }
  return result
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
    `${prefix} set    <chat_id-or-slug> --stuck-threshold-minutes N  — override stuck-watchdog threshold`,
    `${prefix} set    <chat_id-or-slug> --heartbeat-mode <supervised|autonomous>  — set heartbeat mode`,
    `${prefix} set    <chat_id-or-slug> --heartbeat-window <HH:MM-HH:MM>          — set active window`,
    `${prefix} set    <chat_id-or-slug> --heartbeat-stale-minutes N               — set stale threshold`,
    `${prefix} set    <chat_id-or-slug> --goal "..."                 — set persistent goal (injected at session start; "" to clear)`,
    `${prefix} set    <chat_id-or-slug> --distill-on-stop            — enable memory distillation after session stops`,
    `${prefix} set    <chat_id-or-slug> --pr-token-github <token>    — store PR-API token on the project's credential alias (delete the message after!)`,
    `${prefix} set    <chat_id-or-slug> --pr-token-azdo <token> --azdo-org X --azdo-project Y — store ADO PAT + org/project`,
    `${prefix} set    <chat_id-or-slug> --bot-peers <id,id,...> --yes — set allowed inbound bot user ids (requires --yes)`,
    `${prefix} set    <chat_id-or-slug> --bot-peers none            — remove bot-peer allow list`,
    `${prefix} set    <chat_id-or-slug> --peers <slug,slug,...>     — set cross-project peer allow list (slugs must exist, no self/master)`,
    `${prefix} set    <chat_id-or-slug> --peers none               — remove cross-project peer allow list`,
    `${prefix} set    <chat_id-or-slug> --autopilot on|off [--seed "<goal>"] [--autopilot-interval N] [--backlog-file <path>]  — enable/disable backlog autopilot`,
    `${prefix} set    <chat_id-or-slug> --hermes on --yes             — grant this project's Claude the hermes_run tool (requires --yes)`,
    `${prefix} set    <chat_id-or-slug> --hermes off                  — revoke the project's hermes access`,
    `${prefix} set    <chat_id-or-slug> --disabled on                 — suspend project: inbound messages dropped, warm session killed`,
    `${prefix} set    <chat_id-or-slug> --disabled off                — resume project: re-enables delivery, stamps enabledAt`,
    `${prefix} set    <chat_id-or-slug> --collab-role <name>=<slug|botId> — add/update a collab handoff role (<name>=none removes)`,
    `${prefix} backlog <chat_id-or-slug>                            — show backlog source, progress, and autopilot state`,
    `${prefix} collab <chat_id-or-slug>                             — show collab roles and open handoffs`,
    `${prefix} rename <chat_id-or-slug> --slug NEW                    — rename slug + dir`,
    `${prefix} remote <chat_id-or-slug> [--set URL] [--creds NAME]    — show/set git remote`,
    `${prefix} pull   <chat_id-or-slug>                               — git pull --ff-only`,
    `${prefix} usage                         — resource snapshot of running project subprocesses (alias: ps, top)`,
    `${prefix} stop   <chat_id-or-slug>                               — kill the project's subprocess; lazy-respawns on next message`,
    `${prefix} schedule add <chat_id-or-slug> --at HH:MM|every 30m|every 2h --prompt "..." [--max-runs N] [--only-when-idle [--idle-grace N]] [--stop-on-reply "<regex>"]   — daily/interval job`,
    `${prefix} schedule add <chat_id-or-slug> --cron "*/15 9-18 * * 1-5" --prompt "..." [--only-when-idle [--idle-grace N]] [--stop-on-reply "<regex>"]                     — cron-syntax job`,
    `${prefix} schedule list [<chat_id-or-slug>]      — show all schedules (or just one project's)`,
    `${prefix} schedule pause/resume/rm <id>          — toggle or delete a schedule`,
    `${prefix} provider <chat_id-or-slug> [--set ALIAS | --clear]    — switch a project to a different provider (or back to Claude subscription)`,
    `${prefix} model    <chat_id-or-slug> [--set NAME [--force] | --clear]    — set or clear the project's --model arg`,
    `${prefix} progress <chat_id-or-slug> [--set off|edit|post|phases | --clear]    — show/set live tool-call progress mode`,
    `${prefix} teams-setup <APP_ID> <APP_SECRET>                      — write Teams bot credentials to .env (run without args for instructions)`,
    `${prefix} memory stats                     — show memory counts by type and channel`,
    `${prefix} memory backup                    — trigger immediate R2 backup`,
    `${prefix} memory clear [--slug S] [--type T] --yes — delete matching memories`,
    `${prefix} heartbeat [--channel <slug>] [--quiet]        — attention report (quiet: HEARTBEAT_OK sentinel when healthy)`,
    `${prefix} rm     <chat_id-or-slug> --yes                         — archive + remove`,
    `${prefix} hermes "<prompt>" [--model <m>] [--no-report]         — launch a detached Hermes agent run (ops tasks, self-restart)`,
    `${prefix} hermes --tail <run-id> [--lines <n>]                  — tail the log of a previous Hermes run`,
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
    const disabledMark = project.disabled ? ' ⛔' : ''
    const model = project.model ?? config.defaults.model
    const repo = project.git?.remote ?? '(no remote)'
    lines.push(`${tag} ${project.slug.padEnd(20)}${disabledMark} chat=${chatId}  model=${model}  ${repo}`)
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
  if (project.disabled) lines.push('disabled: yes')
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
    // Presence only — describePrAuth never includes the token value.
    try {
      const prAuth = describePrAuth(getCredential(loadCredentials(), project.git.credentials))
      if (prAuth) lines.push(`pr auth: ${prAuth}`)
    } catch { /* unreadable creds file must not break show */ }
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
  // Specclaw status (FR4)
  {
    const ss = readSpecclawStatus(projectDir(project.slug))
    if (ss.present) {
      if (ss.activeChange) {
        let part = `specclaw: 🔨 ${ss.activeChange}`
        const detail: string[] = []
        let taskPart = ''
        if (ss.phase !== undefined) taskPart += `${ss.phase} `
        if (ss.tasksDone !== undefined && ss.tasksTotal !== undefined) taskPart += `${ss.tasksDone}/${ss.tasksTotal} tasks`
        else if (ss.phase !== undefined) taskPart = taskPart.trimEnd()
        if (taskPart.trim()) detail.push(taskPart.trim())
        if (ss.pendingProposals) detail.push(`${ss.pendingProposals} proposals pending`)
        if (detail.length > 0) part += ` — ${detail.join(', ')}`
        lines.push(part)
      } else {
        if (ss.pendingProposals) lines.push(`specclaw: idle — ${ss.pendingProposals} proposals pending`)
        else lines.push('specclaw: idle')
      }
    }
  }
  // Goal (P39)
  const goalPath = projectGoalFile(project.slug)
  if (existsSync(goalPath)) {
    try {
      const goalText = readFileSync(goalPath, 'utf8').trim()
      if (goalText) lines.push(`goal: ${goalText.slice(0, 200)}${goalText.length > 200 ? '…' : ''}`)
    } catch {}
  }

  // Distillation (P38)
  if (project.distillOnStop) lines.push('distillation: enabled (runs after session stop)')

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

  // --platform flag: 'discord' (default), 'teams', or 'whatsapp'
  const platformRaw = typeof flags.platform === 'string' ? flags.platform : 'discord'
  if (platformRaw !== 'discord' && platformRaw !== 'teams' && platformRaw !== 'whatsapp') {
    return '`--platform` must be `discord`, `teams`, or `whatsapp`'
  }
  const platform = platformRaw as 'discord' | 'teams' | 'whatsapp'

  // --whatsapp-jid: required when --platform whatsapp
  const whatsappJid = typeof flags['whatsapp-jid'] === 'string' ? flags['whatsapp-jid'] : null
  if (platform === 'whatsapp' && !whatsappJid) {
    return '`create --platform whatsapp` requires `--whatsapp-jid <jid>` (e.g. `94771234567@s.whatsapp.net`)'
  }

  // Channel id can come from a positional argument OR `--new-channel <name>`
  // which auto-creates a fresh guild text channel using the bot's
  // Manage Channels permission. (Idempotent — reuses an existing channel
  // with the same name if one's there.)
  // When --platform teams, the positional arg is the Teams conversation ID;
  // When --platform whatsapp, the JID is used as chatId directly;
  // Discord channel creation is skipped entirely for non-discord platforms.
  const newChannelName = typeof flags['new-channel'] === 'string' ? flags['new-channel'] : null
  let chatId: string
  let createdChannelNote: string | null = null
  let weCreatedChannel = false

  if (platform === 'whatsapp') {
    // WhatsApp: use the JID as chatId. Positional arg is also accepted as JID
    // (mirrors Teams pattern) but --whatsapp-jid takes precedence.
    chatId = whatsappJid!
  } else if (platform === 'teams') {
    // Teams: positional arg is the conversation ID. --new-channel is not applicable.
    if (positional.length === 0) {
      return '`create --platform teams` requires the Teams conversation ID as the first positional argument'
    }
    chatId = positional[0]!
  } else if (newChannelName !== null) {
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
        ...(platform === 'teams' ? { platform } : {}),
        ...(platform === 'whatsapp' ? { platform, whatsappJid: whatsappJid! } : {}),
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
  const stuckRaw = flags['stuck-threshold-minutes']
  const stuckMinutes = stuckRaw !== undefined ? Number(stuckRaw) : null

  const heartbeatModeRaw = typeof flags['heartbeat-mode'] === 'string' ? flags['heartbeat-mode'] : null
  if (heartbeatModeRaw !== null && heartbeatModeRaw !== 'supervised' && heartbeatModeRaw !== 'autonomous') {
    return '`--heartbeat-mode` must be `supervised` or `autonomous`'
  }
  const heartbeatMode = heartbeatModeRaw as 'supervised' | 'autonomous' | null

  const heartbeatWindowRaw = typeof flags['heartbeat-window'] === 'string' ? flags['heartbeat-window'] : null
  if (heartbeatWindowRaw !== null && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(heartbeatWindowRaw)) {
    return '`--heartbeat-window` must match `HH:MM-HH:MM`'
  }
  const heartbeatWindow = heartbeatWindowRaw

  const heartbeatStaleRaw = flags['heartbeat-stale-minutes']
  const heartbeatStale = heartbeatStaleRaw !== undefined ? Number(heartbeatStaleRaw) : null
  if (heartbeatStale !== null && (!Number.isInteger(heartbeatStale) || heartbeatStale <= 0)) {
    return '`--heartbeat-stale-minutes` must be a positive integer'
  }

  const goalRaw = typeof flags.goal === 'string' ? flags.goal : null
  const distillOnStopRaw = flags['distill-on-stop']
  // parseFlags uses `string | true`; presence of --distill-on-stop enables distillation
  const distillOnStop: boolean | null = distillOnStopRaw !== undefined ? true : null

  const developBranchRaw = typeof flags['develop-branch'] === 'string' ? flags['develop-branch'] : null
  if (developBranchRaw !== null && developBranchRaw !== 'on' && developBranchRaw !== 'off') {
    return '`--develop-branch` must be `on` or `off`'
  }
  const developBranch = developBranchRaw === 'on' ? true : developBranchRaw === 'off' ? false : null

  const prTokenGithub = typeof flags['pr-token-github'] === 'string' ? flags['pr-token-github'] : null
  const prTokenAzdo = typeof flags['pr-token-azdo'] === 'string' ? flags['pr-token-azdo'] : null
  if (prTokenGithub !== null && prTokenAzdo !== null) {
    return '`--pr-token-github` and `--pr-token-azdo` are mutually exclusive'
  }
  let prApi: PrApi | null = null
  if (prTokenGithub !== null) {
    prApi = { kind: 'github', token: prTokenGithub }
  } else if (prTokenAzdo !== null) {
    const org = typeof flags['azdo-org'] === 'string' ? flags['azdo-org'] : null
    const project = typeof flags['azdo-project'] === 'string' ? flags['azdo-project'] : null
    if (!org || !project) return '`--pr-token-azdo` requires `--azdo-org <org>` and `--azdo-project <project>`'
    prApi = { kind: 'azdo', token: prTokenAzdo, org, project }
  }

  // --bot-peers <id,id,...> or --bot-peers none
  const botPeersRaw = typeof flags['bot-peers'] === 'string' ? flags['bot-peers'] : null
  // null means flag not present; 'none' means clear; otherwise csv of snowflakes
  let botPeersAction: 'none' | string[] | null = null
  if (botPeersRaw !== null) {
    if (botPeersRaw === 'none') {
      botPeersAction = 'none'
    } else {
      // Reject master slug as target
      if (isMasterChannel(config, entry.chatId)) {
        return '`set --bot-peers` cannot target the master channel'
      }
      // Requires --yes (expanding inbound attack surface)
      if (flags.yes !== true) {
        return '`set --bot-peers <ids>` requires `--yes` (adds inbound bot reach)'
      }
      const ids = botPeersRaw.split(',').map(s => s.trim()).filter(Boolean)
      const snowflakeRe = /^\d{17,20}$/
      for (const id of ids) {
        if (!snowflakeRe.test(id)) {
          return `invalid bot-peer id "${id}" — must be a Discord snowflake (17–20 digits)`
        }
      }
      botPeersAction = ids
    }
  }

  // --peers <slug,slug,...> or --peers none
  const peersRaw = typeof flags['peers'] === 'string' ? flags['peers'] : null
  // null means flag not present; 'none' means clear; otherwise csv of slugs
  let peersAction: 'none' | string[] | null = null
  if (peersRaw !== null) {
    if (peersRaw === 'none') {
      peersAction = 'none'
    } else {
      const slugs = peersRaw.split(',').map(s => s.trim()).filter(Boolean)
      const masterSlug = config.projects[config.master?.chatId ?? '']?.slug
      for (const slug of slugs) {
        if (!SLUG_PATTERN.test(slug)) {
          return `invalid peer slug "${slug}" — must match ${SLUG_PATTERN}`
        }
        if (slug === entry.project.slug) {
          return `self-reference not allowed: project "${slug}" cannot peer with itself`
        }
        if (slug === masterSlug) {
          return `master project "${slug}" cannot be a peer target`
        }
        if (!findProjectBySlug(config, slug)) {
          return `peer slug "${slug}" not found — create the project first`
        }
      }
      peersAction = slugs
    }
  }

  // --autopilot on|off [--seed "<goal>"] [--autopilot-interval N] [--backlog-file <path>]
  const autopilotRaw = typeof flags['autopilot'] === 'string' ? flags['autopilot'] : null
  if (autopilotRaw !== null && autopilotRaw !== 'on' && autopilotRaw !== 'off') {
    return '`--autopilot` must be `on` or `off`'
  }
  const autopilotAction: 'on' | 'off' | null = autopilotRaw as 'on' | 'off' | null

  // --seed requires --autopilot on
  const seedGoal = typeof flags['seed'] === 'string' ? flags['seed'] : null
  if (seedGoal !== null && autopilotAction !== 'on') {
    return '`--seed` is only valid with `--autopilot on`'
  }

  // --autopilot-interval N
  let autopilotInterval: number | null = null
  if (flags['autopilot-interval'] !== undefined) {
    const n = Number(flags['autopilot-interval'])
    if (!Number.isInteger(n) || n <= 0) {
      return '`--autopilot-interval` must be a positive integer (minutes)'
    }
    autopilotInterval = n
  }

  // --backlog-file <path>
  const backlogFile = typeof flags['backlog-file'] === 'string' ? flags['backlog-file'] : null

  // --autopilot-interval and --backlog-file are only valid with --autopilot on OR existing autopilot block
  if (autopilotInterval !== null && autopilotAction !== 'on') {
    const proj = loadConfig().projects[entry.chatId] ?? entry.project
    if (!proj.autopilot) {
      return '`--autopilot-interval` requires `--autopilot on` (or an existing autopilot block)'
    }
  }
  if (backlogFile !== null && autopilotAction !== 'on') {
    const proj = loadConfig().projects[entry.chatId] ?? entry.project
    if (!proj.autopilot) {
      return '`--backlog-file` requires `--autopilot on` (or an existing autopilot block)'
    }
  }

  // --hermes on|off — per-project hermes_run access
  const hermesRaw = typeof flags['hermes'] === 'string' ? flags['hermes'] : null
  if (hermesRaw !== null && hermesRaw !== 'on' && hermesRaw !== 'off') {
    return '`--hermes` must be `on` or `off`'
  }
  const hermesAction: 'on' | 'off' | null = hermesRaw as 'on' | 'off' | null
  if (hermesAction !== null) {
    // Master already has hermes_run unconditionally — toggling is meaningless
    if (isMasterChannel(config, entry.chatId)) {
      return 'master already has hermes access — nothing to change'
    }
    // Requires --yes (grants host-level ops reach)
    if (hermesAction === 'on' && flags.yes !== true) {
      return '`set --hermes on` requires `--yes` (grants host-level ops reach via the Hermes bridge)'
    }
  }

  // --disabled on|off — suspend or resume a project (drops inbound deliveries when on)
  const disabledRaw = typeof flags['disabled'] === 'string' ? flags['disabled'] : null
  if (disabledRaw !== null && disabledRaw !== 'on' && disabledRaw !== 'off') {
    return '`--disabled` must be `on` or `off`'
  }
  const disabledAction: 'on' | 'off' | null = disabledRaw as 'on' | 'off' | null
  if (disabledAction !== null) {
    if (isMasterChannel(config, entry.chatId)) {
      return 'master channel cannot be disabled'
    }
  }

  // --collab-role <name>=<slug|botId> or <name>=none — add/update/remove a collab handoff role
  const collabRoleRaw = typeof flags['collab-role'] === 'string' ? flags['collab-role'] : null
  let collabRoleAction: { name: string; value: string | 'none' } | null = null
  if (collabRoleRaw !== null) {
    if (isMasterChannel(config, entry.chatId)) {
      return 'master channel cannot have collab roles'
    }
    const eq = collabRoleRaw.indexOf('=')
    const name = eq >= 0 ? collabRoleRaw.slice(0, eq).trim() : ''
    const value = eq >= 0 ? collabRoleRaw.slice(eq + 1).trim() : ''
    if (name === '' || value === '') {
      return '`--collab-role` must be `<name>=<slug|botId>` (or `<name>=none` to remove)'
    }
    if (value !== 'none') {
      const resolved = resolveCollabTarget(config, entry.chatId, value)
      if ('error' in resolved) return resolved.error
    }
    collabRoleAction = { name, value }
  }

  if (prompt === null && stuckMinutes === null && heartbeatMode === null && heartbeatWindow === null && heartbeatStale === null && goalRaw === null && distillOnStop === null && developBranch === null && prApi === null && botPeersAction === null && peersAction === null && autopilotAction === null && autopilotInterval === null && backlogFile === null && hermesAction === null && disabledAction === null && collabRoleAction === null) {
    return '`set` requires `--prompt "..."`, `--stuck-threshold-minutes N`, `--heartbeat-mode <supervised|autonomous>`, `--heartbeat-window <HH:MM-HH:MM>`, `--heartbeat-stale-minutes N`, `--goal "..."`, `--distill-on-stop`, `--develop-branch on|off`, `--pr-token-github <token>`, `--pr-token-azdo <token> --azdo-org X --azdo-project Y`, `--bot-peers <id,...>|none`, `--peers <slug,...>|none`, `--autopilot on|off [--seed "<goal>"] [--autopilot-interval N] [--backlog-file <path>]`, `--hermes on|off`, `--disabled on|off`, or `--collab-role <name>=<slug|botId|none>`'
  }

  const results: string[] = []

  if (prompt !== null) {
    writeFileSync(projectClaudeMd(entry.project.slug), `${prompt.trim()}\n`, { mode: 0o600 })
    results.push(`✅ rewrote CLAUDE.md for **${entry.project.slug}** (${prompt.length} chars).`)
  }

  if (stuckMinutes !== null) {
    if (!Number.isInteger(stuckMinutes) || stuckMinutes <= 0) {
      return '`--stuck-threshold-minutes` must be a positive integer'
    }
    const updated = { ...config, projects: { ...config.projects, [entry.chatId]: { ...entry.project, stuckThresholdMinutes: stuckMinutes } } }
    saveConfig(updated)
    results.push(`✅ set \`stuckThresholdMinutes\` = ${stuckMinutes} for **${entry.project.slug}**.`)
  }

  if (heartbeatMode !== null || heartbeatWindow !== null || heartbeatStale !== null) {
    const existing: Partial<NonNullable<typeof entry.project.heartbeat>> = entry.project.heartbeat ?? {}
    const heartbeat = {
      mode: heartbeatMode ?? existing.mode ?? 'supervised',
      staleAfterMinutes: heartbeatStale ?? existing.staleAfterMinutes ?? 60,
      ...(heartbeatWindow !== undefined && heartbeatWindow !== null ? { window: heartbeatWindow } : existing.window ? { window: existing.window } : {}),
    } as { mode: 'supervised' | 'autonomous'; staleAfterMinutes: number; window?: string }
    const latest = loadConfig()
    const updatedEntry = latest.projects[entry.chatId] ?? entry.project
    saveConfig({ ...latest, projects: { ...latest.projects, [entry.chatId]: { ...updatedEntry, heartbeat } } })
    results.push(`✅ set \`heartbeat\` for **${entry.project.slug}**: mode=${heartbeat.mode}, staleAfterMinutes=${heartbeat.staleAfterMinutes}${heartbeat.window ? `, window=${heartbeat.window}` : ''}.`)
  }

  if (goalRaw !== null) {
    const goalPath = projectGoalFile(entry.project.slug)
    if (goalRaw.trim() === '') {
      if (existsSync(goalPath)) {
        try { const { unlinkSync } = await import('node:fs'); unlinkSync(goalPath) } catch (err) {
          return `failed to clear GOAL.md: ${(err as Error).message}`
        }
      }
      results.push(`✅ cleared goal for **${entry.project.slug}**.`)
    } else {
      const truncated = goalRaw.slice(0, 500)
      if (goalRaw.length > 500) results.push(`_goal truncated to 500 chars._`)
      writeFileSync(goalPath, `${truncated.trim()}\n`, { mode: 0o600 })
      results.push(`✅ set goal for **${entry.project.slug}**: ${truncated.slice(0, 80)}${truncated.length > 80 ? '…' : ''}`)
    }
  }

  if (distillOnStop !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, distillOnStop } } })
    results.push(`✅ set \`distillOnStop\` = ${distillOnStop} for **${entry.project.slug}**.`)
  }

  if (developBranch !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, developBranch } } })
    results.push(`✅ set \`developBranch\` = ${developBranch} for **${entry.project.slug}**.`)
  }

  if (prApi !== null) {
    const alias = entry.project.git?.credentials
    if (!alias) {
      return 'project has no `git.credentials` alias — PR tokens are stored on the transport alias. Configure git first (`remote`/`clone`).'
    }
    try {
      const creds = loadCredentials()
      const cred = getCredential(creds, alias)
      saveCredentials({ ...creds, [alias]: { ...cred, prApi } })
    } catch (err) {
      return `PR token store failed: ${(err as Error).message}`
    }
    results.push(
      `✅ stored ${prApi.kind} PR token on alias \`${alias}\` for **${entry.project.slug}**.`,
      '⚠️ Delete the Discord message containing the token now — it is in channel history.',
    )
  }

  if (botPeersAction !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    if (botPeersAction === 'none') {
      const { botPeers: _removed, ...rest } = latestEntry
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: rest } })
      results.push(`✅ cleared \`botPeers\` for **${entry.project.slug}**.`)
    } else {
      const existing = latestEntry.botPeers
      const updated = { ...existing, allow: botPeersAction }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, botPeers: updated } } })
      results.push(`✅ set \`botPeers.allow\` = [${botPeersAction.join(', ')}] for **${entry.project.slug}**.`)
    }
  }

  if (peersAction !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    if (peersAction === 'none') {
      const { peers: _removed, ...rest } = latestEntry
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: rest } })
      results.push(`✅ cleared \`peers\` for **${entry.project.slug}**.`)
    } else {
      // Keep existing limit fields (maxHops, cooldownSeconds), replace allow only
      const existing = latestEntry.peers
      const updated = { ...existing, allow: peersAction }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, peers: updated } } })
      results.push(`✅ set \`peers.allow\` = [${peersAction.join(', ')}] for **${entry.project.slug}**.`)
    }
  }

  if (autopilotAction !== null || autopilotInterval !== null || backlogFile !== null) {
    // Refuse on master channel
    if (isMasterChannel(config, entry.chatId)) {
      return '`--autopilot` cannot be enabled on the master channel'
    }
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    // Use a typed variable so destructuring is well-typed
    const existing: AutopilotConfig = latestEntry.autopilot ?? { enabled: false }

    if (autopilotAction === 'on') {
      // Preserve user-config limits, clear runtime state for fresh entry
      const newAutopilot: AutopilotConfig = {
        enabled: true,
        ...(existing.file !== undefined ? { file: existing.file } : {}),
        ...(existing.intervalMinutes !== undefined ? { intervalMinutes: existing.intervalMinutes } : {}),
        ...(existing.stallThreshold !== undefined ? { stallThreshold: existing.stallThreshold } : {}),
        ...(existing.respectHeartbeatWindow !== undefined ? { respectHeartbeatWindow: existing.respectHeartbeatWindow } : {}),
        ...(seedGoal !== null ? { seedGoal } : {}),
        ...(autopilotInterval !== null ? { intervalMinutes: autopilotInterval } : {}),
        ...(backlogFile !== null ? { file: backlogFile } : {}),
      }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, autopilot: newAutopilot } } })
      // Detect backlog source to give a helpful state hint
      const dir = projectDir(latestEntry.slug)
      const file = newAutopilot.file ?? 'BACKLOG.md'
      const source = existsSync(dir) ? detectBacklogSource(dir, file) : 'none'
      const stateHint = source === 'none' ? 'seeding (no backlog source detected — seed phase will run)' : 'running'
      results.push(`✅ autopilot **enabled** for **${latestEntry.slug}**. State: ${stateHint}.`)
    } else if (autopilotAction === 'off') {
      // Clear runtime state, keep user limits
      const newAutopilot: AutopilotConfig = {
        enabled: false,
        ...(existing.file !== undefined ? { file: existing.file } : {}),
        ...(existing.intervalMinutes !== undefined ? { intervalMinutes: existing.intervalMinutes } : {}),
        ...(existing.stallThreshold !== undefined ? { stallThreshold: existing.stallThreshold } : {}),
        ...(existing.respectHeartbeatWindow !== undefined ? { respectHeartbeatWindow: existing.respectHeartbeatWindow } : {}),
      }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, autopilot: newAutopilot } } })
      results.push(`✅ autopilot **disabled** for **${latestEntry.slug}**. Runtime state cleared; limits preserved.`)
    } else {
      // Only interval or file update (existing block confirmed above, has `enabled`)
      const updated: AutopilotConfig = {
        ...existing,
        ...(autopilotInterval !== null ? { intervalMinutes: autopilotInterval } : {}),
        ...(backlogFile !== null ? { file: backlogFile } : {}),
      }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, autopilot: updated } } })
      if (autopilotInterval !== null) results.push(`✅ set \`autopilot.intervalMinutes\` = ${autopilotInterval} for **${latestEntry.slug}**.`)
      if (backlogFile !== null) results.push(`✅ set \`autopilot.file\` = "${backlogFile}" for **${latestEntry.slug}**.`)
    }
  }

  if (hermesAction !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    if (hermesAction === 'on') {
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, hermes: { enabled: true } } } })
      results.push(`✅ hermes access **enabled** for **${latestEntry.slug}** — this project's Claude can now launch Hermes runs.`)
    } else {
      const { hermes: _removed, ...rest } = latestEntry
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: rest } })
      results.push(`✅ hermes access **disabled** for **${latestEntry.slug}**.`)
    }
  }

  if (disabledAction !== null) {
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    if (disabledAction === 'on') {
      const { enabledAt: _removed, ...rest } = latestEntry
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...rest, disabled: true } } })
      let sessionNote = ''
      if (ctx.mutator?.killProject) {
        try {
          await ctx.mutator.killProject(entry.chatId)
          sessionNote = ' Warm session stopped.'
        } catch {
          sessionNote = ' (session kill failed — may still be running)'
        }
      }
      results.push(`✅ **${latestEntry.slug}** is now **disabled** — inbound messages will be dropped.${sessionNote}`)
    } else {
      const { disabled: _removed, ...rest } = latestEntry
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...rest, enabledAt: new Date().toISOString() } } })
      results.push(`✅ **${latestEntry.slug}** is now **enabled** — inbound messages will be delivered.`)
    }
  }

  if (collabRoleAction !== null) {
    const { name, value } = collabRoleAction
    const latestConfig = loadConfig()
    const latestEntry = latestConfig.projects[entry.chatId] ?? entry.project
    const existingCollab = latestEntry.collab ?? {}
    const existingRoles = existingCollab.roles ?? {}
    if (value === 'none') {
      if (existingRoles[name] === undefined) {
        results.push(`collab role \`${name}\` is not set for **${latestEntry.slug}** — nothing to remove.`)
      } else {
        const { [name]: _removed, ...remainingRoles } = existingRoles
        if (Object.keys(remainingRoles).length === 0 && existingCollab.timeoutMinutes === undefined) {
          // Collab block would be empty — drop it entirely
          const { collab: _collab, ...rest } = latestEntry
          saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: rest } })
        } else {
          const collab = { ...existingCollab, roles: remainingRoles }
          saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, collab } } })
        }
        results.push(`✅ removed collab role \`${name}\` for **${latestEntry.slug}**.`)
      }
    } else {
      const collab = { ...existingCollab, roles: { ...existingRoles, [name]: value } }
      saveConfig({ ...latestConfig, projects: { ...latestConfig.projects, [entry.chatId]: { ...latestEntry, collab } } })
      results.push(`✅ set collab role \`${name}\` → \`${value}\` for **${latestEntry.slug}**.`)
    }
  }

  // Respawn only needed when prompt changed (CLAUDE.md is read at session start).
  let respawnNote = ''
  if (prompt !== null) {
    respawnNote = '_subprocess will respawn on next message._'
    if (flags['no-restart'] !== true && ctx.mutator) {
      try {
        await ctx.mutator.killProject(entry.chatId)
        respawnNote = '_subprocess killed; next message will spawn it with the new prompt._'
      } catch (err) {
        respawnNote = `_kill failed: ${(err as Error).message}; restart manually if needed._`
      }
    }
    results.push(respawnNote)
  }

  return results.join('\n')
}

async function handleBranch(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional } = parseFlags(rest)
  const slug = positional[0]
  const subverb = positional[1] // 'create'
  if (!slug || subverb !== 'create') {
    return 'usage: `!project branch <slug> create` — create or checkout develop branch'
  }
  const config = loadConfig()
  const entry = resolveTarget(config, slug)
  if (!entry) return `no project found for "${slug}"`

  const { gitCreateOrCheckoutDevelop } = await import('./git-ops.ts')
  const cwd = projectDir(entry.project.slug)
  const { env, cleanup } = buildGitEnv(null)
  try {
    const result = gitCreateOrCheckoutDevelop(cwd, env)
    if (!result.ok) return `❌ git error: ${result.stderr}`
    return `✅ develop branch ready for **${entry.project.slug}**: \`${result.stdout.trim() || 'develop'}\``
  } finally {
    cleanup()
  }
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
  try {
    assertSafeGitRef('repo', repo)
    if (typeof flags.branch === 'string') assertSafeGitRef('branch', flags.branch)
  } catch (err) {
    return `❌ ${(err as Error).message}`
  }

  const branch = typeof flags.branch === 'string' ? flags.branch : undefined
  const credsAlias = typeof flags.creds === 'string' ? flags.creds : undefined
  const promptArg = typeof flags.prompt === 'string' ? flags.prompt : null
  const model = typeof flags.model === 'string' ? flags.model : undefined

  // --platform flag for clone: 'discord' (default), 'teams', or 'whatsapp'
  const clonePlatformRaw = typeof flags.platform === 'string' ? flags.platform : 'discord'
  if (clonePlatformRaw !== 'discord' && clonePlatformRaw !== 'teams' && clonePlatformRaw !== 'whatsapp') {
    return '`--platform` must be `discord`, `teams`, or `whatsapp`'
  }
  const clonePlatform = clonePlatformRaw as 'discord' | 'teams' | 'whatsapp'

  // --whatsapp-jid: required when --platform whatsapp
  const cloneWhatsappJid = typeof flags['whatsapp-jid'] === 'string' ? flags['whatsapp-jid'] : null
  if (clonePlatform === 'whatsapp' && !cloneWhatsappJid) {
    return '`clone --platform whatsapp` requires `--whatsapp-jid <jid>` (e.g. `94771234567@s.whatsapp.net`)'
  }

  // Channel id (positional or auto-create) — same shape as create.
  const newChannelName = typeof flags['new-channel'] === 'string' ? flags['new-channel'] : null
  let chatId: string
  let createdChannelNote: string | null = null

  // Track whether we auto-created the channel — if anything below fails
  // we roll back by deleting it (so retries don't pile up orphan channels).
  let weCreatedChannel = false

  if (clonePlatform === 'whatsapp') {
    // WhatsApp: JID is the chatId. No Discord channel needed.
    chatId = cloneWhatsappJid!
  } else if (newChannelName !== null) {
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
    return '`clone` needs `<chat_id>` (positional), `--new-channel <name>`, or `--platform whatsapp --whatsapp-jid <jid>`'
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
        ...(clonePlatform === 'whatsapp' ? { platform: clonePlatform, whatsappJid: cloneWhatsappJid! } : {}),
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
 *   schedule add <chat_id-or-slug> --at HH:MM|every 30m|every 2h --prompt "..." [--max-runs N]
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
    case 'inject':
      return scheduleInject(tail)
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
      return `unknown schedule subverb \`${sub}\`. valid: add, inject, list, pause, resume, rm`
  }
}

async function scheduleAdd(tail: string[]): Promise<string> {
  const { positional, flags } = parseFlags(tail)
  if (positional.length === 0) return '`schedule add` needs a chat_id or slug as the first argument'

  const cronRaw = flags.cron
  const atRaw = flags.at

  // --only-when-idle / --idle-grace validation (shared for both cron and at/interval paths)
  const onlyWhenIdle = flags['only-when-idle'] === true
  let idleGraceMinutes: number | undefined
  if (flags['idle-grace'] !== undefined) {
    if (!onlyWhenIdle) return '`--idle-grace` requires `--only-when-idle`'
    const n = Number(flags['idle-grace'])
    if (!Number.isInteger(n) || n <= 0) return `\`--idle-grace\` must be a positive integer; got "${flags['idle-grace']}"`
    idleGraceMinutes = n
  }

  const idleFields = onlyWhenIdle
    ? { onlyWhenIdle: true as const, ...(idleGraceMinutes !== undefined ? { idleGraceMinutes } : {}) }
    : {}
  const idleConfirmLine = onlyWhenIdle
    ? `\n⏸ idle-gated (grace ${idleGraceMinutes !== undefined ? `${idleGraceMinutes}m` : '5m default'})`
    : ''

  // --stop-on-reply validation (shared for both paths)
  let stopOnReply: string | undefined
  if (flags['stop-on-reply'] !== undefined) {
    const pattern = String(flags['stop-on-reply'])
    try { new RegExp(pattern, 'i') } catch { return '`--stop-on-reply` must be a valid regex' }
    stopOnReply = pattern
  }
  const stopOnReplyFields = stopOnReply !== undefined ? { stopOnReply } : {}
  const stopOnReplyConfirmLine = stopOnReply !== undefined ? `\n⏹ stop-on-reply /${stopOnReply}/` : ''

  if (typeof cronRaw === 'string') {
    const cronErr = validateCron(cronRaw)
    if (cronErr) return `invalid \`--cron\` expression: ${cronErr}`

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
    const entry = resolveTarget(config, positional[0]!)
    if (!entry) return `no project found for "${positional[0]!}"`
    const id = newScheduleId()
    const sched: Schedule = {
      id,
      type: 'prompt',
      chatId: entry.chatId,
      cron: cronRaw,
      prompt,
      enabled: true,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      maxRuns,
      runCount: 0,
      ...idleFields,
      ...stopOnReplyFields,
    }
    const file = loadSchedules()
    file.schedules.push(sched)
    saveSchedules(file)
    return [
      `✅ scheduled job **${id}**`,
      `project: **${entry.project.slug}** (chat \`${entry.chatId}\`)`,
      `cron: \`${cronRaw}\``,
      `prompt: ${prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}`,
      maxRuns ? `max runs: ${maxRuns}` : '_no run cap (use `pause`/`rm` to stop)_',
    ].join('\n') + idleConfirmLine + stopOnReplyConfirmLine
  }

  if (typeof atRaw !== 'string') return '`schedule add` requires `--at HH:MM|every Xm/Xh` or `--cron "* * * * *"`'

  const isInterval = IntervalSchema.safeParse(atRaw).success
  const isHHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(atRaw)

  if (!isHHMM && !isInterval) return `\`--at\` must be HH:MM or "every Xm"/"every Xh", got "${atRaw}"`

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
  const sched: Schedule = isInterval
    ? {
        id,
        type: 'prompt',
        chatId: entry.chatId,
        interval: atRaw,
        prompt,
        enabled: true,
        lastRunAt: null,
        createdAt: new Date().toISOString(),
        maxRuns,
        runCount: 0,
        ...idleFields,
        ...stopOnReplyFields,
      }
    : {
        id,
        type: 'prompt',
        chatId: entry.chatId,
        at: atRaw,
        prompt,
        enabled: true,
        lastRunAt: null,
        createdAt: new Date().toISOString(),
        maxRuns,
        runCount: 0,
        ...idleFields,
        ...stopOnReplyFields,
      }
  file.schedules.push(sched)
  saveSchedules(file)

  const timeLabel = isInterval ? `every: ${atRaw}` : `daily at: ${atRaw} (host local time)`
  return [
    `✅ scheduled job **${id}**`,
    `project: **${entry.project.slug}** (chat \`${entry.chatId}\`)`,
    timeLabel,
    `prompt: ${prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt}`,
    maxRuns ? `max runs: ${maxRuns}` : '_no run cap (use `pause`/`rm` to stop)_',
  ].join('\n') + idleConfirmLine + stopOnReplyConfirmLine
}

/**
 * `!project schedule inject [--slug <slug>] HH:MM "<template>"`
 *
 * Registers a daily inject schedule. At fire time, template vars
 * {{slug}}, {{date}}, {{time}} are resolved and the message is
 * injected directly into the project session (no agent footer).
 */
function scheduleInject(tail: string[]): string {
  const { positional, flags } = parseFlags(tail)
  if (positional.length < 2) {
    return '`schedule inject` requires: [--slug <slug>] HH:MM "<template body>"'
  }

  const slugFlag = flags.slug
  const atRaw = positional[0]!
  const templateBody = positional.slice(1).join(' ')

  const isHHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(atRaw)
  if (!isHHMM) return `\`--at\` time must be HH:MM (24h), got "${atRaw}"`

  const config = loadConfig()
  let chatId: string
  let slugLabel: string
  if (typeof slugFlag === 'string') {
    const entry = resolveTarget(config, slugFlag)
    if (!entry) return `no project found for "${slugFlag}"`
    chatId = entry.chatId
    slugLabel = entry.project.slug
  } else {
    return '`schedule inject` requires `--slug <slug>` to target a specific project'
  }

  const file = loadSchedules()
  const id = newScheduleId()
  const sched = {
    id,
    chatId,
    at: atRaw,
    prompt: templateBody,
    type: 'inject' as const,
    enabled: true,
    lastRunAt: null,
    createdAt: new Date().toISOString(),
    maxRuns: null,
    runCount: 0,
  }
  file.schedules.push(sched as Parameters<typeof file.schedules.push>[0])
  saveSchedules(file)

  return [
    `✅ inject schedule **${id}**`,
    `project: **${slugLabel}** (chat \`${chatId}\`)`,
    `daily at: ${atRaw} (host local time)`,
    `template: ${templateBody.length > 120 ? templateBody.slice(0, 120) + '…' : templateBody}`,
    `vars supported: {{slug}}, {{date}}, {{time}}`,
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
      : '_no schedules configured. add one with `schedule add <slug> --at HH:MM|every 30m --prompt "..."`._'
  }

  const lines = ['**Schedules:**', '```']
  lines.push('id                              slug                 at     enabled  runs   last_run')
  const sortKey = (s: Schedule) => s.at ?? (s.cron ? `~~${s.cron}` : `~${s.interval ?? ''}`)
  for (const s of rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const project = config.projects[s.chatId]
    const slug = (project?.slug ?? '?').padEnd(20).slice(0, 20)
    const id = s.id.padEnd(30).slice(0, 30)
    const at = (s.at ?? s.interval ?? (s.cron ? `cron:${s.cron}` : '?')).padEnd(5)
    const en = s.enabled ? 'yes' : 'no '
    const runs = s.maxRuns ? `${s.runCount}/${s.maxRuns}` : `${s.runCount}`
    const last = s.lastRunAt ?? '(never)'
    const idleTag = s.onlyWhenIdle ? '  ⏸ idle-gated' : ''
    const skippedTag = s.lastSkippedAt && (!s.lastRunAt || s.lastSkippedAt > s.lastRunAt)
      ? '  ⏸ skipped (busy)'
      : ''
    const stopOnReplyTag = s.stopOnReply ? `  ⏹ stop-on-reply /${s.stopOnReply}/` : ''
    const escalatedTag = s.escalatedAt ? '  🛑 escalated' : ''
    lines.push(`${id}  ${slug}  ${at}  ${en}    ${runs.padStart(5)}  ${last}${idleTag}${skippedTag}${stopOnReplyTag}${escalatedTag}`)
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
  if (enabled) s.escalatedAt = null
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
  return `🗑 schedule **${removed.id}** removed (was for chat \`${removed.chatId}\` at ${removed.at ?? removed.interval})`
}

/**
 * `!project model <slug>` — view the current model
 * `!project model <slug> --set <name>` — set the project's --model arg
 * `!project model <slug> --clear` — fall back to defaults.model
 *
 * Useful with provider routing: when ai-core is on MiniMax, set
 * `--set MiniMax-M2.7` so the banner and the actual model agree.
 * (Most provider endpoints alias arbitrary names to their own model
 * anyway, but having the UI tell the truth avoids confusion.)
 */
export async function handleModel(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`model` needs a chat_id or slug'
  const target = positional[0]!
  const setName = typeof flags.set === 'string' ? flags.set : null
  const clear = flags.clear === true
  if (setName && clear) return 'pass either `--set <name>` or `--clear`, not both'

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  if (!setName && !clear) {
    const m = entry.project.model ?? config.defaults.model
    return `**${entry.project.slug}**: model = \`${m}\`${entry.project.model ? '' : ' (inherited from defaults)'}`
  }

  // Alias guard: a bad subscription model (e.g. a typo'd "sonnat") spawns
  // fine but claude errors at first turn — "selected model may not exist" —
  // silently bricking the channel. Catch obvious typos at set time. Only
  // applies to subscription projects: provider-routed projects accept
  // arbitrary model ids the endpoint aliases internally. `--force` overrides.
  if (setName) {
    const usesProvider = (entry.project.provider ?? config.defaults.provider) !== undefined
    const KNOWN = ['opus', 'sonnet', 'haiku', 'fable']
    const ok = usesProvider || KNOWN.includes(setName.toLowerCase()) || setName.startsWith('claude-')
    if (!ok && flags.force !== true) {
      return `⚠️ \`${setName}\` is not a known subscription model (${KNOWN.join(', ')}, or a \`claude-*\` id). A bad alias bricks the channel — claude errors at first turn. Re-run with \`--force\` if intended.`
    }
  }

  const updated = { ...entry.project }
  if (setName) updated.model = setName
  else delete updated.model
  saveConfig({ ...config, projects: { ...config.projects, [entry.chatId]: updated } })

  let respawnNote = '_subprocess will respawn on next message with the new model._'
  if (ctx.mutator?.killProject) {
    try {
      await ctx.mutator.killProject(entry.chatId)
      respawnNote = '_subprocess killed; next message will spawn it with the new model._'
    } catch (err) {
      respawnNote = `_kill failed: ${(err as Error).message}_`
    }
  }
  const m = setName ?? config.defaults.model
  return `✅ **${entry.project.slug}**: model = \`${m}\`\n${respawnNote}`
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
export async function handleProvider(rest: string[], ctx: MasterContext): Promise<string> {
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
 * `!project teams-setup <APP_ID> <APP_SECRET>`
 *
 * Without args: print Azure Bot Registration setup instructions.
 * With args: write TEAMS_APP_ID and TEAMS_APP_SECRET to the .env file
 * (appending or overwriting existing lines). Mode 0600.
 */
function handleTeamsSetup(rest: string[]): string {
  if (rest.length < 2) {
    return [
      '**Teams setup**: create an Azure Bot Registration at portal.azure.com:',
      '```',
      '1. Create → "Azure Bot" resource',
      '2. Bot handle: choose any name',
      '3. Messaging endpoint: https://<your-server-host>/teams',
      '4. Under "Configuration" → "Manage Password" → add a client secret',
      '5. Note the App ID (from "Configuration") and the secret value',
      '```',
      'Then run:',
      '```',
      '!project teams-setup <APP_ID> <APP_SECRET>',
      '```',
    ].join('\n')
  }

  const appId = rest[0]!
  const appSecret = rest[1]!

  // These are written as `KEY=value` lines into a shared .env. A value
  // containing a newline could inject arbitrary env vars (e.g. a second
  // line overriding DISCORD_BOT_TOKEN); `=`/control chars corrupt parsing.
  if (/[\n\r\0]/.test(appId) || /[\n\r\0]/.test(appSecret)) {
    return '❌ APP_ID / APP_SECRET may not contain newlines or control characters'
  }

  const envPath = join(channelsDir(), '.env')

  let current = ''
  try {
    current = readFileSync(envPath, 'utf8')
  } catch {
    // File may not exist yet; start fresh.
  }

  // Remove any existing TEAMS_APP_ID / TEAMS_APP_SECRET lines.
  const lines = current.split('\n').filter(
    (l) => !l.startsWith('TEAMS_APP_ID=') && !l.startsWith('TEAMS_APP_SECRET='),
  )
  // Trim trailing empty lines so we don't accumulate blank rows.
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop()
  }

  lines.push(`TEAMS_APP_ID=${appId}`)
  lines.push(`TEAMS_APP_SECRET=${appSecret}`)
  lines.push('')

  writeFileSync(envPath, lines.join('\n'), { mode: 0o600 })

  return [
    `✅ Teams credentials written to \`${envPath}\`.`,
    `TEAMS_APP_ID: \`${appId}\``,
    `TEAMS_APP_SECRET: \`${'*'.repeat(Math.min(appSecret.length, 8))}...\``,
    '_Restart the bot for the new env vars to take effect._',
  ].join('\n')
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

async function handleMemory(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  const sub = positional[0] ?? 'stats'

  if (sub === 'stats') {
    if (!ctx.memoryStore) return 'memory store not configured'
    const s = ctx.memoryStore.stats()
    const lines = [`**Memory stats** — ${s.total} total`]
    if (s.total > 5000) lines.push('⚠️ store has >5K entries — consider clearing old memories')
    lines.push('**By type:**')
    for (const [type, count] of Object.entries(s.byType)) lines.push(`  • ${type}: ${count}`)
    lines.push('**By channel:**')
    for (const [slug, count] of Object.entries(s.bySlug)) lines.push(`  • ${slug}: ${count}`)
    return lines.join('\n')
  }

  if (sub === 'backup') {
    if (!ctx.memoryStore) return 'memory store not configured'
    const cfg = loadConfig()
    const r2Cfg = cfg.defaults.memory?.r2
    if (!r2Cfg) return 'no R2 config in `defaults.memory.r2` — backup skipped'
    const accessKeyId = process.env[r2Cfg.accessKeyIdEnv] ?? ''
    const secretAccessKey = process.env[r2Cfg.secretAccessKeyEnv] ?? ''
    if (!accessKeyId || !secretAccessKey) return `missing env vars: ${r2Cfg.accessKeyIdEnv}, ${r2Cfg.secretAccessKeyEnv}`
    const r2: R2Config = { bucket: r2Cfg.bucket, endpoint: r2Cfg.endpoint, accessKeyId, secretAccessKey }
    try {
      const { memoryDbFile } = await import('./paths.ts')
      ctx.memoryStore.checkpoint()
      const key = await backupMemory(r2, memoryDbFile())
      return key ? `✅ backed up to \`${key}\`` : 'backup skipped (no config)'
    } catch (err) {
      return `❌ backup failed: ${(err as Error).message}`
    }
  }

  if (sub === 'clear') {
    if (!ctx.memoryStore) return 'memory store not configured'
    if (!flags.yes) return '`memory clear` requires `--yes`'
    const slug = typeof flags.slug === 'string' ? flags.slug : null
    const type = typeof flags.type === 'string' ? flags.type : null
    const results = await ctx.memoryStore.recall('', { slug: slug ?? undefined, type: type as MemoryType ?? undefined, limit: 10000 })
    for (const m of results) ctx.memoryStore.forget(m.id)
    return `✅ cleared ${results.length} memories${slug ? ` for slug \`${slug}\`` : ''}${type ? ` of type \`${type}\`` : ''}`
  }

  return `unknown memory subverb \`${sub}\`. valid: stats, backup, clear`
}

export const HEARTBEAT_OK = 'HEARTBEAT_OK'

function handleHeartbeat(rest: string[], ctx: MasterContext): string {
  const { flags } = parseFlags(rest)
  const channelSlug = typeof flags.channel === 'string' ? flags.channel : null
  const quiet = flags.quiet === true

  const config = loadConfig()

  // Build the full attention report
  const deps = {
    getCircuitStates: ctx.getCircuitStates,
    loadSchedules: () => loadSchedules(),
    readSpecclawStatus,
  }
  let allItems = buildAttentionReport(config, deps)

  // Count projects scanned (affected by --channel filter)
  let scannedCount = Object.keys(config.projects).length

  if (channelSlug !== null) {
    // Validate slug exists
    const found = Object.values(config.projects).find(p => p.slug === channelSlug)
    if (!found) return `unknown channel \`${channelSlug}\``
    allItems = allItems.filter(i => i.slug === channelSlug)
    scannedCount = 1
  }

  // Zero items: quiet → sentinel; non-quiet → summary
  if (allItems.length === 0) {
    if (quiet) return HEARTBEAT_OK
    return `✅ all quiet — ${scannedCount} channel${scannedCount === 1 ? '' : 's'} scanned`
  }

  // Has items: render report (same with or without --quiet per FR7)
  const ts = new Date().toISOString()
  const lines: string[] = [`Heartbeat — ${ts}`]

  const sevEmoji: Record<string, string> = { blocked: '🔴', review: '🟡', info: '🔵' }
  const CAP = 15
  const displayed = allItems.slice(0, CAP)
  const overflow = allItems.length - displayed.length

  for (const item of displayed) {
    const emoji = sevEmoji[item.severity] ?? '⚪'
    lines.push(`${emoji} <#${item.chatId}> **${item.slug}** — ${item.summary}`)
    if (item.action) lines.push(`  ↳ ${item.action}`)
    if (item.detail) lines.push(`  > ${item.detail}`)
  }

  if (overflow > 0) lines.push(`(+${overflow} more)`)

  return lines.join('\n')
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

export async function evaluateBatchPr(slug: string, ctx: MasterContext, notifyFn: (text: string) => Promise<void>): Promise<void> {
  const config = ctx.config
  const entry = Object.entries(config.projects).find(([, p]) => p.slug === slug)
  if (!entry) return
  const project = entry[1]
  if (!project.developBranch) return

  const { checkPipelineGreen } = await import('./specclaw-guard.ts')
  const { runGit } = await import('./git-ops.ts')
  const { execSync } = await import('node:child_process')
  const cwd = projectDir(slug)

  // Count proposals verified in STATUS.md
  const statusPath = join(cwd, '.specclaw', 'STATUS.md')
  let proposalCount = 0
  try {
    const statusText = readFileSync(statusPath, 'utf-8')
    // Count occurrences of green Verify rows across the whole STATUS.md
    proposalCount = (statusText.match(/\| Verify\s*\|\s*🟢/g) ?? []).length
  } catch { return }

  // Count line diff between develop and main
  const diffResult = runGit(cwd, ['diff', '--stat', 'main...develop'])
  if (!diffResult.ok) return
  const lineMatch = diffResult.stdout.match(/(\d+) insertions?\(\+\)/)
  const lineCount = lineMatch ? parseInt(lineMatch[1]!, 10) : 0

  const defaults = config.defaults
  const threshold = (defaults as typeof defaults & { batchThreshold?: { proposals: number; lines: number } }).batchThreshold
  const minProposals = threshold?.proposals ?? 5
  const minLines = threshold?.lines ?? 500

  if (proposalCount < minProposals || lineCount < minLines) {
    if (proposalCount > 0 || lineCount > 0) {
      await notifyFn(`📊 **${slug}** develop progress: ${proposalCount}/${minProposals} proposals, ${lineCount}/${minLines} lines`)
    }
    return
  }

  // Both thresholds met — run pipeline guard
  const guard = checkPipelineGreen(cwd)
  if (!guard.ok) {
    await notifyFn(`⚠️ **${slug}** batch PR blocked — pipeline not green: ${guard.blockedBy.join(', ')}`)
    return
  }

  // Create PR
  try {
    const result = execSync(
      `gh pr create --base main --head develop --title "chore(${slug}): batch proposals (${proposalCount} changes)" --body "Automated batch PR: ${proposalCount} specclaw proposals, ${lineCount} lines diff"`,
      { cwd, encoding: 'utf-8', timeout: 30_000 }
    )
    await notifyFn(`🚀 **${slug}** batch PR created: ${result.trim()}`)
  } catch (err) {
    await notifyFn(`❌ **${slug}** batch PR failed: ${(err as Error).message.slice(0, 200)}`)
  }
}

async function handleProgress(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)
  if (positional.length === 0) return '`progress` needs a chat_id or slug'
  const target = positional[0]!
  const setMode = typeof flags.set === 'string' ? (flags.set as ProgressMode) : null
  const clear = flags.clear === true
  if (setMode && clear) return 'pass either `--set <mode>` or `--clear`, not both'
  if (setMode && !['off', 'edit', 'post', 'phases'].includes(setMode)) {
    return '`--set` must be one of: `off`, `edit`, `post`, `phases`'
  }

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  if (!setMode && !clear) {
    const mode = entry.project.progressMode ?? config.defaults.progressMode ?? 'off'
    const inherited = entry.project.progressMode == null ? ' (inherited from defaults)' : ''
    return `**${entry.project.slug}**: progressMode = \`${mode}\`${inherited}`
  }

  const updated = { ...entry.project }
  if (setMode) updated.progressMode = setMode
  else delete updated.progressMode
  saveConfig({ ...config, projects: { ...config.projects, [entry.chatId]: updated } })

  const mode = setMode ?? config.defaults.progressMode ?? 'off'
  return `✅ **${entry.project.slug}**: progressMode = \`${mode}\`\n_takes effect immediately (no restart needed)._`
}

async function handleHermes(rest: string[], ctx: MasterContext): Promise<string> {
  const { positional, flags } = parseFlags(rest)

  const hcfg = ctx.config.defaults.hermes
  if (!hcfg?.enabled) {
    return 'Hermes bridge is disabled. To enable it, add `"hermes": { "enabled": true, "binPath": "/path/to/hermes" }` under `defaults` in channels.json.'
  }

  // --tail mode
  if (typeof flags.tail === 'string') {
    const runId = flags.tail
    const lines = typeof flags.lines === 'string' ? parseInt(flags.lines, 10) : 40
    const content = tailHermesRun(runId, isNaN(lines) ? 40 : lines)
    if (content === null) {
      const recent = listRecentRuns(10)
      const list = recent.length > 0 ? recent.join(', ') : 'none'
      return `Run \`${runId}\` not found. Recent runs: ${list}`
    }
    return `**Log tail for \`${runId}\`:**\n\`\`\`\n${content}\n\`\`\``
  }

  // launch mode
  const prompt = positional.join(' ')
  if (!prompt.trim()) {
    return 'Usage: `!project hermes "<prompt>" [--model <m>] [--no-report]`'
  }

  const model = typeof flags.model === 'string' ? flags.model : undefined
  const report = flags['no-report'] !== true
  const masterChatId = ctx.config.master!.chatId

  try {
    const { runId, logPath } = launchHermesRun({
      prompt,
      cfg: hcfg,
      masterChatId,
      model,
      report,
      spawnFn: ctx.hermesSpawnFn as any,
    })
    const reportNote = report ? '\nHermes will report back to this channel when finished.' : ''
    return `Hermes run launched: \`${runId}\`\nLog: \`${logPath}\`${reportNote}`
  } catch (err) {
    return `Failed to launch Hermes run: ${(err as Error).message}`
  }
}

/**
 * `!project backlog <chat_id-or-slug>` — read-only backlog status.
 * Shows source, X/Y progress, autopilot state, and effective settings.
 */
async function handleBacklog(rest: string[], _ctx: MasterContext): Promise<string> {
  const { positional } = parseFlags(rest)
  if (positional.length === 0) return '`backlog` needs a chat_id or slug'
  const target = positional[0]!

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const { project } = entry
  const ap = project.autopilot
  const dir = projectDir(project.slug)
  const file = ap?.file ?? 'BACKLOG.md'

  // Detect source and snapshot progress
  const source = existsSync(dir) ? detectBacklogSource(dir, file) : 'none'
  const snap = existsSync(dir) ? snapshotBacklog(dir, source, file) : { done: 0, total: 0 }

  // Effective limits
  const effectiveInterval = ap?.intervalMinutes ?? config.defaults.autopilot?.intervalMinutes ?? 30
  const effectiveStall = ap?.stallThreshold ?? config.defaults.autopilot?.stallThreshold ?? 3
  const respectWindow = ap?.respectHeartbeatWindow ?? true
  const hwWindow = project.heartbeat?.window

  const lines = [
    `**Backlog — ${project.slug}**`,
    `source: ${source}${source === 'file' ? ` (\`${file}\`)` : ''}`,
    `progress: ${snap.done}/${snap.total} done`,
    `autopilot: ${ap?.enabled ? 'enabled' : 'disabled'}`,
    `state: ${ap?.state ?? '—'}`,
    `last fire: ${ap?.lastFireAt ?? 'never'}`,
    `zeroDeltaCount: ${ap?.zeroDeltaCount ?? 0}`,
    `effectiveIntervalMinutes: ${effectiveInterval}`,
    `stallThreshold: ${effectiveStall}`,
    `respectHeartbeatWindow: ${respectWindow}${hwWindow ? ` (window: ${hwWindow})` : ''}`,
  ]
  return lines.join('\n')
}

/**
 * `!project collab <chat_id-or-slug>` — read-only collab status.
 * Shows configured roles (marking entries that no longer resolve as stale)
 * and open (pending) handoffs involving this project. Works even when the
 * `handoff` reach flag is off — config display grants no reach.
 */
function handleCollab(rest: string[], ctx: MasterContext): string {
  const { positional } = parseFlags(rest)
  if (positional.length === 0) return '`collab` needs a chat_id or slug'
  const target = positional[0]!

  const config = loadConfig()
  const entry = resolveTarget(config, target)
  if (!entry) return `no project found for "${target}"`

  const { chatId, project } = entry
  const lines = [`**Collab — ${project.slug}**`]

  // Configured roles, flagging any that no longer resolve (stale after a
  // rename/delete or a botPeers.allow change).
  const roles = project.collab?.roles ?? {}
  const roleNames = Object.keys(roles)
  if (roleNames.length === 0) {
    lines.push('_no collab roles configured — add one with `set --collab-role <name>=<slug|botId>`._')
  } else {
    lines.push('roles:')
    for (const name of roleNames) {
      const resolved = resolveCollabTarget(config, chatId, name)
      const staleMark = 'error' in resolved ? ' (stale)' : ''
      lines.push(`  ${name} → ${roles[name]}${staleMark}`)
    }
  }

  // Open (pending) handoffs where this project is the sender or the target.
  const registry = (ctx.loadHandoffRegistry ?? loadRegistry)()
  const open = registry.filter(
    r => r.state === 'pending' && (r.from === project.slug || r.to.chatId === chatId),
  )
  if (open.length === 0) {
    lines.push('_no open handoffs._')
  } else {
    lines.push('open handoffs:')
    const nowMs = Date.now()
    for (const r of open) {
      const toName = r.to.kind === 'project' ? r.to.slug : r.to.botId
      const ageMin = Math.max(0, Math.floor((nowMs - Date.parse(r.createdAt)) / 60_000))
      const task = r.task.length > 80 ? `${r.task.slice(0, 79)}…` : r.task
      lines.push(`  #${r.id} ${r.from}→${toName} ${ageMin}m: ${task}`)
    }
  }

  return lines.join('\n')
}
