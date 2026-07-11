/**
 * bun src/project-pool.test.ts
 * Pool lifecycle tests using MockProjectProcess (no Claude spawn yet).
 */
import { setTimeout as sleep } from 'node:timers/promises'

import { ChannelsConfigSchema } from './channels-config.ts'
import { MockProjectProcess, type InboundEnvelope, type OutboundReply } from './project-process.ts'
import { ProjectPool, type PoolEvent } from './project-pool.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

function makeConfig(opts: { idleEvictMinutes?: number; maxConcurrent?: number; projects?: Record<string, string> } = {}) {
  const projects = opts.projects ?? {
    '111111111111111111': 'alpha',
    '222222222222222222': 'beta',
    '333333333333333333': 'gamma',
  }
  return ChannelsConfigSchema.parse({
    master: { chatId: '999999999999999999' },
    defaults: {
      idleEvictMinutes: opts.idleEvictMinutes ?? 15,
      maxConcurrent: opts.maxConcurrent ?? 8,
    },
    projects: Object.fromEntries(Object.entries(projects).map(([id, slug]) => [id, { slug }])),
  })
}

function envelope(content: string): InboundEnvelope {
  return {
    messageId: '1',
    userId: 'u1',
    username: 'tester',
    content,
    ts: new Date().toISOString(),
  }
}

// --- 1. Lazy spawn + reply round-trip ---------------------------------------
{
  const config = makeConfig()
  const events: PoolEvent[] = []
  const replies: OutboundReply[] = []
  const created: MockProjectProcess[] = []

  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: (r) => replies.push(r),
    onEvent: (e) => events.push(e),
  })

  await pool.deliver('111111111111111111', envelope('hello'))
  check('1: spawned on first deliver', pool.size() === 1)
  check('1: spawn event fired', events.some((e) => e.kind === 'spawn' && e.chatId === '111111111111111111'))
  await sleep(5) // let microtask reply land
  check('1: reply received', replies.length === 1 && replies[0]!.kind === 'text')
  check('1: reply tagged with chatId', replies[0]!.chatId === '111111111111111111')

  await pool.shutdown()
}

// --- 2. Reuse alive process, do not double-spawn ----------------------------
{
  const config = makeConfig()
  let spawnCount = 0
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      spawnCount++
      return new MockProjectProcess({ chatId, slug: project.slug })
    },
    getConfig: () => config,
    onReply: () => {},
  })

  await pool.deliver('111111111111111111', envelope('one'))
  await pool.deliver('111111111111111111', envelope('two'))
  await pool.deliver('111111111111111111', envelope('three'))
  check('2: only one process for repeat deliveries', spawnCount === 1, `got ${spawnCount}`)

  await pool.shutdown()
}

// --- 3. Unknown chat_id is silently rejected --------------------------------
{
  const config = makeConfig()
  const events: PoolEvent[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => new MockProjectProcess({ chatId, slug: project.slug }),
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
  })
  await pool.deliver('888888888888888888', envelope('ignored'))
  check('3: pool stays empty on unknown chat_id', pool.size() === 0)
  check(
    '3: rejected event with unknown-project',
    events.some((e) => e.kind === 'rejected' && e.reason === 'unknown-project'),
  )
  await pool.shutdown()
}

// --- 4. maxConcurrent triggers LRU eviction ---------------------------------
{
  const config = makeConfig({ maxConcurrent: 2 })
  const events: PoolEvent[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => new MockProjectProcess({ chatId, slug: project.slug }),
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
  })

  await pool.deliver('111111111111111111', envelope('a'))
  await sleep(10)
  await pool.deliver('222222222222222222', envelope('b'))
  await sleep(10)
  // Third project — should evict 111 (oldest)
  await pool.deliver('333333333333333333', envelope('c'))
  await sleep(10)

  check('4: pool capped at 2', pool.size() === 2)
  check('4: 111 was evicted', !pool.has('111111111111111111'))
  check('4: 222 still alive', pool.has('222222222222222222'))
  check('4: 333 spawned', pool.has('333333333333333333'))
  check(
    '4: pool-full event tagged 111',
    events.some((e) => e.kind === 'evict' && e.reason === 'pool-full' && e.chatId === '111111111111111111'),
  )

  await pool.shutdown()
}

