/**
 * Hand-rolled smoke tests, run with: bun src/master-commands.test.ts
 * Exits 0 on pass, 1 on first failure. Keeps phase 2 tight without pulling
 * in a test framework.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitArgv, parseFlags } from './argv.ts'
import { handleMasterCommand, type MasterContext, type MasterMutator } from './master-commands.ts'
import { ChannelsConfigSchema, loadConfig, resolveClaudeArgs, saveConfig } from './channels-config.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// --- argv splitter ---------------------------------------------------------
check('splitArgv: simple', JSON.stringify(splitArgv('a b c')) === JSON.stringify(['a', 'b', 'c']))
check(
  'splitArgv: double-quoted',
  JSON.stringify(splitArgv('a "b c d" e')) === JSON.stringify(['a', 'b c d', 'e']),
)
check(
  'splitArgv: escaped quote',
  JSON.stringify(splitArgv('"hello \\"world\\""')) === JSON.stringify(['hello "world"']),
)
let threw = false
try {
  splitArgv('"unterminated')
} catch {
  threw = true
}
check('splitArgv: throws on unterminated quote', threw)

// --- flag parser -----------------------------------------------------------
const fp = parseFlags(['--name', 'X', '--prompt=hi there', 'positional', '--bool'])
check('parseFlags: --name X', fp.flags.name === 'X')
check('parseFlags: --prompt= form', fp.flags.prompt === 'hi there')
check('parseFlags: positional', fp.positional[0] === 'positional')
check('parseFlags: bare --flag is true', fp.flags.bool === true)

// --- master-commands runtime ----------------------------------------------
const stateDir = mkdtempSync(join(tmpdir(), 'mcd-test-'))
process.env.MCD_CHANNELS_DIR = stateDir
mkdirSync(join(stateDir, 'projects', 'master-test'), { recursive: true })
writeFileSync(
  join(stateDir, 'projects', 'master-test', 'CLAUDE.md'),
  'You are the master project. Be terse.\n',
)

const config = ChannelsConfigSchema.parse({
  master: { chatId: '123456789012345678' },
  projects: {
    '123456789012345678': { slug: 'master-test' },
    '999888777666555444': { slug: 'support', model: 'opus', git: { remote: 'https://github.com/x/y.git', branch: 'main', credentials: 'github-default' } },
  },
})

const baseCtx: Omit<MasterContext, 'chatId' | 'userId' | 'config'> = {
  authorizedUsers: ['797184740293476362'],
}

function ctx(over: Partial<MasterContext> = {}): MasterContext {
  return {
    chatId: '123456789012345678',
    userId: '797184740293476362',
    config,
    ...baseCtx,
    ...over,
  }
}

// Persist the seed config so mutation verbs can reload it from disk.
saveConfig(config)

const noPrefix = await handleMasterCommand('hello there', ctx())
check('non-prefix message is passthrough', noPrefix.kind === 'no-prefix', JSON.stringify(noPrefix))

const wrongChannel = await handleMasterCommand('!project list', ctx({ chatId: '111122223333444455' }))
check('wrong channel is passthrough (not-master)', wrongChannel.kind === 'not-master', JSON.stringify(wrongChannel))

const wrongUser = await handleMasterCommand('!project list', ctx({ userId: '000000000000000000' }))
check('wrong user is unauthorized', wrongUser.kind === 'unauthorized', JSON.stringify(wrongUser))

const list = await handleMasterCommand('!project list', ctx())
check('list verb returns reply', list.kind === 'reply', JSON.stringify(list))
check(
  'list shows both projects',
  list.kind === 'reply' && list.text.includes('master-test') && list.text.includes('support'),
)

const help = await handleMasterCommand('!project', ctx())
check('bare !project shows help', help.kind === 'reply' && help.text.includes('Master commands'))

const showSlug = await handleMasterCommand('!project show support', ctx())
check(
  'show by slug renders config + remote',
  showSlug.kind === 'reply' &&
    showSlug.text.includes('support') &&
    showSlug.text.includes('https://github.com/x/y.git'),
)

const showById = await handleMasterCommand('!project show 123456789012345678', ctx())
check(
  'show by chat_id renders prompt preview',
  showById.kind === 'reply' && showById.text.includes('Be terse'),
)

const showMissing = await handleMasterCommand('!project show ghost-slug', ctx())
check(
  'show on unknown slug yields not-found reply',
  showMissing.kind === 'reply' && showMissing.text.includes('no project found'),
)

const unknown = await handleMasterCommand('!project banana', ctx())
check(
  'unknown verb suggests valid ones',
  unknown.kind === 'reply' && unknown.text.includes('list, show'),
)

const phase5 = await handleMasterCommand('!project clone 123 --slug x', ctx())
check('phase-5 verb stubbed', phase5.kind === 'reply' && phase5.text.includes('phase 5'))

const noMaster = await handleMasterCommand('!project list', {
  ...ctx(),
  config: ChannelsConfigSchema.parse({}),
})
check('no master configured returns no-master-configured', noMaster.kind === 'no-master-configured')

// --- mutation verbs (phase 4) --------------------------------------------
const killCalls: string[] = []
const mutator: MasterMutator = {
  killProject: async (id) => {
    killCalls.push(id)
  },
}
function mctx(over: Partial<MasterContext> = {}): MasterContext {
  return { ...ctx(over), mutator, config: loadConfig() }
}

// create
const created = await handleMasterCommand(
  '!project create 444444444444444444 --slug newproj --prompt "be helpful"',
  mctx(),
)
check('create: success reply', created.kind === 'reply' && created.text.includes('newproj'))
check('create: directory exists', existsSync(join(stateDir, 'projects', 'newproj')))
check(
  'create: CLAUDE.md written',
  readFileSync(join(stateDir, 'projects', 'newproj', 'CLAUDE.md'), 'utf8').trim() === 'be helpful',
)
const afterCreate = loadConfig()
check('create: registered in channels.json', afterCreate.projects['444444444444444444']?.slug === 'newproj')

// create with conflicting slug
const conflictSlug = await handleMasterCommand(
  '!project create 555555555555555555 --slug newproj --prompt "x"',
  mctx(),
)
check(
  'create: conflicting slug rejected',
  conflictSlug.kind === 'reply' && conflictSlug.text.includes('already in use'),
)

// create with existing chat_id
const conflictChat = await handleMasterCommand(
  '!project create 444444444444444444 --slug different --prompt "x"',
  mctx(),
)
check(
  'create: conflicting chat_id rejected',
  conflictChat.kind === 'reply' && conflictChat.text.includes('already mapped'),
)

// create with bad slug
const badSlug = await handleMasterCommand(
  '!project create 666666666666666666 --slug BadSlug --prompt "x"',
  mctx(),
)
check('create: bad slug rejected', badSlug.kind === 'reply' && badSlug.text.includes('must match'))

// set --prompt
killCalls.length = 0
const setReply = await handleMasterCommand(
  '!project set newproj --prompt "updated prompt"',
  mctx(),
)
check('set: reports rewrite', setReply.kind === 'reply' && setReply.text.includes('rewrote CLAUDE.md'))
check(
  'set: CLAUDE.md updated',
  readFileSync(join(stateDir, 'projects', 'newproj', 'CLAUDE.md'), 'utf8').trim() === 'updated prompt',
)
check('set: triggers killProject for respawn', killCalls.includes('444444444444444444'))

// rename
killCalls.length = 0
const renamed = await handleMasterCommand('!project rename newproj --slug renamedproj', mctx())
check('rename: success reply', renamed.kind === 'reply' && renamed.text.includes('renamed'))
check('rename: old dir gone', !existsSync(join(stateDir, 'projects', 'newproj')))
check('rename: new dir exists', existsSync(join(stateDir, 'projects', 'renamedproj')))
check(
  'rename: channels.json updated',
  loadConfig().projects['444444444444444444']?.slug === 'renamedproj',
)
check('rename: kills before move', killCalls.includes('444444444444444444'))

// rm without --yes
const rmNoYes = await handleMasterCommand('!project rm renamedproj', mctx())
check(
  'rm: refuses without --yes',
  rmNoYes.kind === 'reply' && rmNoYes.text.includes('--yes'),
)

// rm --yes
killCalls.length = 0
const rm = await handleMasterCommand('!project rm renamedproj --yes', mctx())
check('rm: success reply', rm.kind === 'reply' && rm.text.includes('archived'))
check('rm: removed from channels.json', !loadConfig().projects['444444444444444444'])
check(
  'rm: working dir moved to .archive',
  !existsSync(join(stateDir, 'projects', 'renamedproj')) &&
    existsSync(join(stateDir, 'projects', '.archive')),
)
check('rm: kills before archiving', killCalls.includes('444444444444444444'))

// rm refuses to remove master
const rmMaster = await handleMasterCommand('!project rm master-test --yes', mctx())
check(
  'rm: refuses master project',
  rmMaster.kind === 'reply' && rmMaster.text.includes('refusing to rm the master'),
)

// --- resolveClaudeArgs ----------------------------------------------------
{
  const cfg = ChannelsConfigSchema.parse({
    defaults: {
      claude: {
        permissionMode: 'auto',
        extraArgs: ['--no-banner'],
      },
    },
    projects: {
      '111111111111111111': { slug: 'inherits' },
      '222222222222222222': {
        slug: 'overrides',
        claude: {
          permissionMode: 'plan',
          allowedTools: ['Read'],
          extraArgs: ['--debug'],
        },
      },
    },
  })

  const inherits = resolveClaudeArgs(cfg, cfg.projects['111111111111111111']!)
  check('claudeArgs: inherits permissionMode from defaults', inherits.permissionMode === 'auto')
  check(
    'claudeArgs: inherits extraArgs',
    JSON.stringify(inherits.extraArgs) === JSON.stringify(['--no-banner']),
  )

  const overrides = resolveClaudeArgs(cfg, cfg.projects['222222222222222222']!)
  check('claudeArgs: project permissionMode wins', overrides.permissionMode === 'plan')
  check('claudeArgs: project allowedTools wins', JSON.stringify(overrides.allowedTools) === JSON.stringify(['Read']))
  check(
    'claudeArgs: extraArgs concat (defaults first, project last)',
    JSON.stringify(overrides.extraArgs) === JSON.stringify(['--no-banner', '--debug']),
  )
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nall checks passed`)
