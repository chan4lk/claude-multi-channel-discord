/**
 * Hand-rolled smoke tests, run with: bun src/master-commands.test.ts
 * Exits 0 on pass, 1 on first failure. Keeps phase 2 tight without pulling
 * in a test framework.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { splitArgv, parseFlags } from './argv.ts'
import { handleMasterCommand, HEARTBEAT_OK, type MasterContext, type MasterMutator } from './master-commands.ts'
import { ChannelsConfigSchema, loadConfig, resolveClaudeArgs, saveConfig } from './channels-config.ts'
import { loadSchedules } from './schedules-config.ts'
import { classifyChannel } from './heartbeat.ts'

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

// clone now requires --repo. Without it we get a validation error rather
// than the previous "phase 5 stub" message.
const cloneNoRepo = await handleMasterCommand('!project clone 123456789012345678 --slug x', ctx())
check(
  'clone: validates --repo',
  cloneNoRepo.kind === 'reply' && cloneNoRepo.text.includes('--repo'),
)
const remoteShow = await handleMasterCommand('!project remote support', ctx())
check(
  'remote: shows configured remote when present',
  remoteShow.kind === 'reply' && remoteShow.text.includes('https://github.com/x/y.git'),
)
const pullNoArg = await handleMasterCommand('!project pull', ctx())
check(
  'pull: needs target arg',
  pullNoArg.kind === 'reply' && pullNoArg.text.includes('chat_id or slug'),
)

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
{
  const claudeMd = readFileSync(join(stateDir, 'projects', 'newproj', 'CLAUDE.md'), 'utf8')
  check('create: CLAUDE.md starts with the user prompt', claudeMd.startsWith('be helpful'))
  check('create: CLAUDE.md includes Discord-conventions footer', claudeMd.includes('mcp__mcd__reply'))
}
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

// --- model alias guard ----------------------------------------------------
const badModel = await handleMasterCommand('!project model support --set sonnat', mctx())
check(
  'model: rejects unknown subscription alias (typo)',
  badModel.kind === 'reply' && badModel.text.includes('not a known subscription model'),
)
check(
  'model: bad alias not persisted',
  loadConfig().projects['999888777666555444']?.model === 'opus',
)
const forcedModel = await handleMasterCommand('!project model support --set sonnat --force', mctx())
check(
  'model: --force overrides the guard',
  forcedModel.kind === 'reply' && loadConfig().projects['999888777666555444']?.model === 'sonnat',
)
const goodModel = await handleMasterCommand('!project model support --set sonnet', mctx())
check(
  'model: known alias accepted',
  goodModel.kind === 'reply' && loadConfig().projects['999888777666555444']?.model === 'sonnet',
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

// --- heartbeat watchdog tests --------------------------------------------

// schedule add with interval (interval value must be quoted so argv splitter treats it as one token)
const schedIntervalAdd = await handleMasterCommand(
  '!project schedule add master-test --at "every 30m" --prompt "heartbeat check"',
  mctx(),
)
check('schedule add: interval accepted', schedIntervalAdd.kind === 'reply' && schedIntervalAdd.text.includes('every 30m'))
{
  const scheds = loadSchedules(join(stateDir, 'schedules.json'))
  const entry = scheds.schedules.find(s => s.prompt === 'heartbeat check')
  check('schedule add: interval stored', entry?.interval === 'every 30m')
  check('schedule add: at not stored for interval', entry?.at === undefined)
}

// Re-create newproj for set/heartbeat tests (it was renamed and removed above)
await handleMasterCommand(
  '!project create 444444444444444444 --slug newproj --prompt "be helpful"',
  mctx(),
)

// set heartbeat config
const setHb = await handleMasterCommand(
  '!project set newproj --heartbeat-mode autonomous --heartbeat-window 09:00-17:00',
  mctx(),
)
check('set: heartbeat accepted', setHb.kind === 'reply' && setHb.text.includes('heartbeat'))
{
  const proj = loadConfig().projects['444444444444444444']
  check('set: heartbeat mode persisted', proj?.heartbeat?.mode === 'autonomous')
  check('set: heartbeat window persisted', proj?.heartbeat?.window === '09:00-17:00')
}

// heartbeat classifyChannel tests
{
  // Build the transcript path for the 'newproj' project
  const projCwd = join(stateDir, 'projects', 'newproj')
  const encoded = projCwd.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = join(homedir(), '.claude', 'projects', encoded)
  mkdirSync(transcriptDir, { recursive: true })
  const transcriptFile = join(transcriptDir, 'test-session.jsonl')

  // Write mock transcript: assistant with question, no subsequent user
  const entries = [
    JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'Do something' }] }),
    JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Should I use API A or API B?' }] }),
  ]
  writeFileSync(transcriptFile, entries.join('\n') + '\n')
  // Backdate the file mtime to 2h ago
  const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000)
  utimesSync(transcriptFile, pastDate, pastDate)

  const result = classifyChannel('newproj', loadConfig())
  check('heartbeat: question-unanswered classified as stalled', result.state === 'stalled')
  check('heartbeat: reason is question-unanswered', result.reason === 'question-unanswered')
  check('heartbeat: snippet contains question', result.snippet.includes('?'))
}

{
  // Overwrite the same transcript file with tool_use without tool_result
  const projCwd = join(stateDir, 'projects', 'newproj')
  const encoded = projCwd.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = join(homedir(), '.claude', 'projects', encoded)
  const transcriptFile = join(transcriptDir, 'test-session.jsonl')

  const toolEntries = [
    JSON.stringify({ role: 'user', content: [{ type: 'text', text: 'Do something' }] }),
    JSON.stringify({ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_123', name: 'Bash', input: {} }] }),
    // No tool_result
  ]
  writeFileSync(transcriptFile, toolEntries.join('\n') + '\n')
  const pastDate = new Date(Date.now() - 2 * 60 * 60 * 1000)
  utimesSync(transcriptFile, pastDate, pastDate)

  const result2 = classifyChannel('newproj', loadConfig())
  check('heartbeat: tool-incomplete classified as stalled', result2.state === 'stalled')
  check('heartbeat: reason is tool-incomplete', result2.reason === 'tool-incomplete')
}

{
  // Write fresh transcript (mtime = now)
  const projCwd = join(stateDir, 'projects', 'newproj')
  const encoded = projCwd.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = join(homedir(), '.claude', 'projects', encoded)
  const transcriptFile = join(transcriptDir, 'test-session.jsonl')
  writeFileSync(transcriptFile, JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Should I?' }] }) + '\n')
  // DO NOT backdate — mtime is now → should be 'active'

  const result3 = classifyChannel('newproj', loadConfig())
  check('heartbeat: fresh transcript classified as idle/active', result3.state === 'idle')
  check('heartbeat: reason is active', result3.reason === 'active')
}

// --- AC5/AC6: specclaw status rendering in show + heartbeat --------------------

// We use the 'newproj' project (chat_id 444444444444444444) which was re-created
// above via mctx(). Its projectDir is stateDir/projects/newproj.

// AC5a: project with .specclaw/STATUS.md having an active 🔨 change + 1 pending proposal
{
  const specclawDir = join(stateDir, 'projects', 'newproj', '.specclaw')
  mkdirSync(specclawDir, { recursive: true })
  const dashboard = [
    '# 🦞 SpecClaw Dashboard',
    '',
    '## Active Changes',
    '',
    '- 🔨 **foo** — 3/8 tasks (38%) | 1 failed',
    '',
    '## Pending Proposals',
    '',
    '- 📋 **bar-proposal** — awaiting planning',
    '',
    '## Completed Changes',
    '',
    '_None_',
  ].join('\n')
  writeFileSync(join(specclawDir, 'STATUS.md'), dashboard, 'utf8')

  const showSpecclaw = await handleMasterCommand('!project show newproj', mctx())
  check(
    'AC5a: show output contains specclaw active change name',
    showSpecclaw.kind === 'reply' && showSpecclaw.text.includes('specclaw: 🔨 foo'),
    showSpecclaw.kind === 'reply' ? showSpecclaw.text : showSpecclaw.kind,
  )
  check(
    'AC5a: show output contains task counts',
    showSpecclaw.kind === 'reply' && showSpecclaw.text.includes('3/8 tasks'),
    showSpecclaw.kind === 'reply' ? showSpecclaw.text : showSpecclaw.kind,
  )
  check(
    'AC5a: show output contains pending proposals count',
    showSpecclaw.kind === 'reply' && showSpecclaw.text.includes('1 proposals pending'),
    showSpecclaw.kind === 'reply' ? showSpecclaw.text : showSpecclaw.kind,
  )
}

// AC5b: project without .specclaw → show output contains no 'specclaw:' line
{
  const showNoSpecclaw = await handleMasterCommand('!project show support', mctx())
  check(
    'AC5b: show with no .specclaw contains no specclaw: line',
    showNoSpecclaw.kind === 'reply' && !showNoSpecclaw.text.includes('specclaw:'),
    showNoSpecclaw.kind === 'reply' ? showNoSpecclaw.text : showNoSpecclaw.kind,
  )
}

// AC6a: heartbeat with fresh transcript (specclaw-idle needs stale transcript) → quiet output
{
  // newproj still has the .specclaw/STATUS.md fixture from AC5a.
  // The transcript written at the classifyChannel tests above has a fresh mtime,
  // so specclaw-idle does NOT fire (reason=active). Heartbeat returns "all quiet".
  const hbSpecclaw = await handleMasterCommand('!project heartbeat', mctx())
  check(
    'AC6a: heartbeat with fresh transcript (no stale items) returns all-quiet line',
    hbSpecclaw.kind === 'reply' && hbSpecclaw.text.startsWith('✅ all quiet —'),
    hbSpecclaw.kind === 'reply' ? hbSpecclaw.text : hbSpecclaw.kind,
  )
  check(
    'AC6a: heartbeat all-quiet contains scanned count',
    hbSpecclaw.kind === 'reply' && hbSpecclaw.text.includes('channel'),
    hbSpecclaw.kind === 'reply' ? hbSpecclaw.text : hbSpecclaw.kind,
  )
}

// AC6b: no active change → heartbeat still returns all-quiet (no items of any kind)
{
  // Remove the .specclaw fixture so no project has an active change
  rmSync(join(stateDir, 'projects', 'newproj', '.specclaw'), { recursive: true, force: true })

  const hbNoSpecclaw = await handleMasterCommand('!project heartbeat', mctx())
  check(
    'AC6b: heartbeat with no active change returns all-quiet line',
    hbNoSpecclaw.kind === 'reply' && hbNoSpecclaw.text.startsWith('✅ all quiet —'),
    hbNoSpecclaw.kind === 'reply' ? hbNoSpecclaw.text : hbNoSpecclaw.kind,
  )
}

// --- AC5/AC6: idle-gated schedules (idle-gated-schedules change) ---

// AC5: schedule add with --only-when-idle --idle-grace 10
{
  const idleAdd = await handleMasterCommand(
    '!project schedule add master-test --at "every 30m" --prompt "idle gated job" --only-when-idle --idle-grace 10',
    mctx(),
  )
  check(
    'idle-gated schedule add: accepted',
    idleAdd.kind === 'reply' && idleAdd.text.includes('every 30m'),
    idleAdd.kind === 'reply' ? idleAdd.text : idleAdd.kind,
  )
  check(
    'idle-gated schedule add: confirmation contains idle-gated',
    idleAdd.kind === 'reply' && idleAdd.text.includes('idle-gated'),
    idleAdd.kind === 'reply' ? idleAdd.text : idleAdd.kind,
  )
  check(
    'idle-gated schedule add: confirmation mentions grace 10m',
    idleAdd.kind === 'reply' && idleAdd.text.includes('10m'),
    idleAdd.kind === 'reply' ? idleAdd.text : idleAdd.kind,
  )
  {
    const scheds = loadSchedules(join(stateDir, 'schedules.json'))
    const entry = scheds.schedules.find(s => s.prompt === 'idle gated job')
    check('idle-gated schedule add: onlyWhenIdle persisted', entry?.onlyWhenIdle === true)
    check('idle-gated schedule add: idleGraceMinutes persisted', entry?.idleGraceMinutes === 10)
  }

  // schedule list output should contain idle-gated for this entry
  const idleList = await handleMasterCommand('!project schedule list master-test', mctx())
  check(
    'idle-gated schedule list: shows idle-gated marker',
    idleList.kind === 'reply' && idleList.text.includes('idle-gated'),
    idleList.kind === 'reply' ? idleList.text : idleList.kind,
  )
}

// AC5: --idle-grace alone (without --only-when-idle) should error
{
  const graceAlone = await handleMasterCommand(
    '!project schedule add master-test --at "every 30m" --prompt "x" --idle-grace 5',
    mctx(),
  )
  check(
    'idle-gated schedule add: --idle-grace alone returns error',
    graceAlone.kind === 'reply' && graceAlone.text.includes('requires') && graceAlone.text.includes('only-when-idle'),
    graceAlone.kind === 'reply' ? graceAlone.text : graceAlone.kind,
  )
  // Nothing extra should have been persisted
  {
    const scheds = loadSchedules(join(stateDir, 'schedules.json'))
    const count = scheds.schedules.filter(s => s.prompt === 'x').length
    check('idle-gated schedule add: --idle-grace alone persists nothing', count === 0)
  }
}

// AC6: lastSkippedAt newer than lastRunAt → shows skipped (busy); lastRunAt newer → does not
{
  const schedFilePath = join(stateDir, 'schedules.json')
  const { schedules: existing } = loadSchedules(schedFilePath)
  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  // Entry A: lastSkippedAt is newer than lastRunAt → should show skipped (busy)
  const entryA = {
    id: 's_ac6_busy',
    chatId: '123456789012345678',
    interval: 'every 30m',
    prompt: 'ac6-busy-test',
    type: 'prompt' as const,
    enabled: true,
    lastRunAt: twoHoursAgo,
    lastSkippedAt: oneHourAgo,
    createdAt: twoHoursAgo,
    maxRuns: null,
    runCount: 1,
    onlyWhenIdle: true,
  }
  // Entry B: lastRunAt is newer than lastSkippedAt → should NOT show skipped (busy)
  const entryB = {
    id: 's_ac6_fired',
    chatId: '123456789012345678',
    interval: 'every 30m',
    prompt: 'ac6-fired-test',
    type: 'prompt' as const,
    enabled: true,
    lastRunAt: oneHourAgo,
    lastSkippedAt: twoHoursAgo,
    createdAt: twoHoursAgo,
    maxRuns: null,
    runCount: 2,
    onlyWhenIdle: true,
  }

  const { saveSchedules: saveSched, loadSchedules: loadSched } = await import('./schedules-config.ts')
  saveSched({ version: 1, schedules: [...existing, entryA, entryB] }, schedFilePath)

  const ac6List = await handleMasterCommand('!project schedule list master-test', mctx())
  check(
    'AC6: lastSkippedAt newer → row contains skipped (busy)',
    ac6List.kind === 'reply' && ac6List.text.includes('skipped (busy)'),
    ac6List.kind === 'reply' ? ac6List.text : ac6List.kind,
  )

  // Verify entryB row does NOT show skipped (busy) — check by searching for entryB's id
  // Since both entries are for the same project, we check the text does NOT have two "skipped (busy)" lines
  // (entryA has it, entryB should not)
  const skippedCount = (ac6List.kind === 'reply' ? ac6List.text : '').split('skipped (busy)').length - 1
  check(
    'AC6: only the busy-skipped entry shows skipped (busy), not the fired entry',
    skippedCount === 1,
    `skipped (busy) count: ${skippedCount}`,
  )
}

// --- AC6: --stop-on-reply flag (schedule-stop-on-reply change) ---

// AC6a: add with --stop-on-reply "backlog complete" → persisted; confirmation mentions stop-on-reply
{
  const stopAdd = await handleMasterCommand(
    '!project schedule add master-test --at "every 30m" --prompt "stop-reply-test" --stop-on-reply "backlog complete"',
    mctx(),
  )
  check(
    'stop-on-reply schedule add: accepted',
    stopAdd.kind === 'reply' && stopAdd.text.includes('every 30m'),
    stopAdd.kind === 'reply' ? stopAdd.text : stopAdd.kind,
  )
  check(
    'stop-on-reply schedule add: confirmation contains stop-on-reply',
    stopAdd.kind === 'reply' && stopAdd.text.includes('stop-on-reply'),
    stopAdd.kind === 'reply' ? stopAdd.text : stopAdd.kind,
  )
  {
    const scheds = loadSchedules(join(stateDir, 'schedules.json'))
    const entry = scheds.schedules.find(s => s.prompt === 'stop-reply-test')
    check('stop-on-reply schedule add: stopOnReply persisted', entry?.stopOnReply === 'backlog complete')
  }
}

// AC6b: schedule list shows stop-on-reply for the entry we just added
{
  const listReply = await handleMasterCommand('!project schedule list master-test', mctx())
  check(
    'stop-on-reply schedule list: shows stop-on-reply marker',
    listReply.kind === 'reply' && listReply.text.includes('stop-on-reply') && listReply.text.includes('backlog complete'),
    listReply.kind === 'reply' ? listReply.text : listReply.kind,
  )
}

// AC6c: invalid regex returns error, nothing persisted
{
  const schedsBefore = loadSchedules(join(stateDir, 'schedules.json'))
  const countBefore = schedsBefore.schedules.filter(s => s.prompt === 'bad-regex-test').length

  const badRegex = await handleMasterCommand(
    '!project schedule add master-test --at "every 30m" --prompt "bad-regex-test" --stop-on-reply "("',
    mctx(),
  )
  check(
    'stop-on-reply schedule add: invalid regex returns error',
    badRegex.kind === 'reply' && badRegex.text.includes('stop-on-reply') && badRegex.text.includes('valid regex'),
    badRegex.kind === 'reply' ? badRegex.text : badRegex.kind,
  )
  {
    const schedsAfter = loadSchedules(join(stateDir, 'schedules.json'))
    const countAfter = schedsAfter.schedules.filter(s => s.prompt === 'bad-regex-test').length
    check('stop-on-reply schedule add: invalid regex persists nothing', countAfter === countBefore)
  }
}

// --- loop-halt-escalation AC3: schedule resume clears escalatedAt; list shows 🛑 ---
{
  const schedFilePath = join(stateDir, 'schedules.json')
  const { saveSchedules: saveSched, loadSchedules: loadSched } = await import('./schedules-config.ts')
  const existing = loadSched(schedFilePath).schedules
  saveSched({
    version: 1,
    schedules: [...existing, {
      id: 's_escalated',
      chatId: existing[0]?.chatId ?? '111111111111111111',
      interval: 'every 30m' as const,
      prompt: 'run loop',
      type: 'prompt' as const,
      enabled: false,
      lastRunAt: null,
      createdAt: new Date().toISOString(),
      maxRuns: null,
      runCount: 3,
      escalatedAt: '2026-07-12T08:00:00.000Z',
    }],
  }, schedFilePath)

  const escList = await handleMasterCommand('!project schedule list master-test', mctx())
  check(
    'halt-escalation: list shows 🛑 escalated marker',
    escList.kind === 'reply' && escList.text.includes('🛑 escalated'),
    escList.kind === 'reply' ? escList.text : escList.kind,
  )

  const resume = await handleMasterCommand('!project schedule resume s_escalated', mctx())
  check(
    'halt-escalation AC3: resume accepted',
    resume.kind === 'reply' && resume.text.includes('resumed'),
    resume.kind === 'reply' ? resume.text : resume.kind,
  )
  const after = loadSched(schedFilePath).schedules.find(s => s.id === 's_escalated')
  check('halt-escalation AC3: resume re-enables', after?.enabled === true)
  check('halt-escalation AC3: resume clears escalatedAt', after?.escalatedAt === null, `got: ${after?.escalatedAt}`)

  const pause = await handleMasterCommand('!project schedule pause s_escalated', mctx())
  check('halt-escalation AC3: pause still works', pause.kind === 'reply' && pause.text.includes('paused'))
  const afterPause = loadSched(schedFilePath).schedules.find(s => s.id === 's_escalated')
  check('halt-escalation AC3: pause leaves escalatedAt cleared', afterPause?.escalatedAt === null)
}

// --- new heartbeat-attention-report AC5 / AC6 tests -------------------------

// AC5: --quiet with no attention items → exactly HEARTBEAT_OK
// AC5 (no-quiet): without --quiet → starts "✅ all quiet —" with scanned count
{
  // All projects have fresh or no transcripts at this point → no attention items
  const quietResult = await handleMasterCommand('!project heartbeat --quiet', mctx())
  check(
    'AC5: heartbeat --quiet with no items returns exactly HEARTBEAT_OK',
    quietResult.kind === 'reply' && quietResult.text === HEARTBEAT_OK,
    quietResult.kind === 'reply' ? JSON.stringify(quietResult.text) : quietResult.kind,
  )

  const noQuietResult = await handleMasterCommand('!project heartbeat', mctx())
  check(
    'AC5: heartbeat without --quiet returns line starting ✅ all quiet —',
    noQuietResult.kind === 'reply' && noQuietResult.text.startsWith('✅ all quiet —'),
    noQuietResult.kind === 'reply' ? noQuietResult.text : noQuietResult.kind,
  )
  check(
    'AC5: heartbeat all-quiet contains channels scanned count',
    noQuietResult.kind === 'reply' && /\d+ channels? scanned/.test(noQuietResult.text),
    noQuietResult.kind === 'reply' ? noQuietResult.text : noQuietResult.kind,
  )
}

// AC6: circuit-open item → 🔴, <#chatId>, slug, ↳ action
{
  const circuitChatId = '999888777666555444' // 'support' project
  const circuitCtx: MasterContext = {
    ...mctx(),
    config: loadConfig(),
    getCircuitStates: () => {
      const m = new Map<string, { circuitOpen: boolean; backoffUntil?: number }>()
      m.set(circuitChatId, { circuitOpen: true })
      return m
    },
  }
  const circuitResult = await handleMasterCommand('!project heartbeat', circuitCtx)
  check(
    'AC6: circuit-open item produces 🔴 in output',
    circuitResult.kind === 'reply' && circuitResult.text.includes('🔴'),
    circuitResult.kind === 'reply' ? circuitResult.text : circuitResult.kind,
  )
  check(
    'AC6: circuit-open item mentions <#chatId>',
    circuitResult.kind === 'reply' && circuitResult.text.includes(`<#${circuitChatId}>`),
    circuitResult.kind === 'reply' ? circuitResult.text : circuitResult.kind,
  )
  check(
    'AC6: circuit-open item mentions slug',
    circuitResult.kind === 'reply' && circuitResult.text.includes('support'),
    circuitResult.kind === 'reply' ? circuitResult.text : circuitResult.kind,
  )
  check(
    'AC6: circuit-open item has ↳ action line',
    circuitResult.kind === 'reply' && circuitResult.text.includes('↳'),
    circuitResult.kind === 'reply' ? circuitResult.text : circuitResult.kind,
  )
}

// AC6 (15-cap): 17 circuit-open projects → output contains "(+2 more)" and only 15 item lines
{
  // Build a config with 17 fake projects, all circuit-open
  const bigProjects: Record<string, { slug: string }> = {}
  const bigCircuitMap = new Map<string, { circuitOpen: boolean }>()
  for (let i = 1; i <= 17; i++) {
    const chatId = `${String(i).padStart(18, '0')}`
    const slug = `proj${i}`
    bigProjects[chatId] = { slug }
    bigCircuitMap.set(chatId, { circuitOpen: true })
    // Create minimal project dir so scanOne doesn't throw
    mkdirSync(join(stateDir, 'projects', slug), { recursive: true })
  }
  const bigConfig = ChannelsConfigSchema.parse({
    master: { chatId: '000000000000000001' },
    projects: bigProjects,
  })
  saveConfig(bigConfig)

  const bigCtx: MasterContext = {
    chatId: '000000000000000001',
    userId: '797184740293476362',
    config: bigConfig,
    authorizedUsers: ['797184740293476362'],
    getCircuitStates: () => bigCircuitMap,
  }
  const bigResult = await handleMasterCommand('!project heartbeat', bigCtx)
  check(
    'AC6 15-cap: output contains (+2 more)',
    bigResult.kind === 'reply' && bigResult.text.includes('(+2 more)'),
    bigResult.kind === 'reply' ? bigResult.text : bigResult.kind,
  )
  // Count 🔴 lines — should be exactly 15
  const redLines = (bigResult.kind === 'reply' ? bigResult.text : '').split('\n').filter(l => l.startsWith('🔴'))
  check(
    'AC6 15-cap: exactly 15 🔴 item lines shown',
    redLines.length === 15,
    `got ${redLines.length}`,
  )

  // Restore the original config for subsequent tests
  saveConfig(config)
}

// help text contains --quiet
{
  const helpResult = await handleMasterCommand('!project help', mctx())
  check(
    'help text contains --quiet for heartbeat',
    helpResult.kind === 'reply' && helpResult.text.includes('--quiet'),
    helpResult.kind === 'reply' ? helpResult.text : helpResult.kind,
  )
}

// --- hermes verb tests -------------------------------------------------------
{
  // Config without hermes → disabled
  const disabledResult = await handleMasterCommand('!project hermes "echo hi"', mctx())
  check(
    'hermes: disabled when config absent',
    disabledResult.kind === 'reply' && disabledResult.text.includes('disabled'),
    disabledResult.kind === 'reply' ? disabledResult.text : disabledResult.kind,
  )

  // Enable hermes config
  const hermesConfig = ChannelsConfigSchema.parse({
    master: { chatId: '123456789012345678' },
    projects: {
      '123456789012345678': { slug: 'master-test' },
    },
    defaults: {
      hermes: {
        enabled: true,
        binPath: '/usr/local/bin/hermes',
        yolo: true,
        extraArgs: [],
      },
    },
  })
  saveConfig(hermesConfig)

  // Mock spawnFn
  const spawnCalls: Array<{ cmd: string; args: string[]; opts: any }> = []
  function mockSpawn(cmd: string, args: string[], opts: any) {
    spawnCalls.push({ cmd, args, opts })
    return {
      pid: 123,
      unref() {},
      on(e: string, cb: (...a: any[]) => void) {},
    }
  }

  function hctx(over: Partial<MasterContext> = {}): MasterContext {
    return {
      chatId: '123456789012345678',
      userId: '797184740293476362',
      config: hermesConfig,
      authorizedUsers: ['797184740293476362'],
      mutator,
      hermesSpawnFn: mockSpawn,
      ...over,
    }
  }

  // Launch reply contains run id and log path
  spawnCalls.length = 0
  const launchResult = await handleMasterCommand('!project hermes "deploy the app"', hctx())
  check(
    'hermes: launch reply contains run id',
    launchResult.kind === 'reply' && /h-[0-9a-z]+-[0-9a-f]{4}/.test(launchResult.text),
    launchResult.kind === 'reply' ? launchResult.text : launchResult.kind,
  )
  check(
    'hermes: launch reply contains log path',
    launchResult.kind === 'reply' && launchResult.text.includes('hermes-runs'),
    launchResult.kind === 'reply' ? launchResult.text : launchResult.kind,
  )
  // Meta file exists
  if (launchResult.kind === 'reply') {
    const runIdMatch = launchResult.text.match(/h-[0-9a-z]+-[0-9a-f]{4}/)
    const runId = runIdMatch?.[0]
    check(
      'hermes: meta json exists in hermes-runs dir',
      runId != null && existsSync(join(stateDir, 'hermes-runs', `${runId}.json`)),
      `runId=${runId}`,
    )
    // Verify meta contains the wrapped prompt
    if (runId) {
      const meta = JSON.parse(readFileSync(join(stateDir, 'hermes-runs', `${runId}.json`), 'utf8'))
      check(
        'hermes: meta wrappedPrompt contains hermes send instruction',
        meta.wrappedPrompt.includes('hermes send'),
      )
    }
  }

  // --no-report: wrapped prompt does NOT contain 'hermes send'
  spawnCalls.length = 0
  const noReportResult = await handleMasterCommand('!project hermes "deploy" --no-report', hctx())
  check(
    'hermes: --no-report launch succeeds',
    noReportResult.kind === 'reply' && /h-[0-9a-z]+-[0-9a-f]{4}/.test(noReportResult.text),
    noReportResult.kind === 'reply' ? noReportResult.text : noReportResult.kind,
  )
  if (noReportResult.kind === 'reply') {
    const runIdMatch = noReportResult.text.match(/h-[0-9a-z]+-[0-9a-f]{4}/)
    const runId = runIdMatch?.[0]
    if (runId) {
      const meta = JSON.parse(readFileSync(join(stateDir, 'hermes-runs', `${runId}.json`), 'utf8'))
      check(
        'hermes: --no-report meta wrappedPrompt does NOT contain hermes send',
        !meta.wrappedPrompt.includes('hermes send'),
        meta.wrappedPrompt,
      )
    }
  }

  // Empty prompt → usage error
  const emptyResult = await handleMasterCommand('!project hermes', hctx())
  check(
    'hermes: empty prompt returns usage error',
    emptyResult.kind === 'reply' && emptyResult.text.includes('Usage:'),
    emptyResult.kind === 'reply' ? emptyResult.text : emptyResult.kind,
  )

  // --tail unknown id → not-found message with recent-runs listing
  const tailUnknown = await handleMasterCommand('!project hermes --tail unknown-run-id', hctx())
  check(
    'hermes: --tail unknown id returns not-found',
    tailUnknown.kind === 'reply' && tailUnknown.text.includes('not found'),
    tailUnknown.kind === 'reply' ? tailUnknown.text : tailUnknown.kind,
  )
  check(
    'hermes: --tail unknown id includes recent runs listing',
    tailUnknown.kind === 'reply' && (tailUnknown.text.includes('Recent runs:') || tailUnknown.text.includes('none')),
    tailUnknown.kind === 'reply' ? tailUnknown.text : tailUnknown.kind,
  )

  // --tail existing id → returns log content
  const fakeRunId = 'h-test00-abcd'
  const hermesRunsDir = join(stateDir, 'hermes-runs')
  mkdirSync(hermesRunsDir, { recursive: true })
  writeFileSync(join(hermesRunsDir, `${fakeRunId}.log`), 'line1\nline2\nline3\n')
  writeFileSync(join(hermesRunsDir, `${fakeRunId}.json`), JSON.stringify({ runId: fakeRunId }))
  const tailResult = await handleMasterCommand(`!project hermes --tail ${fakeRunId}`, hctx())
  check(
    'hermes: --tail existing id returns log content',
    tailResult.kind === 'reply' && tailResult.text.includes('line1') && tailResult.text.includes('line3'),
    tailResult.kind === 'reply' ? tailResult.text : tailResult.kind,
  )

  // Restore original config
  saveConfig(config)
}

// --- AC6: set --bot-peers verb -----------------------------------------------

// Re-use 'support' (chat_id 999888777666555444, slug 'support').
// Master is 123456789012345678.

// Missing --yes when providing ids → refusal
{
  const res = await handleMasterCommand(
    '!project set support --bot-peers 111111111111111111',
    mctx(),
  )
  check(
    'set --bot-peers: missing --yes returns refusal',
    res.kind === 'reply' && res.text.includes('--yes'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --bot-peers: not persisted when --yes missing',
    loadConfig().projects['999888777666555444']?.botPeers === undefined,
  )
}

// Invalid snowflake → usage error
{
  const res = await handleMasterCommand(
    '!project set support --bot-peers not-a-snowflake --yes',
    mctx(),
  )
  check(
    'set --bot-peers: invalid snowflake rejected',
    res.kind === 'reply' && res.text.includes('invalid bot-peer id'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Valid csv with --yes → persists
{
  const res = await handleMasterCommand(
    '!project set support --bot-peers 111111111111111111,222222222222222222 --yes',
    mctx(),
  )
  check(
    'set --bot-peers: valid csv with --yes succeeds',
    res.kind === 'reply' && res.text.includes('botPeers.allow'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const saved = loadConfig().projects['999888777666555444']?.botPeers
  check(
    'set --bot-peers: ids persisted to channels.json',
    Array.isArray(saved?.allow) &&
      saved!.allow.includes('111111111111111111') &&
      saved!.allow.includes('222222222222222222'),
    JSON.stringify(saved),
  )
}

// --bot-peers none (no --yes required) → removes the block
{
  const res = await handleMasterCommand(
    '!project set support --bot-peers none',
    mctx(),
  )
  check(
    'set --bot-peers none: succeeds without --yes',
    res.kind === 'reply' && res.text.includes('cleared'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --bot-peers none: botPeers removed from channels.json',
    loadConfig().projects['999888777666555444']?.botPeers === undefined,
  )
}

// Master channel as target → error
{
  const res = await handleMasterCommand(
    '!project set master-test --bot-peers 111111111111111111 --yes',
    mctx(),
  )
  check(
    'set --bot-peers: master channel target rejected',
    res.kind === 'reply' && res.text.includes('master channel'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nall checks passed`)
