import { existsSync, readFileSync, statSync } from 'node:fs'

import { parseFlags, splitArgv } from './argv.ts'
import {
  commandPrefix,
  findProjectByChatId,
  findProjectBySlug,
  isMasterChannel,
  type ChannelsConfig,
  type Project,
} from './channels-config.ts'
import { projectClaudeMd } from './paths.ts'

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
  /**
   * Discord user IDs allowed to drive master commands. Pass the union of
   *   access.allowFrom (DM allowlist)  ∪
   *   access.groups[masterChatId].allowFrom (or [] meaning any group member).
   * Empty array = no one is authorized.
   */
  authorizedUsers: string[]
}

const VERBS_PHASE_1 = ['list', 'show', 'status', 'help'] as const

export function handleMasterCommand(content: string, ctx: MasterContext): MasterCommandResult {
  const { config, chatId, userId } = ctx

  if (!config.master) return { kind: 'no-master-configured' }
  if (!isMasterChannel(config, chatId)) return { kind: 'not-master' }

  const prefix = commandPrefix(config)
  const trimmed = content.trim()
  if (!trimmed.startsWith(prefix)) return { kind: 'no-prefix' }

  // Authorization. The parser runs only on master-channel messages, but the
  // group's allowFrom may further restrict who triggers commands.
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
    case 'clone':
    case 'set':
    case 'rename':
    case 'remote':
    case 'rm':
    case 'pull':
      return {
        kind: 'reply',
        text: `\`${verb}\` lands in phase 4 once the project pool exists. For now use \`/discord:project\` from the terminal where it applies.`,
      }
    default:
      return {
        kind: 'reply',
        text: `unknown verb \`${verb}\`. try one of: ${VERBS_PHASE_1.join(', ')}`,
      }
  }
}

function helpText(prefix: string): string {
  return [
    '**Master commands** (read-only verbs available now):',
    '```',
    `${prefix} list                          — list all projects`,
    `${prefix} show   <chat_id-or-slug>      — show one project's config`,
    `${prefix} status <chat_id-or-slug>      — alias for show until git lands`,
    `${prefix} help                          — this message`,
    '```',
    '_Mutation verbs (`create`, `clone`, `set`, `rename`, `remote`, `rm`, `pull`) are coming next phase._',
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

  let entry: { chatId: string; project: Project } | undefined
  if (/^\d{15,25}$/.test(target)) {
    const project = findProjectByChatId(config, target)
    if (project) entry = { chatId: target, project }
  } else {
    entry = findProjectBySlug(config, target)
  }

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
