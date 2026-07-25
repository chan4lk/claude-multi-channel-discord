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

  // P312: episodeStartMs is the pending-turn start, stable across poll cycles
  const firstSkip = events.find((e) => e.kind === 'progress-skip')
  check(
    '9b: progress-skip carries episodeStartMs = turn start',
    firstSkip?.kind === 'progress-skip' && firstSkip.episodeStartMs === 1_000_000,
    firstSkip?.kind === 'progress-skip' ? String(firstSkip.episodeStartMs) : 'no event',
  )
  now += 60_000
  created[0]!.setTranscriptMtimeMs(now - 30_000)
  pool.evictIdle()
  await sleep(5)
  const skips = events.filter((e) => e.kind === 'progress-skip')
  check(
    '9c: second poll same turn → same episodeStartMs',
    skips.length >= 2 &&
      skips.every((e) => e.kind === 'progress-skip' && e.episodeStartMs === 1_000_000),
    skips.map((e) => (e.kind === 'progress-skip' ? e.episodeStartMs : '?')).join(','),
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

// --- 19. isBusy: no process for chatId → false ----------------------------------
{
  const config = makeConfig()
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => new MockProjectProcess({ chatId, slug: project.slug }),
    getConfig: () => config,
    onReply: () => {},
  })

  // Never delivered — no process spawned.
  check('19: isBusy false when no process', pool.isBusy('111111111111111111', 5 * 60_000) === false)

  await pool.shutdown()
}

// --- 20. isBusy: live process, no pending deliver, stale transcript → false ----
{
  const config = makeConfig()
  let now = 1_000_000
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hello'))
  await sleep(5) // let reply land (clears pendingDeliverAtMs)

  // Transcript mtime older than grace.
  const graceMs = 5 * 60_000
  created[0]!.setTranscriptMtimeMs(now - graceMs - 1_000)

  check('20: isBusy false with stale transcript and no pending deliver', pool.isBusy('111111111111111111', graceMs) === false)

  await pool.shutdown()
}

// --- 21. isBusy: live process, fresh transcript (mtime within grace) → true ----
{
  const config = makeConfig()
  let now = 1_000_000
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hang'))

  // Transcript written 30 s ago — within grace (5 min).
  const graceMs = 5 * 60_000
  created[0]!.setTranscriptMtimeMs(now - 30_000)

  check('21: isBusy true with fresh transcript', pool.isBusy('111111111111111111', graceMs) === true)

  await pool.shutdown()
}

// --- 22. isBusy: live process, pendingDeliverAtMs returns a number → true ------
{
  const config = makeConfig()
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
  })

  await pool.deliver('111111111111111111', envelope('hang'))
  // hangs=true means pendingDeliverAtMs() is set and never cleared; transcript is null.

  const graceMs = 5 * 60_000
  check('22: isBusy true when pending deliver in-flight', pool.isBusy('111111111111111111', graceMs) === true)

  await pool.shutdown()
}

// --- 23. isBusy: boundary — mtime exactly graceMs old → false (strict <) -------
{
  const config = makeConfig()
  let now = 1_000_000
  const created: MockProjectProcess[] = []
  const pool = new ProjectPool({
    factory: ({ chatId, project }) => {
      const p = new MockProjectProcess({ chatId, slug: project.slug, now: () => now, hangs: true })
      created.push(p)
      return p
    },
    getConfig: () => config,
    onReply: () => {},
    now: () => now,
  })

  await pool.deliver('111111111111111111', envelope('hang'))

  const graceMs = 5 * 60_000
  // Mtime is exactly graceMs ago — Date.now() - mtime === graceMs (not strictly <).
  // isBusy uses strict < so this must return false.
  // We need real Date.now() to match the mtime calculation inside isBusy.
  const realNow = Date.now()
  created[0]!.setTranscriptMtimeMs(realNow - graceMs)
  // pendingDeliverAtMs is set (hangs=true), so zero it out by patching internal state.
  // Can't clear it without a test hook, so instead test with a non-hanging process
  // whose reply has cleared pendingDeliver, then we set the mtime boundary exactly.
  // Use a fresh pool for the exact-boundary test.
  await pool.shutdown()
}
// Boundary test (fresh pool, no pending deliver):
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

  await pool.deliver('111111111111111111', envelope('hello'))
  await sleep(5) // let reply land — clears pendingDeliverAtMs

  const graceMs = 5 * 60_000
  // Set mtime exactly graceMs ago relative to real Date.now().
  const realNow = Date.now()
  created[0]!.setTranscriptMtimeMs(realNow - graceMs)

  check('23: isBusy false at exact grace boundary (strict <)', pool.isBusy('111111111111111111', graceMs) === false)

  await pool.shutdown()
}

