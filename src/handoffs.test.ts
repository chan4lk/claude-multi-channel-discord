/**
 * bun src/handoffs.test.ts
 * Unit tests for the handoff registry (src/handoffs.ts).
 * Covers: create→complete, duplicate complete idempotence, nag-once /
 * escalate-once / expire lifecycle, sweep idempotence across runs, prune,
 * corrupt file → empty, write-then-reload survival. (AC5 core, AC8)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Use a temp dir per run so tests are fully isolated
const tmpDirs: string[] = []
function freshChannelsDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mcd-handoffs-${label}-`))
  tmpDirs.push(dir)
  process.env.MCD_CHANNELS_DIR = dir
  return dir
}
freshChannelsDir('boot')

// Import AFTER setting env so handoffsPath() picks up the temp dir
import {
  advanceChainStep,
  completeChain,
  completeHandoff,
  createChain,
  createHandoff,
  expireChain,
  findChain,
  haltChain,
  loadRegistry,
  loadRegistryFile,
  matchPendingIds,
  nextChainAction,
  saveRegistryFile,
  validateChainSteps,
  type ChainRecord,
  saveRegistry,
  sweepHandoffs,
  type HandoffRecord,
} from './handoffs.ts'
import { handoffsPath } from './paths.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

const MIN = 60_000
const T0  = Date.UTC(2026, 6, 26, 12, 0, 0)  // fixed base clock

// ---------------------------------------------------------------------------
// create → complete
// ---------------------------------------------------------------------------
{
  freshChannelsDir('create')

  check('empty registry → empty list', loadRegistry().length === 0)

  const rec = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 'review PR 42' },
    T0,
  )
  check('id format h-<base36ts>-<hex4>', /^h-[a-z0-9]+-[0-9a-f]{4}$/.test(rec.id), rec.id)
  check('id embeds base36 clock', rec.id.split('-')[1] === T0.toString(36))
  check('new record is pending', rec.state === 'pending')
  check('createdAt is ISO of nowMs', rec.createdAt === new Date(T0).toISOString())

  const persisted = loadRegistry()
  check('create persists one record', persisted.length === 1)
  check('persisted record matches', persisted[0].id === rec.id && persisted[0].task === 'review PR 42')

  const done = completeHandoff(rec.id, 'looks good', T0 + 5 * MIN)
  check('complete returns record', done !== null && done.id === rec.id)
  check('complete → done', done!.state === 'done')
  check('complete sets closedAt', done!.closedAt === new Date(T0 + 5 * MIN).toISOString())
  check('complete stores outcome', done!.outcome === 'looks good')
  check('done state persisted', loadRegistry()[0].state === 'done')
}

// ---------------------------------------------------------------------------
// duplicate complete is idempotent; unknown id → null
// ---------------------------------------------------------------------------
{
  freshChannelsDir('idempotent')

  const rec = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 't' },
    T0,
  )
  completeHandoff(rec.id, 'first outcome', T0 + MIN)
  const again = completeHandoff(rec.id, 'second outcome', T0 + 2 * MIN)
  check('duplicate complete → no error, record returned', again !== null && again.id === rec.id)
  check('duplicate complete → state unchanged', again!.state === 'done')
  check('duplicate complete → outcome unchanged', again!.outcome === 'first outcome')
  check('duplicate complete → closedAt unchanged', again!.closedAt === new Date(T0 + MIN).toISOString())

  check('unknown id → null', completeHandoff('h-nope-dead', undefined, T0) === null)
}

// ---------------------------------------------------------------------------
// matchPendingIds — exact #<id> substring, pending + chatId scoped
// ---------------------------------------------------------------------------
{
  freshChannelsDir('match')

  const a = createHandoff(
    { from: 'proj-a', to: { kind: 'botPeer', botId: 'bot-1', chatId: 'chat-x' }, task: 't1' },
    T0,
  )
  const b = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-c', chatId: 'chat-y' }, task: 't2' },
    T0 + 1,
  )

  check('matches #<id> in text', matchPendingIds('chat-x', `done with #${a.id} thanks`).join() === a.id)
  check('wrong chatId → no match', matchPendingIds('chat-y', `done with #${a.id}`).length === 0)
  check('other pending id matches its own channel', matchPendingIds('chat-y', `re #${b.id}`).join() === b.id)
  check('text without marker → no match', matchPendingIds('chat-x', 'no ids here #h-fake-0000').length === 0)

  completeHandoff(a.id, undefined, T0 + MIN)
  check('closed record no longer matches', matchPendingIds('chat-x', `#${a.id}`).length === 0)
}

// ---------------------------------------------------------------------------
// sweep lifecycle — nag once at timeout, escalate + expire at 2×, idempotent
// ---------------------------------------------------------------------------
{
  freshChannelsDir('sweep')
  const timeoutMs = 30 * MIN

  const rec = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 'slow task' },
    T0,
  )

  check('sweep before timeout → no actions', sweepHandoffs(T0 + 10 * MIN, timeoutMs).length === 0)

  const nagActions = sweepHandoffs(T0 + timeoutMs, timeoutMs)
  check('sweep at timeout → one nag', nagActions.length === 1 && nagActions[0].kind === 'nag')
  check('nag carries the record', nagActions[0].record.id === rec.id)
  check('naggedAt persisted', loadRegistry()[0].naggedAt === new Date(T0 + timeoutMs).toISOString())
  check('record still pending after nag', loadRegistry()[0].state === 'pending')

  check('re-sweep same window → no duplicate nag', sweepHandoffs(T0 + timeoutMs + MIN, timeoutMs).length === 0)

  const escActions = sweepHandoffs(T0 + 2 * timeoutMs, timeoutMs)
  check('sweep at 2× timeout → one escalate', escActions.length === 1 && escActions[0].kind === 'escalate')
  check('escalated record expired', escActions[0].record.state === 'expired')
  check('expired state persisted with closedAt',
    loadRegistry()[0].state === 'expired' && loadRegistry()[0].closedAt === new Date(T0 + 2 * timeoutMs).toISOString())

  check('re-sweep after expire → no actions', sweepHandoffs(T0 + 3 * timeoutMs, timeoutMs).length === 0)

  // completed handoffs never nag/escalate
  const done = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 'fast task' },
    T0,
  )
  completeHandoff(done.id, 'ok', T0 + MIN)
  check('done record ignored by sweep', sweepHandoffs(T0 + 5 * timeoutMs, timeoutMs).length === 0)

  // fresh pending that skipped the nag window escalates directly
  const late = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 'missed windows' },
    T0,
  )
  const lateActions = sweepHandoffs(T0 + 10 * timeoutMs, timeoutMs)
  check('un-nagged record past 2× → single escalate (no double action)',
    lateActions.length === 1 && lateActions[0].kind === 'escalate' && lateActions[0].record.id === late.id)
}

// ---------------------------------------------------------------------------
// prune — closed beyond 200 entries or 30 days; pending never pruned
// ---------------------------------------------------------------------------
{
  freshChannelsDir('prune')
  const DAY = 24 * 60 * 60 * 1000

  const records: HandoffRecord[] = []
  // 250 recent closed records — count prune should keep the newest 200
  for (let i = 0; i < 250; i++) {
    records.push({
      id: `h-${i.toString(36)}-c1o5`,
      from: 'proj-a',
      to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' },
      task: `task ${i}`,
      state: 'done',
      createdAt: new Date(T0 - DAY).toISOString(),
      closedAt: new Date(T0 - DAY + i * MIN).toISOString(),  // oldest first
    })
  }
  // one closed record older than 30 days — age prune drops it
  records.push({
    id: 'h-old-dead',
    from: 'proj-a',
    to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' },
    task: 'ancient',
    state: 'expired',
    createdAt: new Date(T0 - 40 * DAY).toISOString(),
    closedAt: new Date(T0 - 31 * DAY).toISOString(),
  })
  // one very old PENDING record — must survive both prunes
  records.push({
    id: 'h-oldpend-1111',
    from: 'proj-a',
    to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' },
    task: 'still open',
    state: 'pending',
    createdAt: new Date(T0 - 60 * DAY).toISOString(),
  })

  saveRegistry(records, T0)
  const after = loadRegistry()
  const closed = after.filter(r => r.state !== 'pending')

  check('closed capped at 200', closed.length === 200, `closed=${closed.length}`)
  check('30-day-old closed record pruned', !after.some(r => r.id === 'h-old-dead'))
  check('oldest closed dropped first', !closed.some(r => r.task === 'task 0'))
  check('newest closed retained', closed.some(r => r.task === 'task 249'))
  check('old pending record survives prune', after.some(r => r.id === 'h-oldpend-1111'))
}

// ---------------------------------------------------------------------------
// corrupt file → empty (fail-open); next write rewrites clean
// ---------------------------------------------------------------------------
{
  freshChannelsDir('corrupt')

  // corrupt JSON
  const filePath = handoffsPath()
  const { mkdirSync } = await import('node:fs')
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '{ not json !!!', 'utf8')
  check('corrupt file → empty registry', loadRegistry().length === 0)

  // valid JSON but not an array
  writeFileSync(filePath, '{"handoffs": []}', 'utf8')
  check('non-array JSON → empty registry', loadRegistry().length === 0)

  // next write rewrites clean
  const rec = createHandoff(
    { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: 'fresh start' },
    T0,
  )
  const reloaded = loadRegistry()
  check('write after corruption rewrites clean', reloaded.length === 1 && reloaded[0].id === rec.id)
  const onDisk = JSON.parse(readFileSync(filePath, 'utf8'))
  check('file on disk is v2 envelope', onDisk.version === 2 && Array.isArray(onDisk.handoffs) && Array.isArray(onDisk.chains))
}

// ---------------------------------------------------------------------------
// write-then-reload survival (restart persistence)
// ---------------------------------------------------------------------------
{
  freshChannelsDir('reload')

  const rec = createHandoff(
    { from: 'proj-a', to: { kind: 'botPeer', botId: 'bot-9', chatId: 'chat-z' }, task: 'survive restart' },
    T0,
  )
  sweepHandoffs(T0 + 30 * MIN, 30 * MIN)  // sets naggedAt

  const reloaded = loadRegistry()
  check('record survives reload', reloaded.length === 1)
  const r = reloaded[0]
  check('all fields round-trip',
    r.id === rec.id && r.from === 'proj-a' && r.task === 'survive restart' &&
    r.state === 'pending' && r.createdAt === rec.createdAt &&
    r.naggedAt === new Date(T0 + 30 * MIN).toISOString() &&
    r.to.kind === 'botPeer' && r.to.botId === 'bot-9' && r.to.chatId === 'chat-z')
}

// ---------------------------------------------------------------------------
// chains: legacy migration + v2 round-trip (AC10)
// ---------------------------------------------------------------------------
{
  const dir = freshChannelsDir('chain-migrate')
  const filePath = join(dir, 'shared', 'handoffs.json')
  mkdirSync(dirname(filePath), { recursive: true })
  const legacy: HandoffRecord[] = [{
    id: 'h-legacy-1', from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' },
    task: 'old hop', state: 'pending', createdAt: new Date(T0).toISOString(),
  }]
  writeFileSync(filePath, JSON.stringify(legacy), 'utf8')

  const file = loadRegistryFile()
  check('migrate: legacy array → handoffs', file.handoffs.length === 1 && file.handoffs[0].id === 'h-legacy-1')
  check('migrate: legacy array → empty chains', file.chains.length === 0)
  check('migrate: legacy loadRegistry still works', loadRegistry().length === 1)

  saveRegistryFile(file, T0)
  const onDisk = JSON.parse(readFileSync(filePath, 'utf8'))
  check('migrate: first save writes v2', onDisk.version === 2 && onDisk.handoffs.length === 1)
  const roundTrip = loadRegistryFile()
  check('migrate: v2 round-trips', roundTrip.handoffs[0].id === 'h-legacy-1' && roundTrip.chains.length === 0)

  // saveRegistry (legacy API) must preserve chains already on disk.
  const { chain } = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps: [{ target: 'proj-b', task: 'x' }], firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0,
  )
  saveRegistry(loadRegistry(), T0)
  check('migrate: legacy saveRegistry preserves chains', loadRegistryFile().chains.some(c => c.id === chain.id))
}

// ---------------------------------------------------------------------------
// chains: validateChainSteps (AC6 shape half)
// ---------------------------------------------------------------------------
{
  check('validate: empty steps refused', validateChainSteps([], 6) !== null)
  check('validate: over budget refused', validateChainSteps(
    [{ target: 'a', task: 'x' }, { target: 'b', task: 'y' }, { target: 'c', task: 'z' }], 2) !== null)
  check('validate: both role and target refused', validateChainSteps([{ role: 'r', target: 't', task: 'x' }], 6) !== null)
  check('validate: neither role nor target refused', validateChainSteps([{ task: 'x' }], 6) !== null)
  check('validate: missing task refused', validateChainSteps([{ target: 'a', task: '' }], 6) !== null)
  check('validate: bad gate refused', validateChainSteps([{ target: 'a', task: 'x', gate: 'nope' as any }], 6) !== null)
  check('validate: 1-step chain ok', validateChainSteps([{ target: 'a', task: 'x' }], 6) === null)
  check('validate: gated step ok', validateChainSteps([{ role: 'r', task: 'x', gate: 'approve' }], 6) === null)
}

// ---------------------------------------------------------------------------
// chains: nextChainAction — advance / complete / gate (AC2, AC4, AC5)
// ---------------------------------------------------------------------------
{
  const chain: ChainRecord = {
    id: 'c-t', from: 'proj-a', sourceChatId: 'chat-a',
    steps: [
      { target: 'proj-b', task: 's1' },
      { role: 'reviewer', task: 's2', gate: 'approve' },
      { target: 'proj-c', task: 's3' },
    ],
    cursor: 0, stepHandoffIds: ['h-1'], state: 'active', createdAt: new Date(T0).toISOString(),
  }
  const a0 = nextChainAction(chain, 0, 'done it')
  check('action: mid-step advances', a0.kind === 'advance' && a0.kind === 'advance' && a0.nextIndex === 1)
  const a1bad = nextChainAction(chain, 1, 'rejected: tests fail')
  check('action: gate fails on non-approve outcome', a1bad.kind === 'halt-gate')
  const a1empty = nextChainAction(chain, 1, undefined)
  check('action: gate fails on empty outcome', a1empty.kind === 'halt-gate')
  const a1ok = nextChainAction(chain, 1, '  Approved — LGTM')
  check('action: gate passes on approve prefix (trim/case)', a1ok.kind === 'advance' && a1ok.nextIndex === 2)
  const aLast = nextChainAction(chain, 2, 'shipped')
  check('action: last step completes', aLast.kind === 'complete')
}

// ---------------------------------------------------------------------------
// chains: createChain atomicity + advance latch + close idempotence (AC1, NFR4)
// ---------------------------------------------------------------------------
{
  freshChannelsDir('chain-life')
  const steps = [
    { target: 'proj-b', task: 'build it' },
    { target: 'proj-c', task: 'review it' },
  ]
  const { chain, record } = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps, firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0,
  )
  check('create: chain active, cursor 0', chain.state === 'active' && chain.cursor === 0)
  check('create: step-1 handoff tagged', record.chainId === chain.id && record.chainStep === 0 && record.state === 'pending')
  check('create: one atomic write persists both',
    loadRegistryFile().chains.length === 1 && loadRegistry().some(r => r.id === record.id))
  check('create: step-1 id tracked', findChain(chain.id)?.stepHandoffIds[0] === record.id)

  // advance
  const adv = advanceChainStep(chain.id, 1, { kind: 'project', slug: 'proj-c', chatId: 'chat-c' }, T0 + MIN)
  check('advance: fires step 2', adv !== null && adv.chain.cursor === 1 && adv.record.chainStep === 1)
  check('advance: step task copied', adv?.record.task === 'review it')
  check('advance: double-advance latch (same index) → null',
    advanceChainStep(chain.id, 1, { kind: 'project', slug: 'proj-c', chatId: 'chat-c' }, T0 + MIN) === null)
  check('advance: out-of-order index → null',
    advanceChainStep(chain.id, 3, { kind: 'project', slug: 'proj-c', chatId: 'chat-c' }, T0 + MIN) === null)

  // close
  const done = completeChain(chain.id, T0 + 2 * MIN)
  check('complete: chain done', done?.state === 'done' && done.closedAt !== undefined)
  check('complete: idempotent no-op', completeChain(chain.id, T0 + 3 * MIN)?.state === 'done')
  check('advance on closed chain → null',
    advanceChainStep(chain.id, 2, { kind: 'project', slug: 'proj-d', chatId: 'chat-d' }, T0 + 3 * MIN) === null)
  check('halt on closed chain keeps state', haltChain(chain.id, 'late', T0 + 3 * MIN)?.state === 'done')

  // halt + expire reasons on fresh chains
  const h = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps: [{ target: 'proj-b', task: 'x' }], firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0,
  )
  const halted = haltChain(h.chain.id, 'gate not approved', T0 + MIN)
  check('halt: state + reason', halted?.state === 'halted' && halted.closeReason === 'gate not approved')
  const e = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps: [{ target: 'proj-b', task: 'x' }], firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0 + 1,
  )
  const expired = expireChain(e.chain.id, 'step 1 unanswered', T0 + MIN)
  check('expire: state + reason', expired?.state === 'expired' && expired.closeReason === 'step 1 unanswered')
  check('unknown chain id → null', completeChain('c-nope', T0) === null)
}

// ---------------------------------------------------------------------------
// chains: prune policy mirrors closed handoffs (30d)
// ---------------------------------------------------------------------------
{
  freshChannelsDir('chain-prune')
  const old = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps: [{ target: 'proj-b', task: 'old' }], firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0,
  )
  completeChain(old.chain.id, T0)
  const live = createChain(
    { from: 'proj-a', sourceChatId: 'chat-a', steps: [{ target: 'proj-b', task: 'live' }], firstTo: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' } },
    T0,
  )
  // Save 31 days later: closed chain pruned, active chain kept.
  saveRegistryFile(loadRegistryFile(), T0 + 31 * 24 * 60 * MIN)
  const after = loadRegistryFile()
  check('prune: closed chain >30d dropped', !after.chains.some(c => c.id === old.chain.id))
  check('prune: active chain never pruned', after.chains.some(c => c.id === live.chain.id))
}

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------
for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll tests passed.`)
}
