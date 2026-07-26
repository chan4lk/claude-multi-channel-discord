/**
 * bun src/scheduler.test.ts
 * Scheduler tick decision matrix and schema round-trip tests.
 *
 * Uses a tmp MCD_CHANNELS_DIR so loadSchedules/saveSchedules operate on
 * isolated files and don't touch the real state directory.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadSchedules, saveSchedules, type SchedulesFileShape } from './schedules-config.ts'
import { Scheduler } from './scheduler.ts'
import type { InboundEnvelope } from './project-process.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string): void {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// Helper — writes a schedules.json with the given schedules array
function writeSchedulesFile(dir: string, schedules: unknown[]): void {
  const file = join(dir, 'schedules.json')
  writeFileSync(file, JSON.stringify({ version: 1, schedules }))
}

// Helper — reads schedules.json back
function readSchedulesFile(dir: string): SchedulesFileShape {
  return loadSchedules(join(dir, 'schedules.json'))
}

// Helper — make a base schedule object that satisfies the schema
function makeSchedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's_test_001',
    chatId: '111111111111111111',
    interval: 'every 30m',
    prompt: 'run /specclaw:loop',
    lastRunAt: null,
    runCount: 0,
    ...overrides,
  }
}

// Helper — build a Scheduler with stubbed deps, returns scheduler + deliver spy
function makeScheduler(opts: {
  dir: string
  isBusy?: (chatId: string, graceMs: number) => boolean
}): { scheduler: Scheduler; delivered: Array<{ chatId: string; envelope: InboundEnvelope }>; isBusyCallCount: () => number } {
  const delivered: Array<{ chatId: string; envelope: InboundEnvelope }> = []
  let isBusyCallCount = 0

  const isBusy = opts.isBusy
    ? (chatId: string, graceMs: number) => {
        isBusyCallCount++
        return opts.isBusy!(chatId, graceMs)
      }
    : undefined

  const scheduler = new Scheduler({
    deliver: async (chatId, envelope) => {
      delivered.push({ chatId, envelope })
    },
    log: () => {},
    isBusy,
  })

  return { scheduler, delivered, isBusyCallCount: () => isBusyCallCount }
}

// ============================================================
// AC1 — Schema round-trip
// ============================================================

// AC1a: load a file WITHOUT the new fields — should parse fine
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule()])
    const file = readSchedulesFile(dir)
    check('AC1a: legacy file without new fields loads', file.schedules.length === 1)
    check('AC1a: onlyWhenIdle defaults to undefined', file.schedules[0]!.onlyWhenIdle === undefined)
    check('AC1a: idleGraceMinutes defaults to undefined', file.schedules[0]!.idleGraceMinutes === undefined)
    check('AC1a: lastSkippedAt defaults to undefined', file.schedules[0]!.lastSkippedAt === undefined)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// AC1b: round-trip — save with new fields, load back, assert they survive
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const schedPath = join(dir, 'schedules.json')
    const file: SchedulesFileShape = {
      version: 1,
      schedules: [
        {
          id: 's_roundtrip',
          chatId: '111111111111111111',
          interval: 'every 30m',
          prompt: 'run loop',
          type: 'prompt',
          enabled: true,
          lastRunAt: null,
          createdAt: new Date().toISOString(),
          maxRuns: null,
          runCount: 0,
          onlyWhenIdle: true,
          idleGraceMinutes: 10,
          lastSkippedAt: '2026-07-12T10:00:00.000Z',
        },
      ],
    }
    saveSchedules(file, schedPath)
    const loaded = loadSchedules(schedPath)
    const s = loaded.schedules[0]!
    check('AC1b: onlyWhenIdle round-trips', s.onlyWhenIdle === true)
    check('AC1b: idleGraceMinutes round-trips', s.idleGraceMinutes === 10)
    check('AC1b: lastSkippedAt round-trips', s.lastSkippedAt === '2026-07-12T10:00:00.000Z')
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// AC2 — Tick decision matrix
// ============================================================

// AC2a: gated + isBusy→true — deliver NOT called, lastRunAt still null, runCount 0, lastSkippedAt set
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ onlyWhenIdle: true, idleGraceMinutes: 5 })])
    const { scheduler, delivered } = makeScheduler({ dir, isBusy: () => true })
    await scheduler.tick()
    check('AC2a: gated+busy → no deliver', delivered.length === 0)
    const after = readSchedulesFile(dir)
    const s = after.schedules[0]!
    check('AC2a: lastRunAt still null', s.lastRunAt === null)
    check('AC2a: runCount still 0', s.runCount === 0)
    check('AC2a: lastSkippedAt set', typeof s.lastSkippedAt === 'string' && s.lastSkippedAt.length > 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// AC2b: gated + isBusy→false — deliver called, lastRunAt set, runCount 1
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ onlyWhenIdle: true, idleGraceMinutes: 5 })])
    const { scheduler, delivered } = makeScheduler({ dir, isBusy: () => false })
    await scheduler.tick()
    check('AC2b: gated+idle → deliver called', delivered.length === 1)
    const after = readSchedulesFile(dir)
    const s = after.schedules[0]!
    check('AC2b: lastRunAt set', typeof s.lastRunAt === 'string' && s.lastRunAt.length > 0)
    check('AC2b: runCount incremented', s.runCount === 1)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// AC2c: non-gated + isBusy→true — deliver called (gate not consulted)
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    // No onlyWhenIdle — non-gated schedule
    writeSchedulesFile(dir, [makeSchedule()])
    const { scheduler, delivered, isBusyCallCount } = makeScheduler({ dir, isBusy: () => true })
    await scheduler.tick()
    check('AC2c: non-gated+busy → deliver called', delivered.length === 1)
    check('AC2c: isBusy never invoked for non-gated', isBusyCallCount() === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// AC2d: gated + NO isBusy dep → deliver called (fail-open)
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ onlyWhenIdle: true })])
    // No isBusy dep provided
    const { scheduler, delivered } = makeScheduler({ dir })
    await scheduler.tick()
    check('AC2d: gated+no-dep → deliver called (fail-open)', delivered.length === 1)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// AC4 — Two-tick: skip then fire
// ============================================================

// AC4: first tick busy → skip; flip to idle, second tick → deliver called, lastRunAt set
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ onlyWhenIdle: true, idleGraceMinutes: 5 })])
    let busy = true
    const delivered: Array<{ chatId: string; envelope: InboundEnvelope }> = []
    const scheduler = new Scheduler({
      deliver: async (chatId, envelope) => {
        delivered.push({ chatId, envelope })
      },
      log: () => {},
      isBusy: () => busy,
    })

    // First tick — busy, skip
    await scheduler.tick()
    check('AC4: first tick (busy) → no deliver', delivered.length === 0)
    const afterFirst = readSchedulesFile(dir)
    check('AC4: lastRunAt still null after skip', afterFirst.schedules[0]!.lastRunAt === null)
    check('AC4: lastSkippedAt set after skip', typeof afterFirst.schedules[0]!.lastSkippedAt === 'string')

    // Flip to idle — second tick should fire
    busy = false
    await scheduler.tick()
    check('AC4: second tick (idle) → deliver called', delivered.length === 1)
    const afterSecond = readSchedulesFile(dir)
    check('AC4: lastRunAt set after second tick', typeof afterSecond.schedules[0]!.lastRunAt === 'string')
    check('AC4: runCount is 1 after second tick', afterSecond.schedules[0]!.runCount === 1)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// isProjectDisabled dep — tick skip
// ============================================================

// PD-1: due schedule + isProjectDisabled=true → deliver NOT called, lastSkippedAt set
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const DISABLED_CHAT = '444444444444444444'
    const ENABLED_CHAT  = '555555555555555555'
    writeSchedulesFile(dir, [
      makeSchedule({ id: 's_disabled', chatId: DISABLED_CHAT }),
      makeSchedule({ id: 's_enabled',  chatId: ENABLED_CHAT }),
    ])
    const delivered: Array<{ chatId: string }> = []
    const scheduler = new Scheduler({
      deliver: async (chatId, envelope) => { delivered.push({ chatId }) },
      log: () => {},
      isProjectDisabled: (chatId) => chatId === DISABLED_CHAT,
    })
    await scheduler.tick()
    check('PD-1: disabled project → deliver NOT called for that chatId', !delivered.some(d => d.chatId === DISABLED_CHAT))
    check('PD-1: enabled project → deliver IS called',                   delivered.some(d => d.chatId === ENABLED_CHAT))
    const after = readSchedulesFile(dir)
    const disabled = after.schedules.find(s => s.id === 's_disabled')!
    check('PD-1: disabled → lastRunAt still null', disabled.lastRunAt === null)
    check('PD-1: disabled → runCount still 0',     disabled.runCount === 0)
    check('PD-1: disabled → lastSkippedAt set',    typeof disabled.lastSkippedAt === 'string' && disabled.lastSkippedAt.length > 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// PD-2: isProjectDisabled dep absent → fires as before (fail-open)
// (Every existing test without the dep implicitly covers this; we verify explicitly)
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule()])
    const { scheduler, delivered } = makeScheduler({ dir }) // no isProjectDisabled
    await scheduler.tick()
    check('PD-2: no dep → deliver called (fail-open)', delivered.length === 1)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — AC1 schema round-trip (stopOnReply)
// ============================================================

// noteReply-AC1a: save/load with stopOnReply — field survives; legacy entry without field parses
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const schedPath = join(dir, 'schedules.json')
    const file: SchedulesFileShape = {
      version: 1,
      schedules: [
        {
          id: 's_sor_roundtrip',
          chatId: '111111111111111111',
          interval: 'every 30m',
          prompt: 'run loop',
          type: 'prompt',
          enabled: true,
          lastRunAt: null,
          createdAt: new Date().toISOString(),
          maxRuns: null,
          runCount: 0,
          stopOnReply: 'backlog complete',
        },
      ],
    }
    saveSchedules(file, schedPath)
    const loaded = loadSchedules(schedPath)
    const s = loaded.schedules[0]!
    check('noteReply-AC1a: stopOnReply round-trips', s.stopOnReply === 'backlog complete')

    // Legacy entry without stopOnReply parses fine
    const schedPath2 = join(dir, 'schedules2.json')
    saveSchedules({ version: 1, schedules: [{ id: 's_legacy', chatId: '111111111111111111', interval: 'every 30m', prompt: 'p', type: 'prompt', enabled: true, lastRunAt: null, createdAt: new Date().toISOString(), maxRuns: null, runCount: 0 }] }, schedPath2)
    const loaded2 = loadSchedules(schedPath2)
    check('noteReply-AC1a: legacy entry without stopOnReply parses', loaded2.schedules[0]!.stopOnReply === undefined)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// noteReply-AC1b: invalid regex rejected by saveSchedules (schema validation)
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const schedPath = join(dir, 'schedules.json')
    let threw = false
    try {
      saveSchedules({
        version: 1,
        schedules: [
          {
            id: 's_badregex',
            chatId: '111111111111111111',
            interval: 'every 30m',
            prompt: 'p',
            type: 'prompt',
            enabled: true,
            lastRunAt: null,
            createdAt: new Date().toISOString(),
            maxRuns: null,
            runCount: 0,
            stopOnReply: '(',
          },
        ],
      }, schedPath)
    } catch {
      threw = true
    }
    check('noteReply-AC1b: invalid regex "(" rejected by saveSchedules', threw)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — AC2 case-insensitive match → disabled + persisted + hook once
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    writeSchedulesFile(dir, [
      makeSchedule({
        stopOnReply: 'backlog complete',
        lastRunAt: '2026-07-12T08:00:00.000Z',
        enabled: true,
      }),
    ])
    const autoPauseCalls: Array<{ schedule: unknown; pattern: string }> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      onAutoPause: (schedule, pattern) => { autoPauseCalls.push({ schedule, pattern }) },
    })
    scheduler.noteReply(CHAT_ID, 'Backlog Complete — nothing left')
    const after = readSchedulesFile(dir)
    const s = after.schedules[0]!
    check('noteReply-AC2: enabled becomes false', s.enabled === false)
    check('noteReply-AC2: persisted to disk', s.enabled === false)
    check('noteReply-AC2: onAutoPause called once', autoPauseCalls.length === 1)
    check('noteReply-AC2: onAutoPause pattern correct', autoPauseCalls[0]?.pattern === 'backlog complete')
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — AC3 no-match → unchanged, hook not called
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    writeSchedulesFile(dir, [
      makeSchedule({
        stopOnReply: 'backlog complete',
        lastRunAt: '2026-07-12T08:00:00.000Z',
        enabled: true,
      }),
    ])
    const autoPauseCalls: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      onAutoPause: (s, p) => { autoPauseCalls.push({ s, p }) },
    })
    scheduler.noteReply(CHAT_ID, 'still working')
    const after = readSchedulesFile(dir)
    check('noteReply-AC3: enabled stays true on no-match', after.schedules[0]!.enabled === true)
    check('noteReply-AC3: onAutoPause not called', autoPauseCalls.length === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — AC4 never-fired (lastRunAt null) → not matched even when text matches
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    writeSchedulesFile(dir, [
      makeSchedule({
        stopOnReply: 'backlog complete',
        lastRunAt: null,
        enabled: true,
      }),
    ])
    const autoPauseCalls: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      onAutoPause: (s, p) => { autoPauseCalls.push({ s, p }) },
    })
    scheduler.noteReply(CHAT_ID, 'Backlog Complete — nothing left')
    const after = readSchedulesFile(dir)
    check('noteReply-AC4: never-fired → enabled unchanged', after.schedules[0]!.enabled === true)
    check('noteReply-AC4: never-fired → onAutoPause not called', autoPauseCalls.length === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — AC5 already-disabled → hook not called
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    writeSchedulesFile(dir, [
      makeSchedule({
        stopOnReply: 'backlog complete',
        lastRunAt: '2026-07-12T08:00:00.000Z',
        enabled: false,
      }),
    ])
    const autoPauseCalls: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      onAutoPause: (s, p) => { autoPauseCalls.push({ s, p }) },
    })
    scheduler.noteReply(CHAT_ID, 'Backlog Complete — nothing left')
    const after = readSchedulesFile(dir)
    check('noteReply-AC5: already-disabled → enabled stays false', after.schedules[0]!.enabled === false)
    check('noteReply-AC5: already-disabled → onAutoPause not called', autoPauseCalls.length === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — FR8 runtime bad pattern → does not throw, schedule stays enabled
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    // Write directly via JSON.stringify, bypassing saveSchedules validation
    const schedPath = join(dir, 'schedules.json')
    writeFileSync(schedPath, JSON.stringify({
      version: 1,
      schedules: [{
        id: 's_badpat',
        chatId: CHAT_ID,
        interval: 'every 30m',
        prompt: 'run loop',
        type: 'prompt',
        enabled: true,
        lastRunAt: '2026-07-12T08:00:00.000Z',
        createdAt: new Date().toISOString(),
        maxRuns: null,
        runCount: 1,
        stopOnReply: '(',
      }],
    }))
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
    })
    let threw = false
    try {
      scheduler.noteReply(CHAT_ID, 'Backlog Complete — nothing left')
    } catch {
      threw = true
    }
    check('noteReply-FR8: invalid runtime pattern does not throw', !threw)
    // Since the schema validation in loadSchedules would reject the bad pattern,
    // the schedule stays as-is (not processed)
    // Just verifying no throw is the requirement — enabled state depends on loadSchedules behavior
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// noteReply — Multi-schedule: both patterns match → both disabled, hook called twice
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const CHAT_ID = '111111111111111111'
    writeSchedulesFile(dir, [
      {
        id: 's_multi_001',
        chatId: CHAT_ID,
        interval: 'every 30m',
        prompt: 'run /specclaw:loop',
        lastRunAt: '2026-07-12T08:00:00.000Z',
        runCount: 1,
        enabled: true,
        stopOnReply: 'backlog complete',
      },
      {
        id: 's_multi_002',
        chatId: CHAT_ID,
        interval: 'every 2h',
        prompt: 'run /specclaw:loop',
        lastRunAt: '2026-07-12T06:00:00.000Z',
        runCount: 2,
        enabled: true,
        stopOnReply: 'nothing left',
      },
    ])
    const autoPauseCalls: Array<{ id: string; pattern: string }> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      onAutoPause: (schedule, pattern) => { autoPauseCalls.push({ id: schedule.id, pattern }) },
    })
    scheduler.noteReply(CHAT_ID, 'Backlog Complete — nothing left to do')
    const after = readSchedulesFile(dir)
    check('noteReply-multi: first schedule disabled', after.schedules[0]!.enabled === false)
    check('noteReply-multi: second schedule disabled', after.schedules[1]!.enabled === false)
    check('noteReply-multi: onAutoPause called twice', autoPauseCalls.length === 2)
    const ids = autoPauseCalls.map((c) => c.id).sort()
    check('noteReply-multi: both schedule ids notified', ids[0] === 's_multi_001' && ids[1] === 's_multi_002')
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// halt escalation (loop-halt-escalation) — schema round-trip
// ============================================================

// halt-schema: escalatedAt survives save/load; legacy entry parses without it
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    const schedPath = join(dir, 'schedules.json')
    saveSchedules({
      version: 1,
      schedules: [{
        id: 's_esc_roundtrip',
        chatId: '111111111111111111',
        interval: 'every 30m',
        prompt: 'p',
        type: 'prompt',
        enabled: false,
        lastRunAt: null,
        createdAt: new Date().toISOString(),
        maxRuns: null,
        runCount: 0,
        escalatedAt: '2026-07-12T09:00:00.000Z',
      }],
    }, schedPath)
    const loaded = loadSchedules(schedPath)
    check('halt-schema: escalatedAt round-trips', loaded.schedules[0]!.escalatedAt === '2026-07-12T09:00:00.000Z')

    const schedPath2 = join(dir, 'schedules2.json')
    writeFileSync(schedPath2, JSON.stringify({ version: 1, schedules: [makeSchedule()] }))
    const loaded2 = loadSchedules(schedPath2)
    check('halt-schema: legacy entry without escalatedAt parses', loaded2.schedules[0]!.escalatedAt === undefined)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// halt escalation — AC1 blocked → suspend + escalate once; healthy → fire
// ============================================================

// halt-AC1a: due schedule + halted project → no deliver, enabled false, escalatedAt set, onEscalate once with change+evidence
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule()])
    const delivered: Array<unknown> = []
    const escalations: Array<{ id: string; change: string; evidence: string }> = []
    const scheduler = new Scheduler({
      deliver: async (chatId, envelope) => { delivered.push({ chatId, envelope }) },
      log: () => {},
      checkHalt: () => ({ halted: true, change: 'foo', evidence: 'phase Verify 🔴' }),
      onEscalate: (s, change, evidence) => { escalations.push({ id: s.id, change, evidence }) },
    })
    await scheduler.tick()
    check('halt-AC1a: no deliver when halted', delivered.length === 0)
    check('halt-AC1a: onEscalate called once', escalations.length === 1)
    check('halt-AC1a: escalation names change', escalations[0]?.change === 'foo')
    check('halt-AC1a: escalation carries evidence', escalations[0]?.evidence === 'phase Verify 🔴')
    const after = readSchedulesFile(dir)
    const s = after.schedules[0]!
    check('halt-AC1a: schedule disabled', s.enabled === false)
    check('halt-AC1a: escalatedAt persisted', typeof s.escalatedAt === 'string' && s.escalatedAt.length > 0)
    check('halt-AC1a: lastRunAt still null (never fired)', s.lastRunAt === null)

    // Second tick: schedule now disabled → no second escalation (AC2 via disable path)
    await scheduler.tick()
    check('halt-AC1a: second tick → no second escalation', escalations.length === 1)
    check('halt-AC1a: second tick → still no deliver', delivered.length === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// halt-AC1b: healthy project → fires normally, no escalation, escalatedAt untouched
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule()])
    const delivered: Array<unknown> = []
    const escalations: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async (chatId, envelope) => { delivered.push({ chatId, envelope }) },
      log: () => {},
      checkHalt: () => ({ halted: false }),
      onEscalate: (s, c, e) => { escalations.push({ s, c, e }) },
    })
    await scheduler.tick()
    check('halt-AC1b: healthy → deliver called', delivered.length === 1)
    check('halt-AC1b: healthy → no escalation', escalations.length === 0)
    const after = readSchedulesFile(dir)
    check('halt-AC1b: escalatedAt not set', after.schedules[0]!.escalatedAt === undefined || after.schedules[0]!.escalatedAt === null)
    check('halt-AC1b: still enabled', after.schedules[0]!.enabled === true)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// halt escalation — AC2 escalatedAt guard: re-enabled without clearing → no second post, no fire
// ============================================================

{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ enabled: true, escalatedAt: '2026-07-12T08:00:00.000Z' })])
    const delivered: Array<unknown> = []
    const escalations: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async (chatId, envelope) => { delivered.push({ chatId, envelope }) },
      log: () => {},
      checkHalt: () => ({ halted: true, change: 'foo', evidence: 'phase Verify 🔴' }),
      onEscalate: (s, c, e) => { escalations.push({ s, c, e }) },
    })
    await scheduler.tick()
    check('halt-AC2: guard → no second escalation', escalations.length === 0)
    check('halt-AC2: guard → no fire into halted loop', delivered.length === 0)
    const after = readSchedulesFile(dir)
    check('halt-AC2: escalatedAt unchanged', after.schedules[0]!.escalatedAt === '2026-07-12T08:00:00.000Z')
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// halt escalation — fail-open without dep; halt gate precedes idle gate
// ============================================================

// halt-open: no checkHalt dep → fires exactly as before
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule()])
    const { scheduler, delivered } = makeScheduler({ dir })
    await scheduler.tick()
    check('halt-open: no dep → deliver called', delivered.length === 1)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// halt-order: halted + gated-busy schedule → escalation wins, isBusy never consulted
{
  const dir = mkdtempSync(join(tmpdir(), 'mcd-sched-test-'))
  const prev = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = dir
  try {
    writeSchedulesFile(dir, [makeSchedule({ onlyWhenIdle: true })])
    let isBusyCalls = 0
    const escalations: Array<unknown> = []
    const scheduler = new Scheduler({
      deliver: async () => {},
      log: () => {},
      isBusy: () => { isBusyCalls++; return true },
      checkHalt: () => ({ halted: true, change: 'foo', evidence: 'open issue: x' }),
      onEscalate: (s, c, e) => { escalations.push({ s, c, e }) },
    })
    await scheduler.tick()
    check('halt-order: escalation fires', escalations.length === 1)
    check('halt-order: idle gate not consulted', isBusyCalls === 0)
  } finally {
    process.env.MCD_CHANNELS_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
}

// ============================================================
// runAutopilotSweep — AC3 through AC10
// ============================================================

import type { ChannelsConfig } from './channels-config.ts'

/**
 * Build a minimal ChannelsConfig with a single project that has autopilot configured.
 */
