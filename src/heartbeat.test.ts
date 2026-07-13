/**
 * bun src/heartbeat.test.ts
 * Fixture-based tests for heartbeat.ts detector logic (scanOne + buildAttentionReport).
 *
 * Uses plain bun <file> harness — no bun:test.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'

// ─── harness ────────────────────────────────────────────────────────────────
let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ─── helpers ─────────────────────────────────────────────────────────────────
/** Replicate the encode logic from heartbeat.ts */
function encodeForTranscript(absPath: string): string {
  let real = absPath
  try { real = realpathSync(absPath) } catch {}
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * Create a transcript dir under ~/.claude/projects/<encoded> for the given
 * slug, write a single fixture .jsonl file, and optionally backdate its mtime.
 * Returns the transcript dir path for cleanup.
 */
function makeTranscriptDir(tmpDir: string, slug: string): string {
  const projectPath = join(tmpDir, 'projects', slug)
  mkdirSync(projectPath, { recursive: true })
  const encoded = encodeForTranscript(projectPath)
  const transcriptDir = join(homedir(), '.claude', 'projects', encoded)
  mkdirSync(transcriptDir, { recursive: true })
  return transcriptDir
}

function writeTranscript(transcriptDir: string, lines: string[], backdateMins?: number): string {
  const file = join(transcriptDir, 'session.jsonl')
  writeFileSync(file, lines.join('\n') + '\n')
  if (backdateMins !== undefined) {
    const past = new Date(Date.now() - backdateMins * 60_000)
    utimesSync(file, past, past)
  }
  return file
}

// Transcript line helpers
function assistantQuestion(text: string): string {
  return JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text }] } })
}
function assistantText(text: string): string {
  return JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text }] } })
}
function userScheduler(chatId: string, text: string): string {
  const content = `<channel source="discord" chat_id="${chatId}" message_id="sched-abc-1" user="scheduler" user_id="__mcd_scheduler__" ts="2026-07-12T10:00:00Z">${text}</channel>`
  return JSON.stringify({ message: { role: 'user', content } })
}
function userOperator(chatId: string, text: string): string {
  const content = `<channel source="discord" chat_id="${chatId}" message_id="7971234567890" user="operator" user_id="797000000000001" ts="2026-07-12T10:00:00Z">${text}</channel>`
  return JSON.stringify({ message: { role: 'user', content } })
}
function assistantToolUse(): string {
  return JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }] } })
}

// ─── test setup ──────────────────────────────────────────────────────────────
// Use unique pid-stamped slugs so we never collide with real projects
const PID = process.pid
const SLUG_A = `hb-test-${PID}-a`
const SLUG_B = `hb-test-${PID}-b`
const SLUG_C = `hb-test-${PID}-c`
const SLUG_D = `hb-test-${PID}-d`
const SLUG_E = `hb-test-${PID}-e`
const SLUG_F = `hb-test-${PID}-f`
const SLUG_G = `hb-test-${PID}-g`

const CHAT_A = '111100000000000001'
const CHAT_B = '111100000000000002'
const CHAT_C = '111100000000000003'
const CHAT_D = '111100000000000004'
const CHAT_E = '111100000000000005'
const CHAT_F = '111100000000000006'
const CHAT_G = '111100000000000007'

// Set MCD_CHANNELS_DIR before importing heartbeat.ts so paths resolve correctly
const tmpDir = mkdtempSync('/tmp/hb-test-')
process.env.MCD_CHANNELS_DIR = tmpDir

// Track all transcript dirs for cleanup
const transcriptDirs: string[] = []

// Dynamic import AFTER setting env
const { scanOne, buildAttentionReport } = await import('./heartbeat.ts')
const { ChannelsConfigSchema } = await import('./channels-config.ts')

function makeConfig(projects: Record<string, string>): ReturnType<typeof ChannelsConfigSchema.parse> {
  return ChannelsConfigSchema.parse({
    master: { chatId: '999900000000000001' },
    defaults: { idleEvictMinutes: 15, maxConcurrent: 8 },
    projects: Object.fromEntries(
      Object.entries(projects).map(([chatId, slug]) => [chatId, { slug }])
    ),
  })
}

