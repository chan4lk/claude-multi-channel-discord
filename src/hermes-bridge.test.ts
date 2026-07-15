/**
 * bun src/hermes-bridge.test.ts
 * Tests for src/hermes-bridge.ts — run with: bun src/hermes-bridge.test.ts
 * Exits 0 on pass, 1 on failures.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Set MCD_CHANNELS_DIR before any paths-dependent imports so hermesRunsDir() resolves correctly
const stateDir = mkdtempSync(join(tmpdir(), 'hermes-test-'))
process.env.MCD_CHANNELS_DIR = stateDir

import { HermesConfigSchema } from './channels-config.ts'
import {
  newRunId,
  wrapHermesPrompt,
  buildHermesArgv,
  launchHermesRun,
  tailHermesRun,
  listRecentRuns,
} from './hermes-bridge.ts'
import { hermesRunsDir } from './paths.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// --- newRunId ---------------------------------------------------------------
{
  const id = newRunId()
  check('newRunId: starts with h-', id.startsWith('h-'))
  check('newRunId: three segments separated by -', id.split('-').length === 3)
  const id2 = newRunId()
  // They may collide if timestamp is same and rand same, but extremely unlikely
  // Just check format
  check('newRunId: second call also valid format', /^h-[a-z0-9]+-[0-9a-f]{4}$/.test(id2))
}

// --- wrapHermesPrompt -------------------------------------------------------
{
  const runId = 'h-test-abcd'
  const masterChatId = '123456789012345678'
  const rawPrompt = 'deploy the app'

  const wrapped = wrapHermesPrompt(rawPrompt, runId, masterChatId)
  check('wrapHermesPrompt: contains run id prefix', wrapped.includes(`MCD bridge run ${runId}`))
  check('wrapHermesPrompt: contains raw prompt verbatim', wrapped.includes(rawPrompt))
  check(
    'wrapHermesPrompt: contains hermes send instruction with discord:<masterChatId>',
    wrapped.includes(`hermes send --to discord:${masterChatId}`) && wrapped.includes(`[hermes:${runId}]`),
  )
  check(
    'wrapHermesPrompt: contains wait 5 seconds instruction',
    wrapped.includes('wait 5 seconds'),
  )

  const noReport = wrapHermesPrompt(rawPrompt, runId, masterChatId, { report: false })
  check('wrapHermesPrompt report:false: contains raw prompt', noReport.includes(rawPrompt))
  check(
    'wrapHermesPrompt report:false: no hermes send mention',
    !noReport.includes('hermes send'),
    `got: ${noReport}`,
  )
}

// --- buildHermesArgv --------------------------------------------------------
{
  // AC4: argv order: ['-z', wrapped, '--yolo', '-m', model, ...extraArgs]
  const cfg = HermesConfigSchema.parse({
    enabled: true,
    binPath: '/usr/local/bin/hermes',
    yolo: true,
    extraArgs: ['--verbose', '--timeout=60'],
  })
  const wrapped = 'deploy app'
  const argv = buildHermesArgv(cfg, wrapped, { model: 'MiniMax-M3' })

  check('buildHermesArgv: first element is -z', argv[0] === '-z')
  check('buildHermesArgv: second element is wrapped prompt', argv[1] === wrapped)
  check('buildHermesArgv: --yolo before -m', argv[2] === '--yolo')
  check('buildHermesArgv: -m flag present', argv[3] === '-m')
  check('buildHermesArgv: model value', argv[4] === 'MiniMax-M3')
  check('buildHermesArgv: extraArgs appended', argv[5] === '--verbose' && argv[6] === '--timeout=60')
  check('buildHermesArgv: total length', argv.length === 7)

  // Without model
  const noModel = buildHermesArgv(cfg, wrapped)
  check('buildHermesArgv no model: no -m flag', !noModel.includes('-m'))
  check('buildHermesArgv no model: extraArgs still present', noModel.includes('--verbose'))

  // yolo: false
  const noYolo = buildHermesArgv(HermesConfigSchema.parse({ enabled: true, yolo: false }), wrapped)
  check('buildHermesArgv yolo:false: no --yolo', !noYolo.includes('--yolo'))
}

// --- hostile prompt safety --------------------------------------------------
{
  const hostile = 'quote" $(rm -rf /)\nbacktick`echo pwned`\nnewline\t and tab'
  const cfg = HermesConfigSchema.parse({ enabled: true, binPath: '/bin/hermes' })
  const argv = buildHermesArgv(cfg, hostile)
  // The prompt is the second element (index 1) — it must arrive verbatim, no shell expansion
  check('hostile prompt: lands verbatim as single argv element', argv[1] === hostile)
  // cfg has yolo:true (default), so argv = ['-z', prompt, '--yolo']
  check('hostile prompt: argv length is 3 (yolo default, no extraArgs, no model)', argv.length === 3)
}

// --- launchHermesRun: disabled cfg ------------------------------------------
{
  const disabledCfg = HermesConfigSchema.parse({ enabled: false })
  let threw = false
  let errMsg = ''
  try {
    launchHermesRun({ prompt: 'test', cfg: disabledCfg, masterChatId: '123' })
  } catch (err) {
    threw = true
    errMsg = (err as Error).message
  }
  check('disabled cfg: throws', threw)
  check('disabled cfg: error contains "disabled"', errMsg.includes('disabled'), errMsg)
}

// --- launchHermesRun: empty prompt ------------------------------------------
{
  const cfg = HermesConfigSchema.parse({ enabled: true })
  let threw = false
  try {
    launchHermesRun({ prompt: '   ', cfg, masterChatId: '123' })
  } catch {
    threw = true
  }
  check('empty prompt: throws', threw)

  let threw2 = false
  try {
    launchHermesRun({ prompt: '', cfg, masterChatId: '123' })
  } catch {
    threw2 = true
  }
  check('blank prompt: throws', threw2)
}

// --- launchHermesRun: mock spawn + meta file + spawn options ----------------
{
  const runsDir = hermesRunsDir()
  const masterChatId = '987654321098765432'
  const cfg = HermesConfigSchema.parse({
    enabled: true,
    binPath: '/usr/local/bin/hermes',
    yolo: true,
    extraArgs: ['--extra'],
  })

  type SpawnCall = {
    binPath: string
    argv: string[]
    options: { detached: boolean; stdio: unknown[] }
  }
  let spawnCall: SpawnCall | undefined
  let unreffed = false

  const mockChild = {
    pid: 42,
    on: (_: string, __: unknown) => {},
    unref: () => { unreffed = true },
  }

  function mockSpawn(binPath: string, argv: string[], options: unknown): typeof mockChild {
    spawnCall = { binPath, argv, options: options as SpawnCall['options'] }
    return mockChild
  }

  const result = launchHermesRun({
    prompt: 'restart MCD',
    cfg,
    masterChatId,
    model: 'mini-3',
    spawnFn: mockSpawn as unknown as typeof import('node:child_process').spawn,
  })

  check('launchHermesRun: returns runId', typeof result.runId === 'string' && result.runId.startsWith('h-'))
  check('launchHermesRun: returns logPath under hermes-runs', result.logPath.startsWith(runsDir))

  check('launchHermesRun: spawn called', spawnCall !== undefined)
  // Use non-null assertion; we already verified spawnCall is set
  const sc = spawnCall!
  check(
    'launchHermesRun: spawn binPath matches cfg',
    sc.binPath === cfg.binPath,
    sc.binPath,
  )
  check(
    'launchHermesRun: argv[0] is -z',
    sc.argv[0] === '-z',
    JSON.stringify(sc.argv),
  )
  check(
    'launchHermesRun: argv includes --yolo',
    sc.argv.includes('--yolo'),
    JSON.stringify(sc.argv),
  )
  check(
    'launchHermesRun: argv includes -m model',
    sc.argv.includes('-m') && sc.argv.includes('mini-3'),
    JSON.stringify(sc.argv),
  )
  check(
    'launchHermesRun: argv includes --extra',
    sc.argv.includes('--extra'),
    JSON.stringify(sc.argv),
  )
  check(
    'launchHermesRun: detached: true',
    sc.options.detached === true,
    JSON.stringify(sc.options),
  )
  check(
    'launchHermesRun: stdio[0] is ignore',
    sc.options.stdio[0] === 'ignore',
    JSON.stringify(sc.options.stdio),
  )
  check(
    'launchHermesRun: stdio[1] is a number (fd)',
    typeof sc.options.stdio[1] === 'number',
    JSON.stringify(sc.options.stdio),
  )
  check(
    'launchHermesRun: stdio[2] is a number (fd)',
    typeof sc.options.stdio[2] === 'number',
    JSON.stringify(sc.options.stdio),
  )
  check(
    'launchHermesRun: stdio[1] === stdio[2] (same fd)',
    sc.options.stdio[1] === sc.options.stdio[2],
    JSON.stringify(sc.options.stdio),
  )
  check('launchHermesRun: unref called', unreffed)

  // meta json
  const metaPath = join(runsDir, `${result.runId}.json`)
  check('launchHermesRun: meta json exists', existsSync(metaPath))
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  check('launchHermesRun: meta.runId matches', meta.runId === result.runId)
  check('launchHermesRun: meta.rawPrompt matches', meta.rawPrompt === 'restart MCD')
  check('launchHermesRun: meta.masterChatId matches', meta.masterChatId === masterChatId)
  check('launchHermesRun: meta.pid is 42', meta.pid === 42)
  check('launchHermesRun: meta.startedAt is ISO string', typeof meta.startedAt === 'string' && meta.startedAt.includes('T'))
  check('launchHermesRun: meta.wrappedPrompt contains raw', meta.wrappedPrompt.includes('restart MCD'))
  check('launchHermesRun: meta.argv is array', Array.isArray(meta.argv))
  check('launchHermesRun: meta.argv[0] is -z', meta.argv[0] === '-z')
}

// --- launchHermesRun: spawn throws → error contains binPath ----------------
{
  const cfg = HermesConfigSchema.parse({ enabled: true, binPath: '/no/such/hermes' })
  function throwingSpawn(_bin: string, _argv: string[], _opts: unknown): never {
    throw new Error('ENOENT')
  }

  let threw = false
  let errMsg = ''
  try {
    launchHermesRun({
      prompt: 'test spawn error',
      cfg,
      masterChatId: '123',
      spawnFn: throwingSpawn as unknown as typeof import('node:child_process').spawn,
    })
  } catch (err) {
    threw = true
    errMsg = (err as Error).message
  }
  check('spawn error: throws', threw)
  check('spawn error: message contains binPath', errMsg.includes('/no/such/hermes'), errMsg)
}

// --- tailHermesRun ----------------------------------------------------------
{
  // Unknown run id → null
  const unknown = tailHermesRun('h-nonexistent-0000')
  check('tailHermesRun unknown: returns null', unknown === null)

  // Write a fake log and tail it
  const runsDir = hermesRunsDir()
  mkdirSync(runsDir, { recursive: true })
  const fakeId = 'h-fake-cafe'
  const fakeLog = join(runsDir, `${fakeId}.log`)
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`)
  writeFileSync(fakeLog, lines.join('\n') + '\n')

  const tail = tailHermesRun(fakeId)
  check('tailHermesRun: returns string', typeof tail === 'string')
  // Default 40 lines → should contain lines 11-50
  const tailLines = tail!.split('\n')
  check('tailHermesRun: default returns 40 lines', tailLines.length === 40, `got ${tailLines.length}`)
  check('tailHermesRun: last line is "line 50"', tailLines.at(-1) === 'line 50')
  check('tailHermesRun: first line is "line 11"', tailLines[0] === 'line 11')

  const tail5 = tailHermesRun(fakeId, 5)
  check('tailHermesRun: custom lines count', tail5!.split('\n').length === 5)
}

// --- listRecentRuns ---------------------------------------------------------
{
  // Empty/missing dir → empty array
  const missing = listRecentRuns()
  // At this point runsDir exists from above tests, so it won't be truly missing,
  // but we can still test listing with the runs we created

  // Write 3 meta files with controlled mtimes
  const runsDir = hermesRunsDir()
  mkdirSync(runsDir, { recursive: true })

  const ids = ['h-oldest-0001', 'h-middle-0002', 'h-newest-0003']
  const now = Date.now()
  for (let i = 0; i < ids.length; i++) {
    const metaPath = join(runsDir, `${ids[i]}.json`)
    writeFileSync(metaPath, JSON.stringify({ runId: ids[i] }))
    // Set mtimes: oldest first
    const mtime = new Date(now - (ids.length - i) * 10000)
    const { utimesSync } = await import('node:fs')
    utimesSync(metaPath, mtime, mtime)
  }

  // Fetch all so we can find our test ids regardless of other runs from earlier tests
  const recent = listRecentRuns(50)
  check('listRecentRuns: returns array', Array.isArray(recent))
  check('listRecentRuns: returns 3 entries', recent.length >= 3, `got ${recent.length}`)
  // Newest should be first — our controlled ids must appear in the right relative order
  const newestIdx = recent.indexOf('h-newest-0003')
  const oldestIdx = recent.indexOf('h-oldest-0001')
  check('listRecentRuns: our ids are present', newestIdx !== -1 && oldestIdx !== -1, `newest=${newestIdx} oldest=${oldestIdx}`)
  check('listRecentRuns: newest first', newestIdx < oldestIdx, `newest=${newestIdx} oldest=${oldestIdx}`)

  // n param
  const top1 = listRecentRuns(1)
  check('listRecentRuns: n=1 returns at most 1', top1.length === 1)
}

// --- done -------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