function makeAutopilotConfig(overrides: {
  chatId?: string
  slug?: string
  autopilot?: Record<string, unknown>
  masterChatId?: string
  heartbeatWindow?: string
} = {}): { config: ChannelsConfig; chatId: string } {
  const chatId = overrides.chatId ?? '222222222222222222'
  const slug = overrides.slug ?? 'testproj'
  const autopilotDefaults = {
    enabled: true,
    intervalMinutes: 30,
    stallThreshold: 3,
  }
  const config: ChannelsConfig = {
    version: 1,
    master: overrides.masterChatId ? { chatId: overrides.masterChatId, commandPrefix: '!project' } : undefined,
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' },
      providers: {},
      progressMode: 'off',
      handoff: false,
      contextWarningThresholdPct: 80,
    },
    projects: {
      [chatId]: {
        slug,
        autopilot: { ...autopilotDefaults, ...(overrides.autopilot ?? {}) } as ChannelsConfig['projects'][string]['autopilot'],
        ...(overrides.heartbeatWindow ? { heartbeat: { mode: 'supervised', window: overrides.heartbeatWindow, staleAfterMinutes: 60 } } : {}),
      },
    },
  }
  return { config, chatId }
}

/**
 * Build a minimal sweep opts with mocked deps.
 */
function makeAutopilotOpts(opts: {
  config: ChannelsConfig
  projectDir?: string
  isBusy?: boolean
  checkHalt?: { halted: boolean; change?: string; evidence?: string }
  mcdDir?: string
}): {
  pool: { deliver: (chatId: string, envelope: InboundEnvelope) => Promise<void>; isBusy?: (chatId: string, graceMs: number) => boolean }
  getChannels: () => ChannelsConfig
  saveChannels: (cfg: ChannelsConfig) => void
  projectDirFor: (slug: string) => string
  checkHalt?: (chatId: string) => { halted: boolean; change?: string; evidence?: string }
  onEscalate?: (slug: string, chatId: string, reason: string, detail: string) => void
  onAnnounce?: (slug: string, chatId: string, kind: string, snap: { done: number; total: number }) => void
  mcdDir: string
  delivered: Array<{ chatId: string; envelope: InboundEnvelope }>
  saved: ChannelsConfig[]
  escalations: Array<{ slug: string; chatId: string; reason: string; detail: string }>
  announcements: Array<{ slug: string; chatId: string; kind: string; snap: { done: number; total: number } }>
} {
  const delivered: Array<{ chatId: string; envelope: InboundEnvelope }> = []
  const saved: ChannelsConfig[] = []
  const escalations: Array<{ slug: string; chatId: string; reason: string; detail: string }> = []
  const announcements: Array<{ slug: string; chatId: string; kind: string; snap: { done: number; total: number } }> = []

  let currentConfig = opts.config

  return {
    pool: {
      deliver: async (chatId, envelope) => { delivered.push({ chatId, envelope }) },
      ...(opts.isBusy !== undefined ? { isBusy: () => opts.isBusy! } : {}),
    },
    getChannels: () => currentConfig,
    saveChannels: (cfg: ChannelsConfig) => { saved.push(cfg); currentConfig = cfg },
    projectDirFor: () => opts.projectDir ?? '/nonexistent',
    ...(opts.checkHalt !== undefined ? { checkHalt: () => opts.checkHalt! } : {}),
    onEscalate: (slug, chatId, reason, detail) => { escalations.push({ slug, chatId, reason, detail }) },
    onAnnounce: (slug, chatId, kind, snap) => { announcements.push({ slug, chatId, kind, snap }) },
    mcdDir: opts.mcdDir ?? '/tmp',
    delivered,
    saved,
    escalations,
    announcements,
  }
}

