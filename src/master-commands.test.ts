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
import { ChannelsConfigSchema, loadConfig, resolveClaudeArgs, saveConfig, effectivePeerLimits } from './channels-config.ts'
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

// --- AC6 (hermes-project-invoke): set --hermes verb ---------------------------

// Missing --yes when enabling → refusal, config unchanged
{
  const res = await handleMasterCommand(
    '!project set support --hermes on',
    mctx(),
  )
  check(
    'set --hermes on: missing --yes returns refusal',
    res.kind === 'reply' && res.text.includes('--yes'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --hermes on: not persisted when --yes missing',
    loadConfig().projects['999888777666555444']?.hermes === undefined,
  )
}

// Invalid value → usage error
{
  const res = await handleMasterCommand(
    '!project set support --hermes maybe',
    mctx(),
  )
  check(
    'set --hermes: invalid value rejected',
    res.kind === 'reply' && res.text.includes('`--hermes` must be `on` or `off`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// --hermes on --yes → persists hermes.enabled: true
{
  const res = await handleMasterCommand(
    '!project set support --hermes on --yes',
    mctx(),
  )
  check(
    'set --hermes on --yes: succeeds',
    res.kind === 'reply' && res.text.includes('hermes access **enabled**'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --hermes on --yes: hermes.enabled persisted to channels.json',
    loadConfig().projects['999888777666555444']?.hermes?.enabled === true,
    JSON.stringify(loadConfig().projects['999888777666555444']?.hermes),
  )
}

// --hermes off (no --yes required) → removes the block
{
  const res = await handleMasterCommand(
    '!project set support --hermes off',
    mctx(),
  )
  check(
    'set --hermes off: succeeds without --yes',
    res.kind === 'reply' && res.text.includes('hermes access **disabled**'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --hermes off: hermes block removed from channels.json',
    loadConfig().projects['999888777666555444']?.hermes === undefined,
  )
}

// Master channel as target → warn no-op (both on and off)
{
  const resOn = await handleMasterCommand(
    '!project set master-test --hermes on --yes',
    mctx(),
  )
  check(
    'set --hermes on: master target is warn no-op',
    resOn.kind === 'reply' && resOn.text.includes('master already has hermes access — nothing to change'),
    resOn.kind === 'reply' ? resOn.text : resOn.kind,
  )
  const resOff = await handleMasterCommand(
    '!project set master-test --hermes off',
    mctx(),
  )
  check(
    'set --hermes off: master target is warn no-op',
    resOff.kind === 'reply' && resOff.text.includes('master already has hermes access — nothing to change'),
    resOff.kind === 'reply' ? resOff.text : resOff.kind,
  )
  check(
    'set --hermes: master config unchanged',
    loadConfig().projects['123456789012345678']?.hermes === undefined,
  )
}

// --- peers config schema + effectivePeerLimits (FR1) -------------------------

// Round-trip: project with full peers block
{
  const cfg = ChannelsConfigSchema.parse({
    master: { chatId: '123456789012345678' },
    projects: {
      '111111111111111111': {
        slug: 'alpha',
        peers: { allow: ['beta'], maxHops: 3, cooldownSeconds: 20 },
      },
      '222222222222222222': { slug: 'beta' },
    },
    defaults: { peers: { maxHops: 4, cooldownSeconds: 10 } },
  })

  const alpha = cfg.projects['111111111111111111']!
  const beta = cfg.projects['222222222222222222']!

  check(
    'peers schema: allow persisted',
    Array.isArray(alpha.peers?.allow) && alpha.peers!.allow[0] === 'beta',
    JSON.stringify(alpha.peers),
  )
  check('peers schema: maxHops persisted', alpha.peers?.maxHops === 3)
  check('peers schema: cooldownSeconds persisted', alpha.peers?.cooldownSeconds === 20)

  // effectivePeerLimits: project values win
  const limitsAlpha = effectivePeerLimits(cfg, alpha)
  check('effectivePeerLimits: project maxHops wins', limitsAlpha.maxHops === 3)
  check('effectivePeerLimits: project cooldownSeconds wins', limitsAlpha.cooldownSeconds === 20)

  // effectivePeerLimits: falls back to defaults when project has no peers block
  const limitsBeta = effectivePeerLimits(cfg, beta)
  check('effectivePeerLimits: defaults maxHops used when project has no peers', limitsBeta.maxHops === 4)
  check('effectivePeerLimits: defaults cooldownSeconds used when project has no peers', limitsBeta.cooldownSeconds === 10)
}

// effectivePeerLimits: built-in fallback when neither project nor defaults set peers
{
  const bare = ChannelsConfigSchema.parse({
    projects: { '111111111111111111': { slug: 'solo' } },
  })
  const solo = bare.projects['111111111111111111']!
  const limits = effectivePeerLimits(bare, solo)
  check('effectivePeerLimits: built-in maxHops is 6', limits.maxHops === 6)
  check('effectivePeerLimits: built-in cooldownSeconds is 15', limits.cooldownSeconds === 15)
}

// defaults.peers must not accept an allow field (limits-only)
{
  let threw = false
  try {
    ChannelsConfigSchema.parse({
      defaults: { peers: { allow: ['other'], maxHops: 2 } },
    })
  } catch {
    threw = true
  }
  check('peers schema: defaults.peers rejects allow field', threw)
}

// Invalid slug in peers.allow is rejected
{
  let threw = false
  try {
    ChannelsConfigSchema.parse({
      projects: { '111111111111111111': { slug: 'alpha', peers: { allow: ['BAD SLUG!'] } } },
    })
  } catch {
    threw = true
  }
  check('peers schema: invalid slug in allow is rejected', threw)
}

// --- AC9: set --peers verb ---------------------------------------------------
// Use 'support' (999888777666555444) which is always present in the restored config.
// 'master-test' (123456789012345678) is the master project.

// set --peers with valid slug → persists peers.allow
{
  // Temporarily add a second project 'peer-target' to the config
  const cfg = loadConfig()
  const peerChatId = '777777777777777777'
  const cfgWithPeer = { ...cfg, projects: { ...cfg.projects, [peerChatId]: { slug: 'peer-target' } } }
  saveConfig(cfgWithPeer)
  // Also create its directory so save doesn't fail
  mkdirSync(join(stateDir, 'projects', 'peer-target'), { recursive: true })

  const setPeers = await handleMasterCommand(
    '!project set support --peers peer-target',
    mctx(),
  )
  check(
    'AC9: set --peers success reply',
    setPeers.kind === 'reply' && setPeers.text.includes('peers.allow'),
    setPeers.kind === 'reply' ? setPeers.text : setPeers.kind,
  )
  const proj = loadConfig().projects['999888777666555444']
  check('AC9: peers.allow persisted', JSON.stringify(proj?.peers?.allow) === JSON.stringify(['peer-target']))
}

// set --peers preserves existing limits when replacing allow
{
  const cfg = loadConfig()
  const proj = cfg.projects['999888777666555444']!
  saveConfig({ ...cfg, projects: { ...cfg.projects, '999888777666555444': { ...proj, peers: { allow: ['peer-target'], maxHops: 3 } } } })

  const setPeers2 = await handleMasterCommand(
    '!project set support --peers peer-target',
    mctx(),
  )
  check('AC9: --peers replace keeps existing limits', setPeers2.kind === 'reply')
  const proj2 = loadConfig().projects['999888777666555444']
  check('AC9: maxHops preserved after allow replace', proj2?.peers?.maxHops === 3)
  check('AC9: allow still updated', JSON.stringify(proj2?.peers?.allow) === JSON.stringify(['peer-target']))
}

// set --peers none → removes peers block
{
  const clearPeers = await handleMasterCommand(
    '!project set support --peers none',
    mctx(),
  )
  check(
    'AC9: --peers none success reply',
    clearPeers.kind === 'reply' && clearPeers.text.includes('cleared'),
    clearPeers.kind === 'reply' ? clearPeers.text : clearPeers.kind,
  )
  const proj = loadConfig().projects['999888777666555444']
  check('AC9: peers block removed after --peers none', proj?.peers === undefined)
}

// set --peers with unknown slug → rejected
{
  const unknownPeer = await handleMasterCommand(
    '!project set support --peers nonexistent-slug',
    mctx(),
  )
  check(
    'AC9: --peers with unknown slug rejected',
    unknownPeer.kind === 'reply' && unknownPeer.text.includes('not found'),
    unknownPeer.kind === 'reply' ? unknownPeer.text : unknownPeer.kind,
  )
}

// set --peers with self-reference → rejected
{
  const selfPeer = await handleMasterCommand(
    '!project set support --peers support',
    mctx(),
  )
  check(
    'AC9: --peers self-reference rejected',
    selfPeer.kind === 'reply' && selfPeer.text.includes('self'),
    selfPeer.kind === 'reply' ? selfPeer.text : selfPeer.kind,
  )
}

// set --peers with master slug → rejected
{
  const masterPeer = await handleMasterCommand(
    '!project set support --peers master-test',
    mctx(),
  )
  check(
    'AC9: --peers master slug rejected',
    masterPeer.kind === 'reply' && masterPeer.text.includes('master'),
    masterPeer.kind === 'reply' ? masterPeer.text : masterPeer.kind,
  )
}

// Restore original config after AC9 tests
saveConfig(config)

// --- autopilot set tests (AC1, FR2) ----------------------------------------

// Helper: create a fresh project for autopilot tests so we don't pollute 'support'
const apChatId = '888888888888888888'
{
  const cfg = loadConfig()
  const cfgWithAp = { ...cfg, projects: { ...cfg.projects, [apChatId]: { slug: 'ap-test' } } }
  saveConfig(cfgWithAp)
  mkdirSync(join(stateDir, 'projects', 'ap-test'), { recursive: true })
}

// Test 1: --autopilot on round-trip persists enabled + cleared runtime fields
{
  // First set some runtime state manually
  {
    const cfg = loadConfig()
    const proj = cfg.projects[apChatId]!
    saveConfig({
      ...cfg,
      projects: {
        ...cfg.projects,
        [apChatId]: {
          ...proj,
          autopilot: {
            enabled: true,
            state: 'halted',
            seededAt: '2026-01-01T00:00:00Z',
            lastFireAt: '2026-01-02T00:00:00Z',
            zeroDeltaCount: 5,
            lastSnapshot: { done: 2, total: 4 },
          },
        },
      },
    })
  }
  const res = await handleMasterCommand('!project set ap-test --autopilot on', mctx())
  check(
    'autopilot on: success reply',
    res.kind === 'reply' && res.text.includes('enabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const proj = loadConfig().projects[apChatId]!
  check('autopilot on: enabled=true persisted', proj.autopilot?.enabled === true)
  check('autopilot on: runtime state cleared', proj.autopilot?.state === undefined)
  check('autopilot on: seededAt cleared', proj.autopilot?.seededAt === undefined)
  check('autopilot on: lastFireAt cleared', proj.autopilot?.lastFireAt === undefined)
  check('autopilot on: zeroDeltaCount cleared', proj.autopilot?.zeroDeltaCount === undefined)
  check('autopilot on: lastSnapshot cleared', proj.autopilot?.lastSnapshot === undefined)
}

// Test 2: --autopilot on with --seed stores seedGoal
{
  const res = await handleMasterCommand('!project set ap-test --autopilot on --seed "build a REST API"', mctx())
  check(
    'autopilot on + seed: success reply',
    res.kind === 'reply' && res.text.includes('enabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const proj = loadConfig().projects[apChatId]!
  check('autopilot on + seed: seedGoal persisted', proj.autopilot?.seedGoal === 'build a REST API')
  check('autopilot on + seed: enabled=true', proj.autopilot?.enabled === true)
}

// Test 3: --autopilot off clears runtime keeps limits
{
  // Set some limits and runtime state
  {
    const cfg = loadConfig()
    const proj = cfg.projects[apChatId]!
    saveConfig({
      ...cfg,
      projects: {
        ...cfg.projects,
        [apChatId]: {
          ...proj,
          autopilot: {
            enabled: true,
            intervalMinutes: 45,
            stallThreshold: 5,
            state: 'running',
            seededAt: '2026-01-01T00:00:00Z',
            lastFireAt: '2026-01-02T00:00:00Z',
            zeroDeltaCount: 2,
            lastSnapshot: { done: 1, total: 3 },
          },
        },
      },
    })
  }
  const res = await handleMasterCommand('!project set ap-test --autopilot off', mctx())
  check(
    'autopilot off: success reply',
    res.kind === 'reply' && res.text.includes('disabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const proj = loadConfig().projects[apChatId]!
  check('autopilot off: enabled=false', proj.autopilot?.enabled === false)
  // User limits preserved
  check('autopilot off: intervalMinutes preserved', proj.autopilot?.intervalMinutes === 45)
  check('autopilot off: stallThreshold preserved', proj.autopilot?.stallThreshold === 5)
  // Runtime fields cleared
  check('autopilot off: state cleared', proj.autopilot?.state === undefined)
  check('autopilot off: seededAt cleared', proj.autopilot?.seededAt === undefined)
  check('autopilot off: zeroDeltaCount cleared', proj.autopilot?.zeroDeltaCount === undefined)
}

// Test 4: Invalid autopilot value → error
{
  const res = await handleMasterCommand('!project set ap-test --autopilot maybe', mctx())
  check(
    'autopilot invalid value: error reply',
    res.kind === 'reply' && res.text.includes('on') && res.text.includes('off'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 5: Master channel refusal
{
  const res = await handleMasterCommand('!project set master-test --autopilot on', mctx())
  check(
    'autopilot on master channel: refused',
    res.kind === 'reply' && res.text.includes('master channel'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 6: --autopilot-interval without existing block → error
{
  // Make sure ap-test2 has no autopilot block
  const tmpChatId = '666666666666666661'
  {
    const cfg = loadConfig()
    const cfgWith = { ...cfg, projects: { ...cfg.projects, [tmpChatId]: { slug: 'ap-test2' } } }
    saveConfig(cfgWith)
    mkdirSync(join(stateDir, 'projects', 'ap-test2'), { recursive: true })
  }
  const res = await handleMasterCommand('!project set ap-test2 --autopilot-interval 60', mctx())
  check(
    'autopilot-interval without existing block: error',
    res.kind === 'reply' && res.text.includes('requires'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 7: backlog verb renders for file-source project (tmp dir with BACKLOG.md fixture)
{
  // Create a BACKLOG.md with some tasks in ap-test
  writeFileSync(join(stateDir, 'projects', 'ap-test', 'BACKLOG.md'), [
    '- [x] Task one',
    '- [ ] Task two',
    '- [ ] Task three',
  ].join('\n'))

  const res = await handleMasterCommand('!project backlog ap-test', mctx())
  check(
    'backlog verb: success reply',
    res.kind === 'reply',
    res.kind,
  )
  check(
    'backlog verb: shows file source',
    res.kind === 'reply' && res.text.includes('file'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'backlog verb: shows progress',
    res.kind === 'reply' && res.text.includes('1/3'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'backlog verb: shows state',
    res.kind === 'reply' && res.text.includes('state:'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'backlog verb: shows last fire',
    res.kind === 'reply' && res.text.includes('last fire:'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 8: backlog verb for specclaw-source project
{
  const specChatId = '555555555555555551'
  const specSlug = 'specclaw-proj'
  {
    const cfg = loadConfig()
    saveConfig({ ...cfg, projects: { ...cfg.projects, [specChatId]: { slug: specSlug } } })
    const specDir = join(stateDir, 'projects', specSlug)
    mkdirSync(join(specDir, '.specclaw'), { recursive: true })
    writeFileSync(join(specDir, '.specclaw', 'STATUS.md'), '# specclaw status\n')
    // Create a change with a tasks.md
    mkdirSync(join(specDir, '.specclaw', 'changes', 'my-change'), { recursive: true })
    writeFileSync(join(specDir, '.specclaw', 'changes', 'my-change', 'tasks.md'), [
      '- [x] T1',
      '- [ ] T2',
    ].join('\n'))
  }
  const res = await handleMasterCommand(`!project backlog ${specSlug}`, mctx())
  check(
    'backlog verb specclaw: success reply',
    res.kind === 'reply',
    res.kind,
  )
  check(
    'backlog verb specclaw: shows specclaw source',
    res.kind === 'reply' && res.text.includes('specclaw'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'backlog verb specclaw: shows progress',
    res.kind === 'reply' && res.text.includes('1/2'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 9: backlog verb for none-source project
{
  const noneChatId = '444444444444444441'
  const noneSlug = 'no-backlog-proj'
  {
    const cfg = loadConfig()
    saveConfig({ ...cfg, projects: { ...cfg.projects, [noneChatId]: { slug: noneSlug } } })
    mkdirSync(join(stateDir, 'projects', noneSlug), { recursive: true })
  }
  const res = await handleMasterCommand(`!project backlog ${noneSlug}`, mctx())
  check(
    'backlog verb none: success reply',
    res.kind === 'reply',
    res.kind,
  )
  check(
    'backlog verb none: shows none source',
    res.kind === 'reply' && res.text.includes('none'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'backlog verb none: shows 0/0',
    res.kind === 'reply' && res.text.includes('0/0'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 10: backlog verb with unknown slug → error
{
  const res = await handleMasterCommand('!project backlog totally-unknown-slug', mctx())
  check(
    'backlog verb unknown slug: error',
    res.kind === 'reply' && res.text.includes('no project found'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Test 11: Non-allowFrom user refused for set, but backlog verb readable by any allowFrom user
// (The test for allowFrom is at the handleMasterCommand level -- unauthorized users get 'unauthorized' kind)
// The backlog verb has no extra mutation gate; since all our verb calls go through the allowFrom check,
// we verify that a valid user can read backlog (already tested above) and an invalid user is blocked.
{
  const unauthorizedRes = await handleMasterCommand('!project backlog ap-test', {
    ...mctx(),
    userId: '000000000000000000',
    authorizedUsers: ['797184740293476362'],
  })
  check(
    'backlog verb unauthorized user: blocked at auth gate',
    unauthorizedRes.kind === 'unauthorized',
    unauthorizedRes.kind,
  )
  // An authorized user can use backlog (already tested in test 7, but verify the read-only nature):
  // set requires allowFrom gating too, so both use the same gate — backlog is "read-only" in that
  // it does not require --yes or mutation checks beyond the global allowFrom gate.
  const authorizedRes = await handleMasterCommand('!project backlog ap-test', mctx())
  check(
    'backlog verb authorized user: succeeds',
    authorizedRes.kind === 'reply' && !authorizedRes.text.includes('no project found'),
    authorizedRes.kind === 'reply' ? authorizedRes.text : authorizedRes.kind,
  )
}

// --- progress --set phases (P309) ------------------------------------------
{
  const setPhases = await handleMasterCommand('!project progress ap-test --set phases', mctx())
  check(
    'progress --set phases: success reply',
    setPhases.kind === 'reply' && setPhases.text.includes('`phases`'),
    setPhases.kind === 'reply' ? setPhases.text : setPhases.kind,
  )
  check(
    'progress --set phases: persisted to channels.json',
    loadConfig().projects[apChatId]?.progressMode === 'phases',
  )
  const setBogus = await handleMasterCommand('!project progress ap-test --set bogus', mctx())
  check(
    'progress --set bogus: rejected with 4-value error',
    setBogus.kind === 'reply' &&
      setBogus.text.includes('`off`') &&
      setBogus.text.includes('`edit`') &&
      setBogus.text.includes('`post`') &&
      setBogus.text.includes('`phases`'),
    setBogus.kind === 'reply' ? setBogus.text : setBogus.kind,
  )
}

// --- set --disabled on|off tests -------------------------------------------
// Use a dedicated project so we don't pollute 'support' or 'ap-test'.
const disChatId = '111222333444555666'
{
  const cfg = loadConfig()
  saveConfig({ ...cfg, projects: { ...cfg.projects, [disChatId]: { slug: 'dis-test' } } })
  mkdirSync(join(stateDir, 'projects', 'dis-test'), { recursive: true })
}

// invalid value → usage error
{
  const res = await handleMasterCommand('!project set dis-test --disabled maybe', mctx())
  check(
    'set --disabled: invalid value rejected',
    res.kind === 'reply' && res.text.includes('`--disabled` must be `on` or `off`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// master target → warn no-op
{
  const res = await handleMasterCommand('!project set master-test --disabled on', mctx())
  check(
    'set --disabled on: master target is warn no-op',
    res.kind === 'reply' && res.text.includes('master channel cannot be disabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --disabled on: master config unchanged',
    loadConfig().projects['123456789012345678']?.disabled !== true,
  )
}

// --disabled on → persists disabled:true, removes enabledAt, kills warm session
{
  // Pre-stamp an enabledAt so we can verify it gets removed
  {
    const cfg = loadConfig()
    const proj = cfg.projects[disChatId]!
    saveConfig({ ...cfg, projects: { ...cfg.projects, [disChatId]: { ...proj, enabledAt: '2026-01-01T00:00:00.000Z' } } })
  }
  killCalls.length = 0
  const res = await handleMasterCommand('!project set dis-test --disabled on', mctx())
  check(
    'set --disabled on: succeeds',
    res.kind === 'reply' && res.text.includes('disabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const proj = loadConfig().projects[disChatId]!
  check('set --disabled on: disabled:true persisted', proj.disabled === true)
  check('set --disabled on: enabledAt removed', proj.enabledAt === undefined)
  check('set --disabled on: killProject called', killCalls.includes(disChatId))
}

// --disabled off → removes disabled key, stamps enabledAt
{
  killCalls.length = 0
  const res = await handleMasterCommand('!project set dis-test --disabled off', mctx())
  check(
    'set --disabled off: succeeds',
    res.kind === 'reply' && res.text.includes('enabled'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const proj = loadConfig().projects[disChatId]!
  check('set --disabled off: disabled key removed', proj.disabled === undefined)
  check(
    'set --disabled off: enabledAt stamped as ISO date',
    typeof proj.enabledAt === 'string' && !isNaN(Date.parse(proj.enabledAt)),
    JSON.stringify(proj.enabledAt),
  )
}

// list shows ⛔ for disabled project and not for enabled ones
{
  // Re-disable dis-test for the list check
  {
    const cfg = loadConfig()
    const proj = cfg.projects[disChatId]!
    saveConfig({ ...cfg, projects: { ...cfg.projects, [disChatId]: { ...proj, disabled: true } } })
  }
  const listRes = await handleMasterCommand('!project list', mctx())
  check(
    'list: ⛔ shown for disabled project',
    listRes.kind === 'reply' && listRes.text.includes('⛔'),
    listRes.kind === 'reply' ? listRes.text : listRes.kind,
  )
  // 'support' is not disabled — its row should not have ⛔
  // We check that at least one row (dis-test) has ⛔ while the support row does not contain it
  const text = listRes.kind === 'reply' ? listRes.text : ''
  const disLine = text.split('\n').find(l => l.includes('dis-test')) ?? ''
  const supportLine = text.split('\n').find(l => l.includes('support') && !l.includes('master')) ?? ''
  check('list: dis-test row contains ⛔', disLine.includes('⛔'))
  check('list: support row does not contain ⛔', !supportLine.includes('⛔'))
}

// show contains 'disabled: yes' for disabled, absent otherwise
{
  const showDis = await handleMasterCommand('!project show dis-test', mctx())
  check(
    'show: disabled:yes present for disabled project',
    showDis.kind === 'reply' && showDis.text.includes('disabled: yes'),
    showDis.kind === 'reply' ? showDis.text : showDis.kind,
  )
  const showOk = await handleMasterCommand('!project show support', mctx())
  check(
    'show: disabled line absent for enabled project',
    showOk.kind === 'reply' && !showOk.text.includes('disabled: yes'),
    showOk.kind === 'reply' ? showOk.text : showOk.kind,
  )
}

// --- AC6 (collab-handoff-protocol): set --collab-role ------------------------
// Dedicated project with a bot-peer allowlist so both target kinds resolve.
const collabChatId = '777888999000111222'
{
  const cfg = loadConfig()
  saveConfig({
    ...cfg,
    projects: {
      ...cfg.projects,
      [collabChatId]: { slug: 'collab-test', botPeers: { allow: ['111111111111111111'] } },
    },
  })
  mkdirSync(join(stateDir, 'projects', 'collab-test'), { recursive: true })
}

// Unresolvable value → refused with the value named, nothing persisted
{
  const res = await handleMasterCommand('!project set collab-test --collab-role reviewer=nosuchslug', mctx())
  check(
    'set --collab-role: unresolvable value refused, error names it',
    res.kind === 'reply' && res.text.includes('nosuchslug') && res.text.includes('cannot resolve'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --collab-role: refused value not persisted',
    loadConfig().projects[collabChatId]?.collab === undefined,
  )
}

// Malformed (no `=`) → usage error
{
  const res = await handleMasterCommand('!project set collab-test --collab-role reviewer', mctx())
  check(
    'set --collab-role: missing = rejected with usage',
    res.kind === 'reply' && res.text.includes('`--collab-role` must be `<name>=<slug|botId>`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Self-reference → refused via resolver
{
  const res = await handleMasterCommand('!project set collab-test --collab-role self=collab-test', mctx())
  check(
    'set --collab-role: self target refused',
    res.kind === 'reply' && res.text.includes('source project itself'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Master as target project → warn, unchanged
{
  const res = await handleMasterCommand('!project set master-test --collab-role reviewer=support', mctx())
  check(
    'set --collab-role: master target refused',
    res.kind === 'reply' && res.text.includes('master channel cannot have collab roles'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --collab-role: master config unchanged',
    loadConfig().projects['123456789012345678']?.collab === undefined,
  )
}

// Valid slug value → persists (no --yes needed)
{
  const res = await handleMasterCommand('!project set collab-test --collab-role reviewer=support', mctx())
  check(
    'set --collab-role reviewer=<slug>: succeeds without --yes',
    res.kind === 'reply' && res.text.includes('set collab role `reviewer` → `support`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --collab-role reviewer=<slug>: persisted to channels.json',
    loadConfig().projects[collabChatId]?.collab?.roles?.reviewer === 'support',
    JSON.stringify(loadConfig().projects[collabChatId]?.collab),
  )
}

// Bot-peer id value (in botPeers.allow) → persists; existing role kept
{
  const res = await handleMasterCommand('!project set collab-test --collab-role notifier=111111111111111111', mctx())
  check(
    'set --collab-role notifier=<botId>: succeeds',
    res.kind === 'reply' && res.text.includes('set collab role `notifier`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const roles = loadConfig().projects[collabChatId]?.collab?.roles
  check('set --collab-role: botPeer role persisted', roles?.notifier === '111111111111111111')
  check('set --collab-role: existing reviewer role preserved', roles?.reviewer === 'support')
}

// name=none removes the role, keeps the block while other roles remain
{
  const res = await handleMasterCommand('!project set collab-test --collab-role reviewer=none', mctx())
  check(
    'set --collab-role reviewer=none: removal reply',
    res.kind === 'reply' && res.text.includes('removed collab role `reviewer`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const roles = loadConfig().projects[collabChatId]?.collab?.roles
  check('set --collab-role none: reviewer gone', roles?.reviewer === undefined)
  check('set --collab-role none: other role survives', roles?.notifier === '111111111111111111')
}

// Removing a role that is not set → friendly no-op
{
  const res = await handleMasterCommand('!project set collab-test --collab-role phantom=none', mctx())
  check(
    'set --collab-role phantom=none: friendly no-op',
    res.kind === 'reply' && res.text.includes('is not set'),
    res.kind === 'reply' ? res.text : res.kind,
  )
}

// Removing the last role with no timeoutMinutes drops the collab block
{
  const res = await handleMasterCommand('!project set collab-test --collab-role notifier=none', mctx())
  check(
    'set --collab-role: last role removal succeeds',
    res.kind === 'reply' && res.text.includes('removed collab role `notifier`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  check(
    'set --collab-role: empty collab block dropped',
    loadConfig().projects[collabChatId]?.collab === undefined,
    JSON.stringify(loadConfig().projects[collabChatId]?.collab),
  )
}

// Removing the last role KEEPS the block when timeoutMinutes is set
{
  {
    const cfg = loadConfig()
    const proj = cfg.projects[collabChatId]!
    saveConfig({
      ...cfg,
      projects: { ...cfg.projects, [collabChatId]: { ...proj, collab: { roles: { reviewer: 'support' }, timeoutMinutes: 45 } } },
    })
  }
  const res = await handleMasterCommand('!project set collab-test --collab-role reviewer=none', mctx())
  check(
    'set --collab-role: removal with timeoutMinutes succeeds',
    res.kind === 'reply' && res.text.includes('removed collab role `reviewer`'),
    res.kind === 'reply' ? res.text : res.kind,
  )
  const collab = loadConfig().projects[collabChatId]?.collab
  check(
    'set --collab-role: collab block kept when timeoutMinutes present',
    collab !== undefined && collab.timeoutMinutes === 45 && (collab.roles === undefined || Object.keys(collab.roles).length === 0),
    JSON.stringify(collab),
  )
}

// --- AC7 (collab-handoff-protocol): collab verb -------------------------------
// Seed roles directly: one valid, one stale (points at a deleted project).
{
  const cfg = loadConfig()
  const proj = cfg.projects[collabChatId]!
  saveConfig({
    ...cfg,
    projects: {
      ...cfg.projects,
      [collabChatId]: { ...proj, collab: { roles: { reviewer: 'support', ghost: 'deleted-proj' } } },
    },
  })
}

// Injected registry: two matching pending records, one done, one unrelated.
const longTask = 'x'.repeat(100)
const collabRegistry = [
  {
    id: 'h-aaa-1111',
    from: 'collab-test',
    to: { kind: 'project' as const, slug: 'support', chatId: '999888777666555444' },
    task: 'review PR #12',
    state: 'pending' as const,
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  },
  {
    id: 'h-bbb-2222',
    from: 'support',
    to: { kind: 'botPeer' as const, botId: '111111111111111111', chatId: collabChatId },
    task: longTask,
    state: 'pending' as const,
    createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  },
  {
    id: 'h-ccc-3333',
    from: 'collab-test',
    to: { kind: 'project' as const, slug: 'support', chatId: '999888777666555444' },
    task: 'already closed',
    state: 'done' as const,
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  },
  {
    id: 'h-ddd-4444',
    from: 'newproj',
    to: { kind: 'project' as const, slug: 'ap-test', chatId: '666777888999000111' },
    task: 'unrelated handoff',
    state: 'pending' as const,
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
]

{
  const res = await handleMasterCommand(
    '!project collab collab-test',
    mctx({ loadHandoffRegistry: () => collabRegistry }),
  )
  const text = res.kind === 'reply' ? res.text : ''
  check('collab verb: replies (handoff flag off — read-only)', res.kind === 'reply', res.kind)
  check('collab verb: header names the project', text.includes('Collab — collab-test'), text)
  const reviewerLine = text.split('\n').find(l => l.includes('reviewer')) ?? ''
  check('collab verb: valid role listed without stale mark', reviewerLine.includes('support') && !reviewerLine.includes('(stale)'), reviewerLine)
  const ghostLine = text.split('\n').find(l => l.includes('ghost')) ?? ''
  check('collab verb: unresolvable role marked (stale)', ghostLine.includes('deleted-proj') && ghostLine.includes('(stale)'), ghostLine)
  check(
    'collab verb: outbound pending handoff listed with direction + age',
    text.includes('#h-aaa-1111 collab-test→support 10m: review PR #12'),
    text,
  )
  const inboundLine = text.split('\n').find(l => l.includes('#h-bbb-2222')) ?? ''
  check(
    'collab verb: inbound pending handoff (to.chatId match) listed with botId',
    inboundLine.includes('support→111111111111111111') && inboundLine.includes('3m:'),
    inboundLine,
  )
  check(
    'collab verb: long task truncated to ≤80 chars',
    inboundLine.includes('x'.repeat(79) + '…') && !inboundLine.includes('x'.repeat(80)),
    String(inboundLine.length),
  )
  check('collab verb: done record excluded', !text.includes('h-ccc-3333'), text)
  check('collab verb: unrelated pending record excluded', !text.includes('h-ddd-4444'), text)
}

// Empty state: no roles, no handoffs (default registry loader reads an absent file)
{
  const res = await handleMasterCommand('!project collab dis-test', mctx())
  const text = res.kind === 'reply' ? res.text : ''
  check('collab verb: empty roles friendly line', text.includes('no collab roles configured'), text)
  check('collab verb: empty handoffs friendly line', text.includes('no open handoffs'), text)
}

// Arg validation + help
{
  const noArg = await handleMasterCommand('!project collab', mctx())
  check(
    'collab verb: needs a target',
    noArg.kind === 'reply' && noArg.text.includes('chat_id or slug'),
    noArg.kind === 'reply' ? noArg.text : noArg.kind,
  )
  const missing = await handleMasterCommand('!project collab ghost-slug', mctx())
  check(
    'collab verb: unknown target yields not-found',
    missing.kind === 'reply' && missing.text.includes('no project found'),
    missing.kind === 'reply' ? missing.text : missing.kind,
  )
  const helpRes = await handleMasterCommand('!project help', mctx())
  check(
    'help: mentions collab verb and --collab-role flag',
    helpRes.kind === 'reply' && helpRes.text.includes('collab <chat_id-or-slug>') && helpRes.text.includes('--collab-role'),
    helpRes.kind === 'reply' ? '' : helpRes.kind,
  )
}

// Restore config after autopilot tests
saveConfig(config)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log(`\nall checks passed`)