// ─── AC1: question-unanswered — full >80-char question in detail ─────────────
{
  const longQuestion = 'Have you considered all the edge cases around async ordering and whether the retry logic will correctly handle a partially-committed state?'
  check('AC1: question length fixture', longQuestion.length > 80, `len=${longQuestion.length}`)

  const transcriptDir = makeTranscriptDir(tmpDir, SLUG_A)
  transcriptDirs.push(transcriptDir)
  writeTranscript(transcriptDir, [assistantQuestion(longQuestion)], 90)

  const config = makeConfig({ [CHAT_A]: SLUG_A })
  const { state } = scanOne(SLUG_A, config)

  check('AC1: scanOne state=stalled', state.state === 'stalled', `got ${state.state}`)
  check('AC1: scanOne reason=question-unanswered', state.reason === 'question-unanswered', `got ${state.reason}`)
  check('AC1: detail contains full question', state.detail.length > 80, `detail len=${state.detail.length}`)
  check('AC1: detail is the question text', state.detail.includes('edge cases'), `detail=${state.detail.slice(0, 60)}`)
  check('AC1: snippet ≤ 80 chars', state.snippet.length <= 80, `snippet len=${state.snippet.length}`)
  check('AC1: detail ≤ 300 chars', state.detail.length <= 300, `detail len=${state.detail.length}`)

  const items = buildAttentionReport(config, {})
  const item = items.find(i => i.slug === SLUG_A)
  check('AC1: buildAttentionReport has item', item !== undefined)
  check('AC1: severity=blocked', item?.severity === 'blocked', `got ${item?.severity}`)
  check('AC1: kind=question-unanswered', item?.kind === 'question-unanswered', `got ${item?.kind}`)
  check('AC1: detail present', typeof item?.detail === 'string' && item.detail.length > 0, `detail=${item?.detail}`)
  check('AC1: detail length > 80', (item?.detail?.length ?? 0) > 80, `detail len=${item?.detail?.length}`)
  check('AC1: action mentions chatId', item?.action?.includes(`<#${CHAT_A}>`) ?? false, `action=${item?.action}`)
}

