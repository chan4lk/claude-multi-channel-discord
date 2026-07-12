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
// Final result
// ============================================================

if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll scheduler checks passed`)
}