// --- 24. Turn-guard AC1: completeTurn clears pending deliver, no stuck kill ----
// AC2 (turn-completion detection runs even with zero tool-progress/limit
// handlers subscribed, i.e. progressMode "off") is internal to the
// ClaudeProjectProcess transcript watcher's early-return condition and is
// not reachable through the pool + mock harness — verified by code review
// of src/claude-process.ts (watcher only returns early when no handlers
// AND no pending deliver).
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

  // Deliver; the mock hangs — no reply tool call will ever clear the flag.
  await pool.deliver('111111111111111111', envelope('no-reply-turn'))
  check('24: pending deliver armed after deliver', created[0]!.pendingDeliverAtMs() === 1_000_000)

  // Transcript records turn_duration — turn completed without a reply (20 min turn).
  created[0]!.completeTurn(20 * 60_000)
  check('24: pendingDeliverAtMs null after completeTurn', created[0]!.pendingDeliverAtMs() === null)

  // turnHistory was fed: adaptive threshold grows past the 5-min base
  // (max(5min, ceil(20min * 1.5)) capped at 30 min → 30 min).
  const base = 5 * 60_000
  check(
    '24: completeTurn fed turnHistory (adaptive threshold above base)',
    created[0]!.adaptiveThresholdMs(base) === 30 * 60_000,
    String(created[0]!.adaptiveThresholdMs(base)),
  )

  // Sweep well past even the 30-min adaptive cap — watchdog must not fire.
  now += 31 * 60_000
  pool.evictIdle()
  await sleep(5)
  check('24: still alive after post-turn sweep', pool.has('111111111111111111'))
  check('24: no stuck event after completed turn', !events.some((e) => e.kind === 'stuck'))

  await pool.shutdown()
}

// --- 25. Turn-guard AC3: idle past cutoff + fresh transcript → evict-skip ------
{
  const config = makeConfig({ idleEvictMinutes: 1 })
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

  await pool.deliver('111111111111111111', envelope('mid-build'))
  await sleep(5) // let the reply land — clears pendingDeliverAtMs

  // 90 s idle (past the 1-min window) but transcript written 30 s ago —
  // agent is mid-turn (long build with no MCP calls). Must not evict.
  now += 90_000
  created[0]!.setTranscriptMtimeMs(now - 30_000)
  pool.evictIdle()
  await sleep(5)
  check('25: not killed when transcript fresh inside idle window', pool.has('111111111111111111'))
  check('25: process still alive', created[0]!.isAlive())
  check('25: no evict event', !events.some((e) => e.kind === 'evict'))
  check(
    '25: evict-skip fired with sinceActivityMs/sinceTranscriptMs',
    events.some(
      (e) =>
        e.kind === 'evict-skip' &&
        e.chatId === '111111111111111111' &&
        e.sinceActivityMs === 90_000 &&
        e.sinceTranscriptMs === 30_000,
    ),
  )

  await pool.shutdown()
}

// --- 26. Turn-guard AC4: idle + stale/null transcript → evict as before --------
{
  // Sub-case 1: transcript mtime older than the idle cutoff.
  const config = makeConfig({ idleEvictMinutes: 1 })
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

  await pool.deliver('111111111111111111', envelope('idle-stale'))
  await sleep(5) // clears pendingDeliverAtMs

  now += 90_000
  created[0]!.setTranscriptMtimeMs(now - 70_000) // older than the 60s cutoff
  pool.evictIdle()
  await sleep(5)
  check('26: killed when transcript stale', !pool.has('111111111111111111'))
  check(
    '26: idle-evict event fired for stale transcript',
    events.some((e) => e.kind === 'evict' && e.reason === 'idle-evict'),
  )
  check('26: kill reason was idle-evict', created[0]!.killReasons.includes('idle-evict'))

  await pool.shutdown()
}
{
  // Sub-case 2: transcript mtime null (session id never captured).
  const config = makeConfig({ idleEvictMinutes: 1 })
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

  await pool.deliver('111111111111111111', envelope('idle-null'))
  await sleep(5) // clears pendingDeliverAtMs

  now += 90_000
  // Mock defaults to transcriptMtimeMs() === null — no need to set.
  pool.evictIdle()
  await sleep(5)
  check('26: killed when transcript null', !pool.has('111111111111111111'))
  check(
    '26: idle-evict event fired for null transcript',
    events.some((e) => e.kind === 'evict' && e.reason === 'idle-evict'),
  )
  check('26: no evict-skip for null transcript', !events.some((e) => e.kind === 'evict-skip'))

  await pool.shutdown()
}

// --- 27. Turn-guard AC5: genuinely stuck session still watchdog-killed ---------
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

  // Pending deliver, no turn-completion, transcript stale past the 5-min
  // effective threshold — the watchdog path must be unchanged by the guards.
  await pool.deliver('111111111111111111', envelope('genuinely-stuck'))
  now += 6 * 60_000
  created[0]!.setTranscriptMtimeMs(now - 7 * 60_000)
  pool.evictIdle()
  await sleep(5)
  check('27: genuinely stuck session killed', !pool.has('111111111111111111'))
  check(
    '27: stuck event fired for genuinely stuck session',
    events.some((e) => e.kind === 'stuck' && e.chatId === '111111111111111111'),
  )
  check('27: kill reason was watchdog', created[0]!.killReasons.includes('watchdog'))

  await pool.shutdown()
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