// ─── AC2: schedule-noop-loop ──────────────────────────────────────────────────
{
  // AC2a: 5 trailing scheduler entries → item
  const transcriptDir = makeTranscriptDir(tmpDir, SLUG_B)
  transcriptDirs.push(transcriptDir)
  const lines = [
    userOperator(CHAT_B, 'run the backlog'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_B, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_B, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_B, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_B, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_B, '/specclaw:loop'),
    assistantText('backlog complete.'),
  ]
  writeTranscript(transcriptDir, lines, 90)

  const config = makeConfig({ [CHAT_B]: SLUG_B })
  const schedules5 = [{ id: 's_x', chatId: CHAT_B, enabled: true, runCount: 42 }]
  const items5 = buildAttentionReport(config, { loadSchedules: () => ({ schedules: schedules5 }) })
  const item5 = items5.find(i => i.kind === 'schedule-noop-loop' && i.slug === SLUG_B)
  check('AC2a: 5 trailing scheduler → item present', item5 !== undefined)
  check('AC2a: severity=review', item5?.severity === 'review', `got ${item5?.severity}`)
  check('AC2a: summary contains schedule id', item5?.summary?.includes('s_x') ?? false, `summary=${item5?.summary}`)

  // AC2b: only 4 trailing scheduler entries → no item
  const transcriptDir4 = makeTranscriptDir(tmpDir, SLUG_C)
  transcriptDirs.push(transcriptDir4)
  const lines4 = [
    userOperator(CHAT_C, 'run the backlog'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_C, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_C, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_C, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_C, '/specclaw:loop'),
    assistantText('backlog complete.'),
  ]
  writeTranscript(transcriptDir4, lines4, 90)
  const config4 = makeConfig({ [CHAT_C]: SLUG_C })
  const schedules4 = [{ id: 's_x', chatId: CHAT_C, enabled: true, runCount: 10 }]
  const items4 = buildAttentionReport(config4, { loadSchedules: () => ({ schedules: schedules4 }) })
  const item4 = items4.find(i => i.kind === 'schedule-noop-loop' && i.slug === SLUG_C)
  check('AC2b: 4 trailing scheduler → no item', item4 === undefined)

  // AC2c: schedule disabled → no item
  const schedulesDisabled = [{ id: 's_x', chatId: CHAT_B, enabled: false, runCount: 42 }]
  const itemsDisabled = buildAttentionReport(config, { loadSchedules: () => ({ schedules: schedulesDisabled }) })
  const itemDisabled = itemsDisabled.find(i => i.kind === 'schedule-noop-loop' && i.slug === SLUG_B)
  check('AC2c: disabled schedule → no item', itemDisabled === undefined)

  // AC2d: operator message AFTER scheduler entries → trailing count reset, no item
  const transcriptDirReset = makeTranscriptDir(tmpDir, SLUG_D)
  transcriptDirs.push(transcriptDirReset)
  const linesReset = [
    userScheduler(CHAT_D, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_D, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_D, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_D, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userScheduler(CHAT_D, '/specclaw:loop'),
    assistantText('backlog complete.'),
    userOperator(CHAT_D, 'hey, what is going on'),
    assistantText('everything is fine.'),
  ]
  writeTranscript(transcriptDirReset, linesReset, 90)
  const configReset = makeConfig({ [CHAT_D]: SLUG_D })
  const schedulesReset = [{ id: 's_x', chatId: CHAT_D, enabled: true, runCount: 42 }]
  const itemsReset = buildAttentionReport(configReset, { loadSchedules: () => ({ schedules: schedulesReset }) })
  const itemReset = itemsReset.find(i => i.kind === 'schedule-noop-loop' && i.slug === SLUG_D)
  check('AC2d: operator message after scheduler → trailing reset, no item', itemReset === undefined)
}

// ─── AC3: circuit-open ───────────────────────────────────────────────────────
{
  // AC3a: circuitOpen=true → blocked item
  const transcriptDir = makeTranscriptDir(tmpDir, SLUG_E)
  transcriptDirs.push(transcriptDir)
  writeTranscript(transcriptDir, [assistantText('hello world')], 90)

  const config = makeConfig({ [CHAT_E]: SLUG_E })
  const circuitMap = new Map([[CHAT_E, { circuitOpen: true }]])
  const items = buildAttentionReport(config, { getCircuitStates: () => circuitMap })
  const item = items.find(i => i.kind === 'circuit-open' && i.slug === SLUG_E)
  check('AC3a: circuit-open item present', item !== undefined)
  check('AC3a: severity=blocked', item?.severity === 'blocked', `got ${item?.severity}`)

  // AC3b: absent dep (empty deps object) → no item, no throw
  let threw = false
  let itemsNoDep: typeof items = []
  try {
    itemsNoDep = buildAttentionReport(config, {})
  } catch {
    threw = true
  }
  check('AC3b: absent getCircuitStates → no throw', !threw)
  const itemNoDep = itemsNoDep.find(i => i.kind === 'circuit-open' && i.slug === SLUG_E)
  check('AC3b: absent getCircuitStates → no circuit item', itemNoDep === undefined)
}

// ─── AC4: specclaw-idle ───────────────────────────────────────────────────────
{
  // AC4a: stale transcript + active specclaw change → info item
  const transcriptDir = makeTranscriptDir(tmpDir, SLUG_F)
  transcriptDirs.push(transcriptDir)
  writeTranscript(transcriptDir, [assistantText('working on feature')], 90)

  const config = makeConfig({ [CHAT_F]: SLUG_F })
  const ssActive = { present: true, activeChange: 'x-change', phase: 'build', tasksDone: 1, tasksTotal: 4 }
  const items = buildAttentionReport(config, { readSpecclawStatus: () => ssActive })
  const item = items.find(i => i.kind === 'specclaw-idle' && i.slug === SLUG_F)
  check('AC4a: specclaw-idle item present', item !== undefined)
  check('AC4a: severity=info', item?.severity === 'info', `got ${item?.severity}`)
  check('AC4a: summary contains change name', item?.summary?.includes('x-change') ?? false, `summary=${item?.summary}`)
  check('AC4a: summary contains phase', item?.summary?.includes('build') ?? false, `summary=${item?.summary}`)

  // AC4b: fresh transcript → no item
  const transcriptDirFresh = makeTranscriptDir(tmpDir, SLUG_G)
  transcriptDirs.push(transcriptDirFresh)
  // fresh = mtime is recent (5 min ago — not within 30s active window but also not "fresh" enough to skip specclaw)
  // Actually we want reason='active' (within 30s), so write with mtime = now
  writeTranscript(transcriptDirFresh, [assistantText('working on feature')])
  // mtime = now → reason=active → specclaw-idle skipped
  const configFresh = makeConfig({ [CHAT_G]: SLUG_G })
  const itemsFresh = buildAttentionReport(configFresh, { readSpecclawStatus: () => ssActive })
  const itemFresh = itemsFresh.find(i => i.kind === 'specclaw-idle' && i.slug === SLUG_G)
  check('AC4b: fresh transcript (active) → no specclaw-idle item', itemFresh === undefined)
}

// ─── Sort order + multi-item channel ─────────────────────────────────────────
{
  // Three channels: circuit-open (blocked), noop-loop (review), specclaw-idle (info)
  // Configured in reverse alphabetical order so we can verify sort is by severity not config order

  // Note: SLUG_E already has circuit data; we'll reuse existing transcript dirs
  // but build a fresh config with all three. We need to create new slugs
  // with unique names to avoid cross-test interference.

  const SORT_A_SLUG = `hb-sort-${PID}-a`  // will get circuit-open (blocked)
  const SORT_B_SLUG = `hb-sort-${PID}-b`  // will get noop-loop (review)
  const SORT_C_SLUG = `hb-sort-${PID}-c`  // will get specclaw-idle (info)
  const SORT_A_CHAT = '222200000000000001'
  const SORT_B_CHAT = '222200000000000002'
  const SORT_C_CHAT = '222200000000000003'

  const tdA = makeTranscriptDir(tmpDir, SORT_A_SLUG)
  transcriptDirs.push(tdA)
  writeTranscript(tdA, [assistantText('hello world')], 90)

  const tdB = makeTranscriptDir(tmpDir, SORT_B_SLUG)
  transcriptDirs.push(tdB)
  const noopLines = [
    userOperator(SORT_B_CHAT, 'run'),
    assistantText('done.'),
    userScheduler(SORT_B_CHAT, '/specclaw:loop'),
    assistantText('done.'),
    userScheduler(SORT_B_CHAT, '/specclaw:loop'),
    assistantText('done.'),
    userScheduler(SORT_B_CHAT, '/specclaw:loop'),
    assistantText('done.'),
    userScheduler(SORT_B_CHAT, '/specclaw:loop'),
    assistantText('done.'),
    userScheduler(SORT_B_CHAT, '/specclaw:loop'),
    assistantText('done.'),
  ]
  writeTranscript(tdB, noopLines, 90)

  const tdC = makeTranscriptDir(tmpDir, SORT_C_SLUG)
  transcriptDirs.push(tdC)
  writeTranscript(tdC, [assistantText('working')], 90)

  // Config in reverse alphabetical slug order: c, b, a
  const sortConfig = ChannelsConfigSchema.parse({
    master: { chatId: '999900000000000002' },
    defaults: { idleEvictMinutes: 15, maxConcurrent: 8 },
    projects: {
      [SORT_C_CHAT]: { slug: SORT_C_SLUG },
      [SORT_B_CHAT]: { slug: SORT_B_SLUG },
      [SORT_A_CHAT]: { slug: SORT_A_SLUG },
    },
  })

  const circuitMapSort = new Map([[SORT_A_CHAT, { circuitOpen: true }]])
  const schedulesSort = [{ id: 's_sort', chatId: SORT_B_CHAT, enabled: true, runCount: 5 }]
  const ssSort = { present: true, activeChange: 'y-change', phase: 'build', tasksDone: 2, tasksTotal: 5 }

  const sortItems = buildAttentionReport(sortConfig, {
    getCircuitStates: () => circuitMapSort,
    loadSchedules: () => ({ schedules: schedulesSort }),
    readSpecclawStatus: () => ssSort,
  })

  const sortSlugs = sortItems.map(i => i.slug)
  const sortSeverities = sortItems.map(i => i.severity)

  check('Sort: blocked comes first', sortSeverities[0] === 'blocked', `first=${sortSeverities[0]}`)
  const reviewIdx = sortSeverities.indexOf('review')
  const infoIdx = sortSeverities.indexOf('info')
  check('Sort: review before info', reviewIdx !== -1 && infoIdx !== -1 && reviewIdx < infoIdx,
    `review=${reviewIdx} info=${infoIdx}`)
  check('Sort: no blocked after review', !sortSeverities.slice(reviewIdx).includes('blocked'),
    `severities=${sortSeverities}`)
}

// ─── Multi-item single channel: circuit-open + question-unanswered ────────────
{
  const MULTI_SLUG = `hb-multi-${PID}`
  const MULTI_CHAT = '333300000000000001'

  const tdMulti = makeTranscriptDir(tmpDir, MULTI_SLUG)
  transcriptDirs.push(tdMulti)
  const longQ = 'Should we refactor the scheduler to use a priority queue instead of the current sorted array approach for correctness?'
  check('Multi: question length fixture', longQ.length > 80, `len=${longQ.length}`)
  writeTranscript(tdMulti, [assistantQuestion(longQ)], 90)

  const multiConfig = makeConfig({ [MULTI_CHAT]: MULTI_SLUG })
  const circuitMapMulti = new Map([[MULTI_CHAT, { circuitOpen: true }]])
  const multiItems = buildAttentionReport(multiConfig, { getCircuitStates: () => circuitMapMulti })

  const hasCircuit = multiItems.some(i => i.kind === 'circuit-open' && i.slug === MULTI_SLUG)
  const hasQuestion = multiItems.some(i => i.kind === 'question-unanswered' && i.slug === MULTI_SLUG)
  check('Multi: circuit-open item present', hasCircuit)
  check('Multi: question-unanswered item present', hasQuestion)
  check('Multi: both items present for same channel', hasCircuit && hasQuestion)
}

// ─── No-transcript channel → zero items, no throw ────────────────────────────
{
  const NOTRANSCRIPT_SLUG = `hb-notx-${PID}`
  const NOTRANSCRIPT_CHAT = '444400000000000001'

  // Create project dir but NO transcript dir
  mkdirSync(join(tmpDir, 'projects', NOTRANSCRIPT_SLUG), { recursive: true })

  const config = makeConfig({ [NOTRANSCRIPT_CHAT]: NOTRANSCRIPT_SLUG })
  let threw = false
  let items: ReturnType<typeof buildAttentionReport> = []
  try {
    items = buildAttentionReport(config, {})
  } catch {
    threw = true
  }
  check('No-transcript: no throw', !threw)
  const item = items.find(i => i.slug === NOTRANSCRIPT_SLUG)
  check('No-transcript: zero items', item === undefined)
}

// ─── cleanup ─────────────────────────────────────────────────────────────────
for (const dir of transcriptDirs) {
  try { rmSync(dir, { recursive: true, force: true }) } catch {}
}
try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}

// ─── result ──────────────────────────────────────────────────────────────────
const total = (() => {
  // Count all check() calls: just count lines with 'PASS' or 'FAIL' from console
  return 0 // placeholder; failed counter is what matters
})()
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`)
  process.exit(1)
} else {
  console.log('\nAll checks PASSED')
}