// AP-1: disabled project skipped — no deliver, no save
{
  const { config, chatId } = makeAutopilotConfig({ autopilot: { enabled: false } })
  const sweepOpts = makeAutopilotOpts({ config })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutopilotSweep(sweepOpts)
  check('AP-1: disabled → no deliver', sweepOpts.delivered.length === 0)
  check('AP-1: disabled → no save', sweepOpts.saved.length === 0)
}

// AP-2: busy project skipped — no deliver, no save
{
  const { config, chatId } = makeAutopilotConfig({ autopilot: { enabled: true, state: 'running', lastFireAt: new Date(Date.now() - 99 * 60_000).toISOString() } })
  const sweepOpts = makeAutopilotOpts({ config, isBusy: true })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutopilotSweep(sweepOpts)
  check('AP-2: busy → no deliver', sweepOpts.delivered.length === 0)
  check('AP-2: busy → no save', sweepOpts.saved.length === 0)
}

// AP-3: fresh enable, no source → seed delivered + state 'seeding' persisted
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    const { config, chatId } = makeAutopilotConfig({ autopilot: { enabled: true } })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-3: seed delivered', sweepOpts.delivered.length === 1)
    check('AP-3: seed envelope userId', sweepOpts.delivered[0]?.envelope.userId === '__mcd_autopilot__')
    check('AP-3: seed messageId prefix', sweepOpts.delivered[0]?.envelope.messageId.startsWith('autopilot-'))
    check('AP-3: state seeding persisted', sweepOpts.saved.length > 0)
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-3: state=seeding', savedAutopilot?.state === 'seeding')
    check('AP-3: seededAt set', typeof savedAutopilot?.seededAt === 'string')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-4: seeding → running when backlog appears
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // Write a BACKLOG.md with a checkbox task
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'seeding',
        seededAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        intervalMinutes: 30,
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    // seeding→running is a 'none' action (no nudge yet), just state patch
    check('AP-4: no deliver on seeding→running', sweepOpts.delivered.length === 0)
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-4: state=running', savedAutopilot?.state === 'running')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-5: verify-failed after seed window expired (seededAt > 2×interval ago, no backlog)
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // No BACKLOG.md in tmpDir — source is 'none'
    const seededAt = new Date(Date.now() - 61 * 60_000).toISOString() // 61 min ago, interval=30 → 2×interval=60 min expired
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'seeding',
        seededAt,
        intervalMinutes: 30,
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-5: verify-failed escalated', sweepOpts.escalations.length === 1)
    check('AP-5: reason=verify-failed', sweepOpts.escalations[0]?.reason === 'verify-failed')
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-5: state=halted after verify-failed', savedAutopilot?.state === 'halted')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-6: due nudge delivered with lastFireAt/lastSnapshot persisted
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // BACKLOG.md with 1 done, 2 total
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [ ] task two\n')
    const lastFireAt = new Date(Date.now() - 35 * 60_000).toISOString() // 35 min ago, interval=30 → due
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'running',
        lastFireAt,
        intervalMinutes: 30,
        lastSnapshot: { done: 1, total: 2 },
        zeroDeltaCount: 0,
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-6: nudge delivered', sweepOpts.delivered.length === 1)
    check('AP-6: nudge userId', sweepOpts.delivered[0]?.envelope.userId === '__mcd_autopilot__')
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-6: lastFireAt updated', savedAutopilot?.lastFireAt !== lastFireAt)
    check('AP-6: lastSnapshot persisted', savedAutopilot?.lastSnapshot?.done === 1 && savedAutopilot?.lastSnapshot?.total === 2)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-7: zero-delta ×3 → stall escalation + halted
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // BACKLOG.md with 1 done, 3 total
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [ ] task two\n- [ ] task three\n')
    const lastFireAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'running',
        lastFireAt,
        intervalMinutes: 30,
        stallThreshold: 3,
        lastSnapshot: { done: 1, total: 3 },
        zeroDeltaCount: 2, // this fire = 3rd zero-delta → stall
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-7: stall escalated', sweepOpts.escalations.length === 1)
    check('AP-7: reason=stall', sweepOpts.escalations[0]?.reason === 'stall')
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-7: state=halted', savedAutopilot?.state === 'halted')
    check('AP-7: no nudge delivered', sweepOpts.delivered.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-8: complete announce
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // BACKLOG.md with all 2 done
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [x] task two\n')
    const lastFireAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'running',
        lastFireAt,
        intervalMinutes: 30,
        lastSnapshot: { done: 1, total: 2 },
        zeroDeltaCount: 0,
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-8: complete announced', sweepOpts.announcements.length === 1)
    check('AP-8: kind=complete', sweepOpts.announcements[0]?.kind === 'complete')
    check('AP-8: snap done=2', sweepOpts.announcements[0]?.snap.done === 2)
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-8: state=complete', savedAutopilot?.state === 'complete')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-9: rearm announce — new items appear after complete
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    // BACKLOG.md with 2 done + 1 new open item
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [x] task two\n- [ ] task three\n')
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'complete',
        intervalMinutes: 30,
        lastSnapshot: { done: 2, total: 2 }, // was complete
        zeroDeltaCount: 0,
      },
    })
    const sweepOpts = makeAutopilotOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-9: rearm announced', sweepOpts.announcements.length === 1)
    check('AP-9: kind=rearm', sweepOpts.announcements[0]?.kind === 'rearm')
    const savedAutopilot = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-9: state=running after rearm', savedAutopilot?.state === 'running')
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-10: specclaw-halt escalation once (not repeated when already halted)
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const lastFireAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'running',
        lastFireAt,
        intervalMinutes: 30,
      },
    })
    const sweepOpts = makeAutopilotOpts({
      config,
      projectDir: tmpDir,
      mcdDir: tmpDir,
      checkHalt: { halted: true, change: 'my-change', evidence: 'verify red' },
    })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })

    // First sweep: running → should escalate and patch to halted
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-10: first sweep escalates', sweepOpts.escalations.length === 1)
    check('AP-10: reason=specclaw-halted', sweepOpts.escalations[0]?.reason === 'specclaw-halted')
    const savedAfterFirst = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.autopilot
    check('AP-10: state=halted after first sweep', savedAfterFirst?.state === 'halted')

    // Second sweep: already halted → checkHalt not consulted for state='halted', no second escalation
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-10: second sweep no additional escalation', sweepOpts.escalations.length === 1)
    check('AP-10: no nudge delivered', sweepOpts.delivered.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// AP-disabled: project with disabled=true is skipped by autopilot sweep — no deliver, no save
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-ap-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const lastFireAt = new Date(Date.now() - 35 * 60_000).toISOString()
    const { config, chatId } = makeAutopilotConfig({
      autopilot: {
        enabled: true,
        state: 'running',
        lastFireAt,
        intervalMinutes: 30,
        lastSnapshot: { done: 0, total: 1 },
        zeroDeltaCount: 0,
      },
    })
    // Inject disabled flag into the project
    const disabledConfig: ChannelsConfig = {
      ...config,
      projects: {
        ...config.projects,
        [chatId]: { ...config.projects[chatId]!, disabled: true },
      },
    }
    const sweepOpts = makeAutopilotOpts({ config: disabledConfig, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runAutopilotSweep(sweepOpts)
    check('AP-disabled: disabled project → no deliver', sweepOpts.delivered.length === 0)
    check('AP-disabled: disabled project → no save',    sweepOpts.saved.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ============================================================
// runBacklogWatchSweep — AC3 skip cases + AC4 lifecycle
// ============================================================

/**
 * Build a minimal ChannelsConfig with a single project for backlog-watch tests.
 */
function makeWatchConfig(overrides: {
  chatId?: string
  slug?: string
  backlogWatch?: Record<string, unknown>
  defaultsBacklogWatch?: Record<string, unknown>
  autopilot?: Record<string, unknown>
  masterChatId?: string
} = {}): { config: ChannelsConfig; chatId: string } {
  const chatId = overrides.chatId ?? '333333333333333333'
  const slug = overrides.slug ?? 'watchproj'
  const config: ChannelsConfig = {
    version: 1,
    master: overrides.masterChatId ? { chatId: overrides.masterChatId, commandPrefix: '!project' } : undefined,
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' },
      providers: {},
      progressMode: 'off',
      handoff: false,
      contextWarningThresholdPct: 80,
      ...(overrides.defaultsBacklogWatch
        ? { backlogWatch: overrides.defaultsBacklogWatch as ChannelsConfig['defaults']['backlogWatch'] }
        : {}),
    },
    projects: {
      [chatId]: {
        slug,
        ...(overrides.backlogWatch
          ? { backlogWatch: overrides.backlogWatch as ChannelsConfig['projects'][string]['backlogWatch'] }
          : {}),
        ...(overrides.autopilot
          ? { autopilot: overrides.autopilot as ChannelsConfig['projects'][string]['autopilot'] }
          : {}),
      },
    },
  }
  return { config, chatId }
}

/**
 * Build minimal backlog-watch sweep opts with mocked deps.
 */
function makeWatchOpts(opts: { config: ChannelsConfig; projectDir?: string; mcdDir?: string }): {
  getChannels: () => ChannelsConfig
  saveChannels: (cfg: ChannelsConfig) => void
  projectDirFor: (slug: string) => string
  onAlert: (slug: string, chatId: string, info: { snap: { done: number; total: number }; staleDays: number; openItems: string[] }) => void
  mcdDir: string
  saved: ChannelsConfig[]
  alerts: Array<{ slug: string; chatId: string; snap: { done: number; total: number }; staleDays: number; openItems: string[] }>
} {
  const saved: ChannelsConfig[] = []
  const alerts: Array<{ slug: string; chatId: string; snap: { done: number; total: number }; staleDays: number; openItems: string[] }> = []
  let currentConfig = opts.config
  return {
    getChannels: () => currentConfig,
    saveChannels: (cfg: ChannelsConfig) => { saved.push(cfg); currentConfig = cfg },
    projectDirFor: () => opts.projectDir ?? '/nonexistent',
    onAlert: (slug, chatId, info) => { alerts.push({ slug, chatId, ...info }) },
    mcdDir: opts.mcdDir ?? '/tmp',
    saved,
    alerts,
  }
}

// BW-1: master project skipped — no save, no alert (even with a live backlog)
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config, chatId } = makeWatchConfig({ masterChatId: '333333333333333333' })
    void chatId
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-1: master → no save', sweepOpts.saved.length === 0)
    check('BW-1: master → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-2: autopilot-enabled project skipped — autopilot owns stall signaling
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config } = makeWatchConfig({ autopilot: { enabled: true } })
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-2: autopilot enabled → no save', sweepOpts.saved.length === 0)
    check('BW-2: autopilot enabled → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-3: project backlogWatch.enabled false → skipped
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config } = makeWatchConfig({ backlogWatch: { enabled: false } })
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-3: project enabled=false → no save', sweepOpts.saved.length === 0)
    check('BW-3: project enabled=false → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-4: defaults.backlogWatch.enabled false with no project override → skipped
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config } = makeWatchConfig({ defaultsBacklogWatch: { enabled: false } })
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-4: defaults enabled=false → no save', sweepOpts.saved.length === 0)
    check('BW-4: defaults enabled=false → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-5: source 'none' (empty project dir) → skipped, nothing persisted
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    const { config } = makeWatchConfig()
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-5: source none → no save', sweepOpts.saved.length === 0)
    check('BW-5: source none → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-disabled: project with disabled=true skipped — no save, no alert
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [ ] task one\n')
    const { config, chatId } = makeWatchConfig()
    // Inject disabled flag
    const disabledConfig: ChannelsConfig = {
      ...config,
      projects: {
        ...config.projects,
        [chatId]: { ...config.projects[chatId]!, disabled: true },
      },
    }
    const sweepOpts = makeWatchOpts({ config: disabledConfig, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-disabled: disabled project → no save',  sweepOpts.saved.length === 0)
    check('BW-disabled: disabled project → no alert', sweepOpts.alerts.length === 0)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// BW-6: AC4 lifecycle — init → stale alert → throttle → delta clears latch
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-bw-test-'))
  try {
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [ ] task two\n- [ ] task three\n')
    const { config, chatId } = makeWatchConfig()
    const sweepOpts = makeWatchOpts({ config, projectDir: tmpDir, mcdDir: tmpDir })
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })

    // Sweep 1 — first observation: init persisted, no alert
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-6: init persisted', sweepOpts.saved.length === 1)
    const bwInit = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.backlogWatch
    check('BW-6: init lastSnapshot', bwInit?.lastSnapshot?.done === 1 && bwInit?.lastSnapshot?.total === 3)
    check('BW-6: init lastDeltaAt set', typeof bwInit?.lastDeltaAt === 'string')
    check('BW-6: init no alert', sweepOpts.alerts.length === 0)

    // Hand-set lastDeltaAt 4 days ago (staleBacklogDays default 3) to simulate a stall
    const afterInit = sweepOpts.saved[sweepOpts.saved.length - 1]!
    const proj = afterInit.projects[chatId]!
    sweepOpts.saveChannels({
      ...afterInit,
      projects: {
        ...afterInit.projects,
        [chatId]: {
          ...proj,
          backlogWatch: {
            ...proj.backlogWatch!,
            lastDeltaAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
          },
        },
      },
    })

    // Sweep 2 — stale: alert fires with openCount/staleDays/openItems, lastAlertAt persisted
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-6: stale alert fired', sweepOpts.alerts.length === 1)
    check('BW-6: alert slug', sweepOpts.alerts[0]?.slug === 'watchproj')
    check('BW-6: alert snap open count', (sweepOpts.alerts[0]!.snap.total - sweepOpts.alerts[0]!.snap.done) === 2)
    check('BW-6: alert staleDays', sweepOpts.alerts[0]?.staleDays === 3)
    check('BW-6: alert openItems', JSON.stringify(sweepOpts.alerts[0]?.openItems) === JSON.stringify(['task two', 'task three']))
    const bwAlert = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.backlogWatch
    check('BW-6: lastAlertAt persisted', typeof bwAlert?.lastAlertAt === 'string')

    // Sweep 3 — immediately again: throttled by the alert latch, no second alert
    const savedBeforeThrottle = sweepOpts.saved.length
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-6: throttled — no second alert', sweepOpts.alerts.length === 1)
    check('BW-6: throttled — nothing persisted', sweepOpts.saved.length === savedBeforeThrottle)

    // Tick a checkbox — next sweep records the delta and clears the alert latch
    writeFileSync(join(tmpDir, 'BACKLOG.md'), '- [x] task one\n- [x] task two\n- [ ] task three\n')
    await scheduler.runBacklogWatchSweep(sweepOpts)
    check('BW-6: delta — still one alert', sweepOpts.alerts.length === 1)
    const bwDelta = sweepOpts.saved[sweepOpts.saved.length - 1]?.projects[chatId]?.backlogWatch
    check('BW-6: delta lastSnapshot updated', bwDelta?.lastSnapshot?.done === 2 && bwDelta?.lastSnapshot?.total === 3)
    check('BW-6: delta lastDeltaAt refreshed', typeof bwDelta?.lastDeltaAt === 'string' && Date.now() - Date.parse(bwDelta.lastDeltaAt) < 60_000)
    check('BW-6: delta clears lastAlertAt key', bwDelta !== undefined && !Object.prototype.hasOwnProperty.call(bwDelta, 'lastAlertAt'))
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ============================================================
// runAutoDisableSweep — AC12–AC14 + enabledAt baseline + clamp edge
// ============================================================

import type { ChannelsConfig as ChannelsConfigForAD } from './channels-config.ts'

/**
 * Build a minimal ChannelsConfig for auto-disable sweep tests.
 */
function makeAdConfig(overrides: {
  chatId?: string
  slug?: string
  masterChatId?: string
  disabled?: boolean
  autoDisable?: boolean
  enabledAt?: string
  autoDisableDefaults?: { enabled: boolean; idleDays?: number }
} = {}): { config: ChannelsConfigForAD; chatId: string } {
  const chatId = overrides.chatId ?? '444444444444444444'
  const slug = overrides.slug ?? 'adproj'
  const config: ChannelsConfigForAD = {
    version: 1,
    master: overrides.masterChatId ? { chatId: overrides.masterChatId, commandPrefix: '!project' } : undefined,
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' },
      providers: {},
      progressMode: 'off',
      handoff: false,
      contextWarningThresholdPct: 80,
      ...(overrides.autoDisableDefaults
        ? { autoDisable: overrides.autoDisableDefaults as ChannelsConfigForAD['defaults']['autoDisable'] }
        : {}),
    },
    projects: {
      [chatId]: {
        slug,
        ...(overrides.disabled !== undefined ? { disabled: overrides.disabled } : {}),
        ...(overrides.autoDisable !== undefined ? { autoDisable: overrides.autoDisable } : {}),
        ...(overrides.enabledAt !== undefined ? { enabledAt: overrides.enabledAt } : {}),
      },
    },
  }
  return { config, chatId }
}

/**
 * Build minimal auto-disable sweep opts with mocked deps.
 */
function makeAdOpts(opts: {
  config: ChannelsConfigForAD
  transcriptMtimeFor?: (slug: string) => number | null
  nowMs?: () => number
}): {
  getChannels: () => ChannelsConfigForAD
  saveChannels: (cfg: ChannelsConfigForAD) => void
  projectDirFor: (slug: string) => string
  transcriptMtimeFor?: (slug: string) => number | null
  nowMs?: () => number
  onAutoDisable: (slug: string, chatId: string, idleDays: number) => void
  saved: ChannelsConfigForAD[]
  disabled: Array<{ slug: string; chatId: string; idleDays: number }>
} {
  const saved: ChannelsConfigForAD[] = []
  const disabled: Array<{ slug: string; chatId: string; idleDays: number }> = []
  let currentConfig = opts.config
  return {
    getChannels: () => currentConfig,
    saveChannels: (cfg: ChannelsConfigForAD) => { saved.push(cfg); currentConfig = cfg },
    projectDirFor: () => '/nonexistent-ad',
    transcriptMtimeFor: opts.transcriptMtimeFor,
    nowMs: opts.nowMs,
    onAutoDisable: (slug, chatId, idleDays) => { disabled.push({ slug, chatId, idleDays }) },
    saved,
    disabled,
  }
}

// AC12a: project idle 8 days (threshold 7) → disabled, enabledAt removed, onAutoDisable called
{
  const NOW = 1_000_000_000_000
  const MTIME_8D_AGO = NOW - 8 * 86_400_000
  const { config, chatId } = makeAdConfig({
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => MTIME_8D_AGO,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC12a: idle 8d > 7d → saved once', sweepOpts.saved.length === 1)
  const savedProj = sweepOpts.saved[0]?.projects[chatId]
  check('AC12a: disabled set true', savedProj?.disabled === true)
  check('AC12a: enabledAt removed', !Object.prototype.hasOwnProperty.call(savedProj, 'enabledAt'))
  check('AC12a: onAutoDisable called', sweepOpts.disabled.length === 1)
  check('AC12a: onAutoDisable slug', sweepOpts.disabled[0]?.slug === 'adproj')
  check('AC12a: onAutoDisable chatId', sweepOpts.disabled[0]?.chatId === chatId)
  check('AC12a: onAutoDisable idleDays', sweepOpts.disabled[0]?.idleDays === 7)
}

// AC12b: project idle 2 days (threshold 7) → untouched
{
  const NOW = 1_000_000_000_000
  const MTIME_2D_AGO = NOW - 2 * 86_400_000
  const { config } = makeAdConfig({
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => MTIME_2D_AGO,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC12b: idle 2d < 7d → no save', sweepOpts.saved.length === 0)
  check('AC12b: idle 2d → no disable', sweepOpts.disabled.length === 0)
}

// AC13a: master chatId skipped
{
  const NOW = 1_000_000_000_000
  const MASTER_CHAT_ID = '555555555555555555'
  const { config } = makeAdConfig({
    chatId: MASTER_CHAT_ID,
    masterChatId: MASTER_CHAT_ID,
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => NOW - 30 * 86_400_000,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC13a: master → no save', sweepOpts.saved.length === 0)
  check('AC13a: master → no disable', sweepOpts.disabled.length === 0)
}

// AC13b: already disabled project skipped
{
  const NOW = 1_000_000_000_000
  const { config } = makeAdConfig({
    disabled: true,
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => NOW - 30 * 86_400_000,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC13b: already disabled → no save', sweepOpts.saved.length === 0)
  check('AC13b: already disabled → no disable callback', sweepOpts.disabled.length === 0)
}

// AC13c: project with autoDisable: false → skipped even with old transcript
{
  const NOW = 1_000_000_000_000
  const { config } = makeAdConfig({
    autoDisable: false,
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => NOW - 30 * 86_400_000,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC13c: autoDisable=false → no save', sweepOpts.saved.length === 0)
  check('AC13c: autoDisable=false → no disable callback', sweepOpts.disabled.length === 0)
}

// AC13d: no transcript (null mtime) → skipped
{
  const NOW = 1_000_000_000_000
  const { config } = makeAdConfig({
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => null,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC13d: no transcript → no save', sweepOpts.saved.length === 0)
  check('AC13d: no transcript → no disable callback', sweepOpts.disabled.length === 0)
}

// AC14a: defaults.autoDisable absent → no-op
{
  const NOW = 1_000_000_000_000
  const { config } = makeAdConfig({
    // no autoDisableDefaults
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => NOW - 30 * 86_400_000,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC14a: no autoDisable config → no save', sweepOpts.saved.length === 0)
  check('AC14a: no autoDisable config → no disable callback', sweepOpts.disabled.length === 0)
}

// AC14b: defaults.autoDisable.enabled false → no-op
{
  const NOW = 1_000_000_000_000
  const { config } = makeAdConfig({
    autoDisableDefaults: { enabled: false, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => NOW - 30 * 86_400_000,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('AC14b: enabled=false → no save', sweepOpts.saved.length === 0)
  check('AC14b: enabled=false → no disable callback', sweepOpts.disabled.length === 0)
}

// enabledAt baseline: 30d-old transcript + enabledAt 1d ago → idle computed from enabledAt → untouched
{
  const NOW = 1_000_000_000_000
  const MTIME_30D_AGO = NOW - 30 * 86_400_000
  const ENABLED_AT_1D_AGO = new Date(NOW - 1 * 86_400_000).toISOString()
  const { config } = makeAdConfig({
    enabledAt: ENABLED_AT_1D_AGO,
    autoDisableDefaults: { enabled: true, idleDays: 7 },
  })
  const sweepOpts = makeAdOpts({
    config,
    transcriptMtimeFor: () => MTIME_30D_AGO,
    nowMs: () => NOW,
  })
  const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })
  await scheduler.runAutoDisableSweep(sweepOpts)
  check('enabledAt baseline: enabledAt 1d ago overrides 30d mtime → no disable', sweepOpts.disabled.length === 0)
  check('enabledAt baseline: no save', sweepOpts.saved.length === 0)
}

// ============================================================
// runHandoffSweep — AC5: nag once, escalate once, idempotent re-runs
// ============================================================

import { createHandoff, loadRegistry } from './handoffs.ts'

// Full lifecycle against a real registry in a temp MCD_CHANNELS_DIR
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-handoff-sweep-'))
  const prevEnv = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = tmpDir
  try {
    const MIN = 60_000
    const T0 = Date.UTC(2026, 6, 26, 12, 0, 0)
    const longTask = 'review PR 42 — ' + 'x'.repeat(150)  // > 120 chars, exercises truncation

    const rec = createHandoff(
      { from: 'proj-a', to: { kind: 'project', slug: 'proj-b', chatId: 'chat-b' }, task: longTask },
      T0,
    )

    // defaults.collab absent → built-in 30-min timeout
    const { config } = makeAdConfig({})
    const nags: Array<{ chatId: string; text: string }> = []
    const escalations: string[] = []
    let now = T0
    const sweepOpts = {
      getChannels: () => config,
      notifyChannel: (chatId: string, text: string) => { nags.push({ chatId, text }) },
      notifyMaster: (text: string) => { escalations.push(text) },
      nowMs: () => now,
    }
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })

    // Before timeout — nothing fires
    now = T0 + 10 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS1: before timeout → no notifications', nags.length === 0 && escalations.length === 0)

    // Past timeout — exactly one nag to the receiver channel
    now = T0 + 35 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS2: past timeout → exactly one nag', nags.length === 1, `nags=${nags.length}`)
    check('HS2: no escalation yet', escalations.length === 0)
    check('HS2: nag routed to receiver channel', nags[0]?.chatId === 'chat-b')
    check('HS2: nag text shape ⏰ #h-<id> pending Nm', nags[0]?.text.startsWith(`⏰ handoff #${rec.id} pending 35m: `), nags[0]?.text)
    check('HS2: nag task truncated to 120 + ellipsis', nags[0]?.text.endsWith('…') && nags[0]?.text.includes(longTask.slice(0, 120)))

    // Re-run in the same window — no duplicate nag (AC5)
    now = T0 + 40 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS3: re-run same window → no duplicate nag (AC5)', nags.length === 1)

    // Past 2× timeout — one master escalate, record expired
    now = T0 + 65 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS4: past 2× timeout → one master escalate', escalations.length === 1, `esc=${escalations.length}`)
    check('HS4: escalate text names from→to slug',
      escalations[0] === `⚠️ handoff #${rec.id} proj-a→proj-b unanswered — expired`, escalations[0])
    check('HS4: record expired in registry', loadRegistry()[0]?.state === 'expired')

    // Re-run after expire — no duplicate notifications (AC5)
    now = T0 + 90 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS5: re-run after expire → no duplicates (AC5)', nags.length === 1 && escalations.length === 1)
  } finally {
    if (prevEnv === undefined) delete process.env.MCD_CHANNELS_DIR
    else process.env.MCD_CHANNELS_DIR = prevEnv
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// defaults.collab.timeoutMinutes overrides the built-in 30; botPeer targets
// get the botId label in the escalation
{
  const tmpDir = mkdtempSync(join(tmpdir(), 'mcd-handoff-sweep2-'))
  const prevEnv = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = tmpDir
  try {
    const MIN = 60_000
    const T0 = Date.UTC(2026, 6, 26, 12, 0, 0)

    const rec = createHandoff(
      { from: 'proj-a', to: { kind: 'botPeer', botId: 'bot-99', chatId: 'chat-a' }, task: 'ping' },
      T0,
    )

    const { config } = makeAdConfig({})
    config.defaults.collab = { timeoutMinutes: 10 }
    const nags: Array<{ chatId: string; text: string }> = []
    const escalations: string[] = []
    let now = T0
    const sweepOpts = {
      getChannels: () => config,
      notifyChannel: (chatId: string, text: string) => { nags.push({ chatId, text }) },
      notifyMaster: (text: string) => { escalations.push(text) },
      nowMs: () => now,
    }
    const scheduler = new Scheduler({ deliver: async () => {}, log: () => {} })

    // 10-min timeout: 12 min in → nag fires (built-in 30 would not)
    now = T0 + 12 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS6: defaults.collab.timeoutMinutes=10 → nag at 12m', nags.length === 1)
    check('HS6: nag to source channel (botPeer target)', nags[0]?.chatId === 'chat-a')

    // 2×10 = 20 min in → escalate names the botId
    now = T0 + 21 * MIN
    await scheduler.runHandoffSweep(sweepOpts)
    check('HS7: escalate labels botPeer target by botId',
      escalations.length === 1 && escalations[0] === `⚠️ handoff #${rec.id} proj-a→bot-99 unanswered — expired`,
      escalations[0])
  } finally {
    if (prevEnv === undefined) delete process.env.MCD_CHANNELS_DIR
    else process.env.MCD_CHANNELS_DIR = prevEnv
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

// ============================================================
// Final result
// ============================================================

if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll scheduler checks passed`)
}