// --- 5. Idle eviction by elapsed time ---------------------------------------
{
  let now = 1_000_000
  const config = makeConfig({ idleEvictMinutes: 1 })
  const events: PoolEvent[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) =>
      new MockProjectProcess({ chatId, slug: project.slug, now: () => now }),
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('x'))
  check('5: alive before time advance', pool.has('111111111111111111'))

  // Advance fake clock 90 seconds (>1 minute idle threshold).
  now += 90_000
  pool.evictIdle()
  await sleep(5) // let the kill exit handler run
  check('5: evicted after idle window', !pool.has('111111111111111111'))
  check(
    '5: idle-evict event recorded',
    events.some((e) => e.kind === 'evict' && e.reason === 'idle-evict'),
  )

  await pool.shutdown()
}

// --- 6. shutdown kills all processes ----------------------------------------
{
  const config = makeConfig()
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
  })

  await pool.deliver('111111111111111111', envelope('a'))
  await pool.deliver('222222222222222222', envelope('b'))
  check('6: 2 alive before shutdown', pool.size() === 2)
  await pool.shutdown()
  check('6: 0 alive after shutdown', pool.size() === 0)
  check(
    '6: each process saw shutdown reason',
    created.every((p) => p.killReasons.includes('shutdown')),
  )
}

// --- 7. Stuck-watchdog: kills hung process after STUCK_THRESHOLD_MS ---------
{
  const config = makeConfig({ idleEvictMinutes: 60 }) // long idle window so we isolate stuck-detection
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  // Deliver but the mock hangs — never replies.
  await pool.deliver('111111111111111111', envelope('hang'))
  check('7: alive before stuck timeout', pool.has('111111111111111111'))

  // 4 minutes — under STUCK_THRESHOLD_MS (5 min). No watchdog kill yet.
  now += 4 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('7: not killed before threshold', pool.has('111111111111111111'))
  check('7: no stuck event yet', !events.some((e) => e.kind === 'stuck'))

  // Push past 5 min. Watchdog fires.
  now += 2 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('7: killed after threshold', !pool.has('111111111111111111'))
  check(
    '7: stuck event fired',
    events.some((e) => e.kind === 'stuck' && e.chatId === '111111111111111111'),
  )
  void created

  await pool.shutdown()
}

// --- 8. Stuck-watchdog: does NOT kill an idle-but-replied chat --------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => new MockProjectProcess({ chatId, slug: project.slug, now: () => now }),
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hello'))
  await sleep(5) // let the auto-reply land — bumps lastReplyMs to current `now`

  now += 30 * 60_000 // 30 min idle, but reply is up-to-date — not stuck.
  pool.evictIdle()
  await sleep(5)
  check(
    '8: idle-but-replied chat not flagged stuck',
    !events.some((e) => e.kind === 'stuck'),
  )

  await pool.shutdown()
}

// --- 9. Stuck-watchdog: VETO when transcript mtime is fresh -----------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hang-but-busy'))
  // Push past stuck threshold AND simulate ongoing transcript activity (subagents).
  now += 6 * 60_000
  created[0]!.setTranscriptMtimeMs(now - 30_000) // 30s ago — fresh
  pool.evictIdle()
  await sleep(5)
  check('9: not killed when transcript fresh', pool.has('111111111111111111'))
  check('9: no stuck event when transcript fresh', !events.some((e) => e.kind === 'stuck'))
  check(
    '9: progress-skip event fired',
    events.some(
      (e) =>
        e.kind === 'progress-skip' &&
        e.chatId === '111111111111111111' &&
        e.sinceTranscriptMs === 30_000,
    ),
  )

  await pool.shutdown()
}

