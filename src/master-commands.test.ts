/**
 * Hand-rolled smoke tests, run with: bun src/master-commands.test.ts
 * Exits 0 on pass, 1 on first failure. Keeps phase 2 tight without pulling
 * in a test framework.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitArgv, parseFlags } from './argv.ts'
import { handleMasterCommand, type MasterContext } from './master-commands.ts'
import { ChannelsConfigSchema } from './channels-config.ts'

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

const noPrefix = handleMasterCommand('hello there', ctx())
check('non-prefix message is passthrough', noPrefix.kind === 'no-prefix', JSON.stringify(noPrefix))

const wrongChannel = handleMasterCommand('!project list', ctx({ chatId: '111122223333444455' }))
check('wrong channel is passthrough (not-master)', wrongChannel.kind === 'not-master', JSON.stringify(wrongChannel))

const wrongUser = handleMasterCommand('!project list', ctx({ userId: '000000000000000000' }))
check('wrong user is unauthorized', wrongUser.kind === 'unauthorized', JSON.stringify(wrongUser))

const list = handleMasterCommand('!project list', ctx())
check('list verb returns reply', list.kind === 'reply', JSON.stringify(list))
check(
  'list shows both projects',
  list.kind === 'reply' && list.text.includes('master-test') && list.text.includes('support'),
)

const help = handleMasterCommand('!project', ctx())
check('bare !project shows help', help.kind === 'reply' && help.text.includes('Master commands'))

const showSlug = handleMasterCommand('!project show support', ctx())
check(
  'show by slug renders config + remote',
  showSlug.kind === 'reply' &&
    showSlug.text.includes('support') &&
    showSlug.text.includes('https://github.com/x/y.git'),
)

const showById = handleMasterCommand('!project show 123456789012345678', ctx())
check(
  'show by chat_id renders prompt preview',
  showById.kind === 'reply' && showById.text.includes('Be terse'),
)

const showMissing = handleMasterCommand('!project show ghost-slug', ctx())
check(
  'show on unknown slug yields not-found reply',
  showMissing.kind === 'reply' && showMissing.text.includes('no project found'),
)

const stub = handleMasterCommand('!project create 123 --slug x', ctx())
check(
  'mutation verb is stubbed (phase 4)',
  stub.kind === 'reply' && stub.text.includes('phase 4'),
)

const unknown = handleMasterCommand('!project banana', ctx())
check(
  'unknown verb suggests valid ones',
  unknown.kind === 'reply' && unknown.text.includes('list, show'),
)

const noMaster = handleMasterCommand('!project list', {
  ...ctx(),
  config: ChannelsConfigSchema.parse({}),
})
check('no master configured returns no-master-configured', noMaster.kind === 'no-master-configured')

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nall checks passed`)
