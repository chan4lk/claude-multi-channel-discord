/** Focused Codex command flow; run with bun src/codex-commands.test.ts. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChannelsConfigSchema, loadConfig, saveConfig } from './channels-config.ts'
import { handleMasterCommand, type MasterContext } from './master-commands.ts'
import { handleProviderInteraction } from './provider-command.ts'

const root = mkdtempSync(join(tmpdir(), 'mcd-codex-commands-'))
process.env.MCD_CHANNELS_DIR = root
process.env.MINIMAX_API_KEY = 'test-only-key'
const masterId = '999999999999999999'
const codexId = '777700000000000011'
const minimaxId = '777700000000000012'
const cloneId = '777700000000000013'
const miniCloneId = '777700000000000014'
const kills: string[] = []
const initial = ChannelsConfigSchema.parse({
  master: { chatId: masterId },
  defaults: { providers: { minimax: { baseUrl: 'https://example.test/anthropic', apiKeyEnv: 'MINIMAX_API_KEY' } } },
  projects: { [masterId]: { slug: 'master' } },
})
mkdirSync(join(root, 'projects', 'master'), { recursive: true })
writeFileSync(join(root, 'projects', 'master', 'CLAUDE.md'), 'Master')
saveConfig(initial)

function check(value: unknown, label: string): void {
  if (!value) throw new Error(`FAIL ${label}`)
  console.log(`PASS ${label}`)
}

function context(): MasterContext {
  return {
    chatId: masterId, userId: '123456789012345678', authorizedUsers: ['123456789012345678'],
    config: loadConfig(), mutator: { killProject: async (chatId: string) => { kills.push(chatId) } },
  }
}

async function command(text: string): Promise<string> {
  const result = await handleMasterCommand(`!project ${text}`, context())
  check(result.kind === 'reply', `reply for ${text.split(' ')[0]}`)
  return result.kind === 'reply' ? result.text : ''
}

try {
  const created = await command(`create ${codexId} --slug codex-one --prompt "Code here" --provider codex`)
  check(created.includes('Runner: codex') && created.includes('(Codex default)'), 'create selects Codex and its model default')
  check(loadConfig().projects[codexId]?.runner === 'codex', 'create persists runner')
  const miniCreated = await command(`create ${minimaxId} --slug mini-one --prompt "Code here" --provider minimax`)
  check(miniCreated.includes('created') && loadConfig().projects[minimaxId]?.provider === 'minimax' &&
    (await command('provider mini-one')).includes('provider = minimax'), 'MiniMax create remains an alias')
  check((await command('show codex-one')).includes('runner: codex'), 'show identifies runner')
  check((await command('model codex-one --set gpt-6')).includes('gpt-6'), 'model applies to Codex')

  kills.length = 0
  await command('provider codex-one --set minimax')
  check(loadConfig().projects[codexId]?.runner !== 'codex' && loadConfig().projects[codexId]?.provider === 'minimax', 'switch to MiniMax uses Claude runner')
  await command('provider codex-one --set codex')
  check(loadConfig().projects[codexId]?.runner === 'codex' && !loadConfig().projects[codexId]?.provider, 'switch back to Codex')
  await command('provider codex-one --clear')
  check(!loadConfig().projects[codexId]?.runner && !loadConfig().projects[codexId]?.provider, 'clear restores Claude default')
  check(kills.length === 3 && kills.every((chatId) => chatId === codexId), 'only selected project restarts')
  check((await command('provider codex-one --set unknown')).includes('not in defaults.providers'), 'unknown alias rejected')

  const repo = join(root, 'source.git')
  check(spawnSync('git', ['init', '--bare', repo]).status === 0, 'local clone fixture created')
  const cloned = await command(`clone ${cloneId} --slug codex-clone --repo ${repo} --provider codex`)
  check(cloned.includes('Runner: codex') && loadConfig().projects[cloneId]?.runner === 'codex', 'clone exposes and persists Codex runner')
  const miniCloned = await command(`clone ${miniCloneId} --slug mini-clone --repo ${repo} --provider minimax`)
  check(miniCloned.includes('cloned') && loadConfig().projects[miniCloneId]?.provider === 'minimax', 'MiniMax clone remains a Claude provider alias')

  const slashReplies: string[] = []
  async function slash(subcommand: string, alias?: string): Promise<void> {
    const interaction = {
      channelId: minimaxId, user: { id: '123456789012345678' },
      options: { getSubcommand: () => subcommand, getString: () => alias },
      deferReply: async () => {}, editReply: async (text: string) => { slashReplies.push(text) },
      reply: async (value: { content: string }) => { slashReplies.push(value.content) },
    } as unknown as Parameters<typeof handleProviderInteraction>[0]
    await handleProviderInteraction(interaction, {
      mutator: { killProject: async (chatId: string) => { kills.push(chatId) } },
      isAllowed: () => true,
    })
  }
  await slash('set', 'codex')
  await slash('show')
  check(loadConfig().projects[minimaxId]?.runner === 'codex' && slashReplies.at(-1)?.includes('runner = codex'), '/provider selects and shows Codex')
  await slash('clear')
  check(!loadConfig().projects[minimaxId]?.runner && slashReplies.at(-1)?.includes('Claude'), '/provider clear restores Claude')

  check(!ChannelsConfigSchema.safeParse({ defaults: { providers: { codex: { baseUrl: 'https://example.test', apiKeyEnv: 'KEY' } } } }).success, 'codex alias is reserved')
  console.log('All Codex command checks passed.')
} finally {
  delete process.env.MINIMAX_API_KEY
  delete process.env.MCD_CHANNELS_DIR
  rmSync(root, { recursive: true, force: true })
}