// --- 10. Stuck-watchdog: kills when transcript mtime is null (parity) -------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hang-no-transcript'))
  now += 6 * 60_000
  // Mock defaults to transcriptMtimeMs() === null — no need to set.
  pool.evictIdle()
  await sleep(5)
  check('10: killed when transcript unknown', !pool.has('111111111111111111'))
  check('10: stuck event fired when transcript unknown', events.some((e) => e.kind === 'stuck'))

  await pool.shutdown()
}

// --- 11. Stuck-watchdog: kills when transcript mtime is stale ---------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hang-stale-transcript'))
  now += 6 * 60_000
  // Transcript hasn't been written in 7 minutes — past threshold.
  created[0]!.setTranscriptMtimeMs(now - 7 * 60_000)
  pool.evictIdle()
  await sleep(5)
  check('11: killed when transcript stale', !pool.has('111111111111111111'))
  check('11: stuck event fired when transcript stale', events.some((e) => e.kind === 'stuck'))

  await pool.shutdown()
}

// --- 12. Adaptive threshold: long turn history extends kill window -----------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('long-work'))
  // Last turn took 8 min → adaptive = max(5, ceil(8*1.5)) = 12 min
  created[0]!.setTurnHistory([8 * 60_000])

  // 6 min in — past 5-min base but under 12-min adaptive threshold.
  now += 6 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('12: not killed within adaptive threshold', pool.has('111111111111111111'))
  check('12: no stuck event before adaptive threshold', !events.some((e) => e.kind === 'stuck'))

  // 13 min in — past 12-min adaptive threshold.
  now += 7 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('12: killed after adaptive threshold', !pool.has('111111111111111111'))
  check(
    '12: stuck event carries effectiveThresholdMs',
    events.some(
      (e) => e.kind === 'stuck' && e.chatId === '111111111111111111' && e.effectiveThresholdMs === 12 * 60_000,
    ),
  )

  await pool.shutdown()
}

// --- 13. Circuit-breaker: opens after 5 consecutive crashes -----------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  const now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  for (let i = 0; i < 5; i++) {
    await pool.deliver('111111111111111111', { ...envelope(`crash-${i}`), messageId: `crash-msg-${i}` })
    await sleep(5) // let spawn settle
    created[i]!.crash()
  }

  check('13: circuit-open event fired', events.some((e) => e.kind === 'circuit-open'))
  check(
    '13: 4 respawn-scheduled events before circuit',
    events.filter((e) => e.kind === 'respawn-scheduled').length === 4,
  )
  check(
    '13: circuit-open has correct failureCount',
    events.some((e) => e.kind === 'circuit-open' && e.failureCount === 5),
  )

  await pool.shutdown()
}

// --- 14. Circuit-breaker: drops messages when circuit is open ---------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  // Open the circuit
  for (let i = 0; i < 5; i++) {
    await pool.deliver('111111111111111111', { ...envelope(`crash-${i}`), messageId: `cb-msg-${i}` })
    await sleep(5)
    created[i]!.crash()
  }
  check('14: circuit is open', events.some((e) => e.kind === 'circuit-open'))

  const countBefore = created.length
  // Message while circuit open — should be dropped, no new spawn
  await pool.deliver('111111111111111111', { ...envelope('dropped-msg'), messageId: 'cb-dropped' })
  await sleep(5)
  check('14: no new process spawned while circuit open', created.length === countBefore)

  // Advance time past reset window — circuit should auto-reset
  now += 11 * 60_000
  await pool.deliver('111111111111111111', { ...envelope('after-reset'), messageId: 'cb-after-reset' })
  await sleep(5)
  check('14: circuit-reset event fired', events.some((e) => e.kind === 'circuit-reset'))
  check('14: new process spawned after circuit reset', created.length > countBefore)

  await pool.shutdown()
}

