/**
 * bun src/integration.test.ts
 *
 * Integration tests that exercise multiple subsystems together:
 *   - Budget enforcement (P40): queueing, thresholds, month-rollover drain
 *   - Pool + MCP server round-trip: reply tool call routed end-to-end
 *   - Fleet-compute: budgetStatus computed from real transcript files
 *
 * Uses real temp directories for filesystem-backed tests.
 * MockProjectProcess for pool tests — no Claude/tmux spawn.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { setTimeout as sleep } from 'node:timers/promises'

import { ChannelsConfigSchema } from './channels-config.ts'
import { MockProjectProcess, type InboundEnvelope, type OutboundReply } from './project-process.ts'
import { ProjectPool, type PoolEvent } from './project-pool.ts'
import { MasterMcpServer } from './master-mcp-server.ts'
import { computeFleet } from '../apps/mission-control/src/fleet-compute.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ─── helpers ────────────────────────────────────────────────────────────────

function envelope(content: string, id = content): InboundEnvelope {
  return { messageId: id, userId: 'u1', username: 'tester', content, ts: new Date().toISOString() }
}

function makeConfig(opts: {
  idleEvictMinutes?: number
  maxConcurrent?: number
  projects?: Record<string, { slug: string; monthlyTokenBudget?: number }>
} = {}) {
  const projects = opts.projects ?? { '111111111111111111': { slug: 'alpha' } }
  return ChannelsConfigSchema.parse({
    master: { chatId: '999999999999999999' },
    defaults: { idleEvictMinutes: opts.idleEvictMinutes ?? 15, maxConcurrent: opts.maxConcurrent ?? 8 },
    projects,
  })
}

function makePool(
  config: ReturnType<typeof makeConfig>,
  opts: { events?: PoolEvent[]; replies?: OutboundReply[]; now?: () => number } = {}
) {
  const events = opts.events ?? []
  const replies = opts.replies ?? []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: opts.now })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: (r) => replies.push(r),
    onEvent: (e) => events.push(e),
    now: opts.now,
  })
  return { pool, events, replies, created }
}

// Write a minimal .jsonl transcript entry that looks like a Claude assistant turn.
function writeTranscriptEntry(
  dir: string,
  file: string,
  yearMonth: string,
  inputTokens: number,
  outputTokens: number
) {
  const ts = `${yearMonth}-15T10:00:00.000Z`
  const entry = JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: { usage: { input_tokens: inputTokens, output_tokens: outputTokens } },
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, file), entry + '\n')
}

// ─── 1. Budget: no budget → messages flow normally ──────────────────────────
{
  const config = makeConfig()
  const { pool, events, created } = makePool(config)

  await pool.deliver('111111111111111111', envelope('hello', 'msg-nb-1'))
  await sleep(10)

  check('1: no budget — message delivered', created.length === 1)
  check('1: no budget-exhausted event', !events.some((e) => e.kind === 'budget-exhausted'))
  await pool.shutdown()
}

// ─── 2. Budget: well under limit → messages flow ────────────────────────────
{
  const config = makeConfig({
    projects: { '111111111111111111': { slug: 'alpha', monthlyTokenBudget: 1_000_000 } },
  })
  const { pool, events, created } = makePool(config)

  // MCD_CHANNELS_DIR not set → computeMonthlyTokensUsed returns 0 → well under budget
  await pool.deliver('111111111111111111', envelope('hi', 'msg-ok-1'))
  await sleep(10)

  check('2: under budget — message delivered', created.length === 1)
  check('2: no budget-exhausted event', !events.some((e) => e.kind === 'budget-exhausted'))
  await pool.shutdown()
}

// ─── 3. Budget: exhausted → message queued, not delivered ───────────────────
{
  // Write a transcript with 2M tokens (> 1M budget) in current month
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-test-'))
  const mcdDir = path.join(tmpDir, 'mcd')
  const projectDir = path.join(mcdDir, 'projects', 'beta')
  fs.mkdirSync(projectDir, { recursive: true })

  const encodedPath = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encodedPath)

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  writeTranscriptEntry(transcriptDir, 'session.jsonl', ym, 1_000_000, 1_000_001) // >1M budget

  process.env.MCD_CHANNELS_DIR = mcdDir

  const config = makeConfig({
    projects: { '222222222222222222': { slug: 'beta', monthlyTokenBudget: 1_000_000 } },
  })
  const { pool, events, created } = makePool(config)

  await pool.deliver('222222222222222222', envelope('blocked', 'msg-ex-1'))
  await sleep(10)

  check('3: exhausted — no process spawned', created.length === 0)
  check('3: budget-exhausted event fired', events.some((e) => e.kind === 'budget-exhausted'))
  const ex = events.find((e) => e.kind === 'budget-exhausted') as Extract<PoolEvent, { kind: 'budget-exhausted' }> | undefined
  check('3: queuedCount is 1', ex?.queuedCount === 1)

  // Queue a second message
  await pool.deliver('222222222222222222', envelope('blocked2', 'msg-ex-2'))
  await sleep(10)
  const ex2 = events.filter((e) => e.kind === 'budget-exhausted')
  check('3: queue grows to 2', (ex2.at(-1) as Extract<PoolEvent, { kind: 'budget-exhausted' }> | undefined)?.queuedCount === 2)
  check('3: getBudgetQueuedCount returns 2', pool.getBudgetQueuedCount('222222222222222222') === 2)

  await pool.shutdown()
  process.env.MCD_CHANNELS_DIR = undefined as unknown as string
  fs.rmSync(tmpDir, { recursive: true, force: true })
  try { fs.rmSync(transcriptDir, { recursive: true, force: true }) } catch {}
}

// ─── 4. Budget: threshold alerts (50/80/100) fire once each ─────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-test-'))
  const mcdDir = path.join(tmpDir, 'mcd')
  const projectDir = path.join(mcdDir, 'projects', 'gamma')
  fs.mkdirSync(projectDir, { recursive: true })

  const encodedPath = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encodedPath)

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  // 85% of 1M = 850k tokens → crosses 50% and 80% thresholds
  writeTranscriptEntry(transcriptDir, 'session.jsonl', ym, 500_000, 350_000)

  process.env.MCD_CHANNELS_DIR = mcdDir

  const config = makeConfig({
    projects: { '333333333333333333': { slug: 'gamma', monthlyTokenBudget: 1_000_000 } },
  })
  const { pool, events } = makePool(config)

  await pool.deliver('333333333333333333', envelope('hello', 'msg-th-1'))
  await sleep(10)

  const alertEvents = events.filter((e) => e.kind === 'budget-alert') as Extract<PoolEvent, { kind: 'budget-alert' }>[]
  const thresholds = alertEvents.map((e) => e.threshold)
  check('4: 50% threshold alert fired', thresholds.includes(50))
  check('4: 80% threshold alert fired', thresholds.includes(80))
  check('4: 100% threshold NOT fired (only 85%)', !thresholds.includes(100))

  // Deliver again — same thresholds must NOT re-fire (once per month)
  const countBefore = alertEvents.length
  await pool.deliver('333333333333333333', envelope('hello2', 'msg-th-2'))
  await sleep(10)
  const alertEventsAfter = events.filter((e) => e.kind === 'budget-alert')
  check('4: no duplicate threshold alerts', alertEventsAfter.length === countBefore)

  await pool.shutdown()
  process.env.MCD_CHANNELS_DIR = undefined as unknown as string
  fs.rmSync(tmpDir, { recursive: true, force: true })
  try { fs.rmSync(transcriptDir, { recursive: true, force: true }) } catch {}
}

// ─── 5. Budget: drainBudgetQueues delivers queued messages ──────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-test-'))
  const mcdDir = path.join(tmpDir, 'mcd')
  const projectDir = path.join(mcdDir, 'projects', 'delta')
  fs.mkdirSync(projectDir, { recursive: true })

  const encodedPath = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encodedPath)

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  // Exactly at budget limit (100%)
  writeTranscriptEntry(transcriptDir, 'session.jsonl', ym, 500_000, 500_000)

  process.env.MCD_CHANNELS_DIR = mcdDir

  const config = makeConfig({
    projects: { '444444444444444444': { slug: 'delta', monthlyTokenBudget: 1_000_000 } },
  })
  const { pool, events, created } = makePool(config)

  // Queue two messages
  await pool.deliver('444444444444444444', envelope('q1', 'msg-drain-1'))
  await pool.deliver('444444444444444444', envelope('q2', 'msg-drain-2'))
  await sleep(10)

  check('5: both messages queued', pool.getBudgetQueuedCount('444444444444444444') === 2)
  check('5: no process spawned yet', created.length === 0)

  // Erase transcript so next delivery sees 0 usage
  fs.writeFileSync(path.join(transcriptDir, 'session.jsonl'), '')

  // Manually drain (simulates month rollover)
  await pool.drainBudgetQueues()
  await sleep(10)

  check('5: budget-restored event fired', events.some((e) => e.kind === 'budget-restored'))
  const restored = events.find((e) => e.kind === 'budget-restored') as Extract<PoolEvent, { kind: 'budget-restored' }> | undefined
  check('5: drained count is 2', restored?.drained === 2)
  check('5: queue empty after drain', pool.getBudgetQueuedCount('444444444444444444') === 0)
  check('5: process spawned during drain', created.length > 0)

  await pool.shutdown()
  process.env.MCD_CHANNELS_DIR = undefined as unknown as string
  fs.rmSync(tmpDir, { recursive: true, force: true })
  try { fs.rmSync(transcriptDir, { recursive: true, force: true }) } catch {}
}

// ─── 6. Fleet-compute: budgetStatus computed correctly ──────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-fc-'))
  const mcdDir = path.join(tmpDir, 'mcd')

  // Write channels.json
  const channelsJson = {
    version: 1,
    master: { chatId: '999999999999999999' },
    defaults: {},
    projects: {
      '111111111111111111': { slug: 'p-ok', monthlyTokenBudget: 1_000_000 },
      '222222222222222222': { slug: 'p-warn', monthlyTokenBudget: 1_000_000 },
      '333333333333333333': { slug: 'p-crit', monthlyTokenBudget: 1_000_000 },
      '444444444444444444': { slug: 'p-exh', monthlyTokenBudget: 1_000_000 },
      '555555555555555555': { slug: 'p-nolimit' },
    },
  }
  fs.mkdirSync(mcdDir, { recursive: true })
  fs.writeFileSync(path.join(mcdDir, 'channels.json'), JSON.stringify(channelsJson))

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  // Write transcripts for each project
  for (const [slug, input, output] of [
    ['p-ok', 100_000, 100_000],      // 200k / 1M = 20% → ok
    ['p-warn', 300_000, 250_000],    // 550k / 1M = 55% → warning
    ['p-crit', 450_000, 400_000],    // 850k / 1M = 85% → critical
    ['p-exh', 600_000, 500_000],     // 1.1M / 1M = 110% → exhausted
  ] as const) {
    const projectDir = path.join(mcdDir, 'projects', slug)
    fs.mkdirSync(projectDir, { recursive: true })
    const encodedPath = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encodedPath)
    writeTranscriptEntry(transcriptDir, 'sess.jsonl', ym, input, output)
  }
  // p-nolimit has no transcript — no budget
  const nolimitDir = path.join(mcdDir, 'projects', 'p-nolimit')
  fs.mkdirSync(nolimitDir, { recursive: true })

  const fleet = computeFleet(mcdDir)
  const bySlug = Object.fromEntries(fleet.projects.map((p) => [p.slug, p]))

  check('6: p-ok budgetStatus is ok', bySlug['p-ok']?.budgetStatus === 'ok')
  check('6: p-warn budgetStatus is warning', bySlug['p-warn']?.budgetStatus === 'warning')
  check('6: p-crit budgetStatus is critical', bySlug['p-crit']?.budgetStatus === 'critical')
  check('6: p-exh budgetStatus is exhausted', bySlug['p-exh']?.budgetStatus === 'exhausted')
  check('6: p-nolimit has no budgetStatus', bySlug['p-nolimit']?.budgetStatus === undefined)

  // Cleanup transcript dirs
  fs.rmSync(tmpDir, { recursive: true, force: true })
  for (const slug of ['p-ok', 'p-warn', 'p-crit', 'p-exh']) {
    const projectDir = path.join(mcdDir, 'projects', slug)
    const encoded = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
    try { fs.rmSync(path.join(os.homedir(), '.claude', 'projects', encoded), { recursive: true, force: true }) } catch {}
  }
}

// ─── 7. Pool + MCP server: reply round-trip ─────────────────────────────────
{
  const replies: OutboundReply[] = []
  const server = new MasterMcpServer({
    onReply: (r) => replies.push(r),
    log: () => {},
  })
  const { host, port } = await server.start()
  check('7: MCP server started', port > 0)

  const chatId = '111111111111111111'
  const config = makeConfig({ projects: { [chatId]: { slug: 'alpha' } } })
  const poolReplies: OutboundReply[] = []
  const pool = new ProjectPool({
    factory: ({ chatId: cid, project }) => new MockProjectProcess({ chatId: cid, slug: project.slug }),
    getConfig: () => config,
    onReply: (r) => poolReplies.push(r),
    onEvent: () => {},
  })

  // Deliver a message to spawn the process
  await pool.deliver(chatId, envelope('ping', 'msg-mcp-1'))
  await sleep(10)

  // Call mcp__mcd__reply via HTTP against the MCP server
  const mcpUrl = server.urlFor(chatId)
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'reply', arguments: { text: 'hello from test' } },
  })
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body,
  })
  check('7: MCP reply HTTP 200', res.status === 200)

  // MCP SDK returns SSE (text/event-stream) even for stateless mode.
  // Parse the first `data:` line to extract the JSON-RPC response.
  const raw = await res.text()
  const dataLine = raw.split('\n').find((l) => l.startsWith('data:'))
  let resultText = ''
  if (dataLine) {
    try {
      const json = JSON.parse(dataLine.slice('data:'.length).trim()) as { result?: { content?: Array<{ text?: string }> } }
      resultText = json.result?.content?.[0]?.text ?? ''
    } catch {}
  }
  check('7: MCP reply returns ok', resultText === 'ok')

  check('7: reply captured in server sink', replies.some((r) => r.chatId === chatId))
  const captured = replies.find((r) => r.chatId === chatId) as (OutboundReply & { kind: 'text' }) | undefined
  check('7: reply text matches', captured?.text === 'hello from test')

  await server.stop()
  await pool.shutdown()
}

// ─── 8. Channels-config: monthlyTokenBudget parsed from schema ──────────────
{
  const cfg = ChannelsConfigSchema.parse({
    version: 1,
    master: { chatId: '999999999999999999' },
    defaults: {},
    projects: {
      '111111111111111111': { slug: 'budgeted', monthlyTokenBudget: 500_000 },
      '222222222222222222': { slug: 'unlimited' },
    },
  })
  check('8: monthlyTokenBudget parsed', cfg.projects['111111111111111111']?.monthlyTokenBudget === 500_000)
  check('8: unlimited project has no budget', cfg.projects['222222222222222222']?.monthlyTokenBudget == null)
}

// ─── 9. Fleet-compute: only current month tokens counted ────────────────────
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcd-month-'))
  const mcdDir = path.join(tmpDir, 'mcd')

  const channelsJson = {
    version: 1,
    master: { chatId: '999999999999999999' },
    defaults: {},
    projects: { '111111111111111111': { slug: 'seasonal', monthlyTokenBudget: 1_000_000 } },
  }
  fs.mkdirSync(mcdDir, { recursive: true })
  fs.writeFileSync(path.join(mcdDir, 'channels.json'), JSON.stringify(channelsJson))

  const projectDir = path.join(mcdDir, 'projects', 'seasonal')
  fs.mkdirSync(projectDir, { recursive: true })
  const encoded = projectDir.replace(/[^a-zA-Z0-9]/g, '-')
  const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
  fs.mkdirSync(transcriptDir, { recursive: true })

  const now = new Date()
  const thisYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth()
  const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
  const prevYM = `${prevYear}-${String(prevMonth).padStart(2, '0')}`

  // Write 900k tokens in previous month and 100k in current month
  writeTranscriptEntry(transcriptDir, 'old.jsonl', prevYM, 500_000, 400_000) // 900k — previous month
  writeTranscriptEntry(transcriptDir, 'cur.jsonl', thisYM, 60_000, 40_000)   // 100k — current month

  const fleet = computeFleet(mcdDir)
  const project = fleet.projects.find((p) => p.slug === 'seasonal')

  check('9: only current-month tokens counted', (project?.monthlyTokensUsed ?? 0) < 200_000)
  check('9: budgetStatus ok (only 10% used)', project?.budgetStatus === 'ok')

  fs.rmSync(tmpDir, { recursive: true, force: true })
  try { fs.rmSync(transcriptDir, { recursive: true, force: true }) } catch {}
}

// ─── 10. Pool: projects without budget unaffected by budget checks ──────────
{
  const config = makeConfig({
    projects: {
      '111111111111111111': { slug: 'free' },
    },
  })
  const { pool, events, created } = makePool(config)

  // Deliver 5 messages — all should reach the process
  for (let i = 0; i < 5; i++) {
    await pool.deliver('111111111111111111', envelope(`msg-${i}`, `msg-free-${i}`))
  }
  await sleep(10)

  check('10: no-budget project — process spawned', created.length === 1)
  check('10: no budget events fired', !events.some((e) => e.kind === 'budget-alert' || e.kind === 'budget-exhausted'))

  await pool.shutdown()
}

// ─── finish ─────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