// --- 15. Kill-loop: 3 null kills → pause + master alert ----------------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const replies: OutboundReply[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: (r) => replies.push(r),
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  // Three full stuck-kill cycles with no tool progress.
  for (let cycle = 0; cycle < 3; cycle++) {
    await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: `ll-msg-${cycle}` })
    now += 6 * 60_000 // past stuck threshold
    pool.evictIdle()
    await sleep(5)
  }

  check(
    '15: kill-loop-paused event fired',
    events.some((e) => e.kind === 'kill-loop-paused' && e.chatId === '111111111111111111' && e.killCount === 3),
  )
  check(
    '15: master alert sent to master chatId',
    replies.some((r) => r.kind === 'text' && r.chatId === '999999999999999999' && r.text.toLowerCase().includes('kill-loop')),
  )

  await pool.shutdown()
}

// --- 16. Kill-loop: tool call resets counter ----------------------------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  // Two null kills (counter = 2).
  for (let cycle = 0; cycle < 2; cycle++) {
    await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: `ll2-msg-${cycle}` })
    now += 6 * 60_000
    pool.evictIdle()
    await sleep(5)
  }
  check('16: not paused after 2 kills', !events.some((e) => e.kind === 'kill-loop-paused'))

  // Spawn again, fire tool progress — resets null-kill state.
  await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: 'll2-msg-2' })
  created[created.length - 1]!.fireToolProgress()
  now += 6 * 60_000
  pool.evictIdle()
  await sleep(5)

  // One more kill after a reset — counter should be 1, still no pause.
  await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: 'll2-msg-3' })
  now += 6 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('16: counter reset by tool progress — no pause after another kill', !events.some((e) => e.kind === 'kill-loop-paused'))

  await pool.shutdown()
}

// --- 17. Kill-loop: delivers dropped while paused ----------------------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const replies: OutboundReply[] = []
  const created: MockProjectProcess[] = []
  let spawnCount = 0
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      spawnCount++
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: (r) => replies.push(r),
    now: () => now,
  })

  // Trigger pause.
  for (let cycle = 0; cycle < 3; cycle++) {
    await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: `ll3-msg-${cycle}` })
    now += 6 * 60_000
    pool.evictIdle()
    await sleep(5)
  }
  const spawnsBeforePause = spawnCount
  const repliesBeforePause = replies.length

  // Deliver while paused — must be dropped (no new spawn, no mock reply for that chatId).
  await pool.deliver('111111111111111111', { ...envelope('should be dropped'), messageId: 'll3-dropped' })
  await sleep(5)
  check('17: no new spawn while paused', spawnCount === spawnsBeforePause)
  check(
    '17: no reply for chatId while paused',
    replies.slice(repliesBeforePause).every((r) => r.chatId !== '111111111111111111'),
  )

  await pool.shutdown()
}

// --- 18. Kill-loop: killChat clears pause ------------------------------------
{
  const config = makeConfig({ idleEvictMinutes: 60 })
  let now = 1_000_000
  const events: PoolEvent[] = []
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    onEvent: (e) => events.push(e),
    now: () => now,
  })

  // Trigger pause.
  for (let cycle = 0; cycle < 3; cycle++) {
    await pool.deliver('111111111111111111', { ...envelope('hang'), messageId: `ll4-msg-${cycle}` })
    now += 6 * 60_000
    pool.evictIdle()
    await sleep(5)
  }
  check('18: kill-loop-paused triggered', events.some((e) => e.kind === 'kill-loop-paused'))

  // killChat('requested') — simulates !project start
  await pool.killChat('111111111111111111', 'requested')
  await sleep(5)
  check(
    '18: kill-loop-resumed event fired',
    events.some((e) => e.kind === 'kill-loop-resumed' && e.chatId === '111111111111111111'),
  )

  // Now deliver should work again.
  const eventsBeforeResume = events.length
  await pool.deliver('111111111111111111', { ...envelope('after resume'), messageId: 'll4-after' })
  await sleep(5)
  check(
    '18: spawn event after resume (deliver not dropped)',
    events.slice(eventsBeforeResume).some((e) => e.kind === 'spawn'),
  )

  await pool.shutdown()
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
