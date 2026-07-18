/**
 * bun src/backlog.test.ts
 * Unit tests for src/backlog.ts (AC5, AC9 groundwork).
 * Run: bun src/backlog.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  detectBacklogSource,
  snapshotBacklog,
  buildSeedPrompt,
  buildNudgePrompt,
  withinWindow,
  nextAutopilotAction,
} from './backlog.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// Helper: create a temp project dir
function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'mcd-backlog-test-'))
}

// ---------------------------------------------------------------------------
// detectBacklogSource — detection precedence
// ---------------------------------------------------------------------------

{
  const dir = tmpProject()

  // 1: Neither file nor specclaw → none
  check('detect-1: empty dir → none', detectBacklogSource(dir) === 'none')

  // 2: BACKLOG.md exists but empty → none (no task lines)
  writeFileSync(join(dir, 'BACKLOG.md'), 'No tasks here.\n')
  check('detect-2: BACKLOG.md without checkbox tasks → none', detectBacklogSource(dir) === 'none')

  // 3: BACKLOG.md with checkbox task → file
  writeFileSync(join(dir, 'BACKLOG.md'), '- [ ] do thing\n')
  check('detect-3: BACKLOG.md with checkbox → file', detectBacklogSource(dir) === 'file')

  // 4: Specclaw wins over BACKLOG.md
  mkdirSync(join(dir, '.specclaw'), { recursive: true })
  writeFileSync(join(dir, '.specclaw', 'STATUS.md'), '# Status\n')
  check('detect-4: specclaw/STATUS.md present → specclaw (wins)', detectBacklogSource(dir) === 'specclaw')

  // 5: Custom file
  const dir2 = tmpProject()
  writeFileSync(join(dir2, 'TODO.md'), '- [x] done item\n')
  check('detect-5: custom --backlog-file TODO.md → file', detectBacklogSource(dir2, 'TODO.md') === 'file')

  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// snapshotBacklog — file flavor
// ---------------------------------------------------------------------------

{
  const dir = tmpProject()

  // 6: Standard - [ ] / - [x]
  writeFileSync(join(dir, 'BACKLOG.md'), [
    '- [ ] open 1',
    '- [x] done 1',
    '- [ ] open 2',
    '- [x] done 2',
    '- [x] done 3',
    'Not a task line',
  ].join('\n'))
  const snap = snapshotBacklog(dir, 'file')
  check('snap-file-6: total = 5', snap.total === 5)
  check('snap-file-7: done = 3', snap.done === 3)

  // 8: * [ ] / * [x] variants
  writeFileSync(join(dir, 'BACKLOG.md'), [
    '* [ ] star-open',
    '* [x] star-done',
  ].join('\n'))
  const snap2 = snapshotBacklog(dir, 'file')
  check('snap-file-8: * [ ] / * [x] counted', snap2.total === 2 && snap2.done === 1)

  // 9: Indented checkbox lines
  writeFileSync(join(dir, 'BACKLOG.md'), [
    '  - [ ] indented open',
    '  - [x] indented done',
  ].join('\n'))
  const snap3 = snapshotBacklog(dir, 'file')
  check('snap-file-9: indented lines counted', snap3.total === 2 && snap3.done === 1)

  // 10: Empty file → {0,0}
  writeFileSync(join(dir, 'BACKLOG.md'), '')
  const snap4 = snapshotBacklog(dir, 'file')
  check('snap-file-10: empty file → {0,0}', snap4.done === 0 && snap4.total === 0)

  // 11: source=none → {0,0} (no fs read)
  const snap5 = snapshotBacklog(dir, 'none')
  check('snap-file-11: source=none → {0,0}', snap5.done === 0 && snap5.total === 0)

  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// snapshotBacklog — specclaw flavor
// ---------------------------------------------------------------------------

{
  const dir = tmpProject()
  const changesDir = join(dir, '.specclaw', 'changes')
  mkdirSync(changesDir, { recursive: true })
  // Archive dir should be skipped
  mkdirSync(join(changesDir, 'archive'), { recursive: true })
  writeFileSync(join(changesDir, 'archive', 'tasks.md'), '- [ ] archive task\n')

  // Change A: tasks.md with 3 done, 2 open
  mkdirSync(join(changesDir, 'change-a'))
  writeFileSync(join(changesDir, 'change-a', 'tasks.md'), [
    '- [x] done 1',
    '- [x] done 2',
    '- [x] done 3',
    '- [ ] open 1',
    '- [ ] open 2',
  ].join('\n'))

  // Change B: only proposal.md → pending proposal (1 open item)
  mkdirSync(join(changesDir, 'change-b'))
  writeFileSync(join(changesDir, 'change-b', 'proposal.md'), '# Proposal B\n')

  // Change C: tasks.md with 2 done, 0 open (all done)
  mkdirSync(join(changesDir, 'change-c'))
  writeFileSync(join(changesDir, 'change-c', 'tasks.md'), [
    '- [x] t1',
    '- [x] t2',
  ].join('\n'))

  const snap = snapshotBacklog(dir, 'specclaw')
  // Expected: change-a (3 done, 5 total) + change-b (0 done, 1 total) + change-c (2 done, 2 total)
  //           archive skipped
  check('snap-specclaw-12: total = 8', snap.total === 8, `got ${snap.total}`)
  check('snap-specclaw-13: done = 5', snap.done === 5, `got ${snap.done}`)

  // 14: Missing changes dir → {0,0}
  const dir2 = tmpProject()
  const snap2 = snapshotBacklog(dir2, 'specclaw')
  check('snap-specclaw-14: missing changes dir → {0,0}', snap2.done === 0 && snap2.total === 0)

  rmSync(dir, { recursive: true, force: true })
  rmSync(dir2, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// buildSeedPrompt
// ---------------------------------------------------------------------------

{
  const p = buildSeedPrompt('my-project', 'build a REST API')
  check('seed-prompt-15: goal verbatim', p.includes('build a REST API'))
  check('seed-prompt-16: checkbox format instruction', p.includes('- [ ] item'))
  check('seed-prompt-17: mcp__mcd__reply instruction', p.includes('mcp__mcd__reply'))

  const p2 = buildSeedPrompt('my-project')
  check('seed-prompt-18: no goal → CLAUDE.md instruction', p2.includes('CLAUDE.md'))
}

// ---------------------------------------------------------------------------
// buildNudgePrompt
// ---------------------------------------------------------------------------

{
  const p = buildNudgePrompt('file', { done: 2, total: 5 })
  check('nudge-19: file flavor mentions BACKLOG.md', p.includes('BACKLOG.md'))
  check('nudge-20: reply-required footer present', p.includes('mcp__mcd__reply'))
  check('nudge-21: progress shown', p.includes('2/5'))

  const p2 = buildNudgePrompt('specclaw', { done: 3, total: 7 })
  check('nudge-22: specclaw flavor mentions specclaw lifecycle', p2.includes('specclaw'))
  check('nudge-23: specclaw progress shown', p2.includes('3/7'))
  check('nudge-24: reply-required footer present', p2.includes('mcp__mcd__reply'))
}

// ---------------------------------------------------------------------------
// withinWindow — AC9 groundwork
// ---------------------------------------------------------------------------

{
  // Normal range 09:00-17:00
  const inside = new Date('2026-01-01T10:00:00')  // 10:00 local — but Date uses UTC...
  // Use a fixed approach: build date with local time parts
  function localDate(h: number, m: number): Date {
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d
  }

  check('window-25: inside normal range (10:00 in 09:00-17:00)', withinWindow('09:00-17:00', localDate(10, 0)))
  check('window-26: outside normal range (08:59 in 09:00-17:00)', !withinWindow('09:00-17:00', localDate(8, 59)))
  check('window-27: outside normal range (17:00 exclusive end)', !withinWindow('09:00-17:00', localDate(17, 0)))
  check('window-28: at start is inclusive (09:00)', withinWindow('09:00-17:00', localDate(9, 0)))

  // Wrap-around midnight: 22:00-06:00
  check('window-29: wrap-around — 23:00 inside 22:00-06:00', withinWindow('22:00-06:00', localDate(23, 0)))
  check('window-30: wrap-around — 03:00 inside 22:00-06:00', withinWindow('22:00-06:00', localDate(3, 0)))
  check('window-31: wrap-around — 06:00 outside (exclusive end)', !withinWindow('22:00-06:00', localDate(6, 0)))
  check('window-32: wrap-around — 12:00 outside', !withinWindow('22:00-06:00', localDate(12, 0)))
  check('window-33: wrap-around — 22:00 inside (inclusive start)', withinWindow('22:00-06:00', localDate(22, 0)))
}

// ---------------------------------------------------------------------------
// nextAutopilotAction — transition table
// ---------------------------------------------------------------------------

const NOW = '2026-07-18T12:00:00.000Z'
const LATER_31 = '2026-07-18T12:31:00.000Z'  // 31 min after NOW (> 30 min default interval)

function baseAutopilot(overrides: Partial<import('./channels-config.ts').AutopilotConfig> = {}): import('./channels-config.ts').AutopilotConfig {
  return { enabled: true, ...overrides }
}

// 34: disabled → none
{
  const { action, patch } = nextAutopilotAction({
    autopilot: { enabled: false },
    source: 'none',
    snap: { done: 0, total: 0 },
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-34: disabled → none', action.kind === 'none')
  check('fsm-34b: disabled → empty patch', Object.keys(patch).length === 0)
}

// 35: fresh enable, source=none → seed
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({ seedGoal: 'build API' }),
    source: 'none',
    snap: { done: 0, total: 0 },
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-35: fresh enable, source=none → seed', action.kind === 'seed')
  if (action.kind === 'seed') {
    check('fsm-35b: seed prompt includes goal', action.prompt.includes('build API'))
  }
  check('fsm-35c: patch state=seeding', patch.state === 'seeding')
  check('fsm-35d: patch zeroDeltaCount=0', patch.zeroDeltaCount === 0)
}

// 36: fresh enable, source=file (backlog already exists) → none + patch running
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot(),
    source: 'file',
    snap: { done: 1, total: 5 },
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-36: fresh enable, source=file → none (first nudge next tick)', action.kind === 'none')
  check('fsm-36b: patch state=running', patch.state === 'running')
}

// 37: seeding → running when backlog appears
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({ state: 'seeding', seededAt: NOW }),
    source: 'file',
    snap: { done: 0, total: 3 },
    slug: 'test',
    nowIso: LATER_31,
  })
  check('fsm-37: seeding + backlog found → none + running', action.kind === 'none')
  check('fsm-37b: patch state=running', patch.state === 'running')
}

// 38: seeding verify-failed after 2 × interval
{
  // Seeded at NOW, now is 61 min later (> 2 × 30 min), still no backlog
  const later61 = '2026-07-18T13:01:00.000Z'
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({ state: 'seeding', seededAt: NOW }),
    source: 'none',
    snap: { done: 0, total: 0 },
    slug: 'test',
    nowIso: later61,
  })
  check('fsm-38: seeding still empty after 2× interval → verify-failed', action.kind === 'verify-failed')
  check('fsm-38b: patch state=halted', patch.state === 'halted')
}

// 39: seeding, not expired yet → none
{
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({ state: 'seeding', seededAt: NOW }),
    source: 'none',
    snap: { done: 0, total: 0 },
    slug: 'test',
    nowIso: LATER_31,  // only 31 min, < 60 min required for 2 × 30 min
  })
  check('fsm-39: seeding not expired → none', action.kind === 'none')
}

// 40: interval gating — interval not elapsed → none
{
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: NOW,
      zeroDeltaCount: 0,
      lastSnapshot: { done: 1, total: 5 },
    }),
    source: 'file',
    snap: { done: 1, total: 5 },
    slug: 'test',
    nowIso: '2026-07-18T12:15:00.000Z',  // only 15 min later, < 30 min
  })
  check('fsm-40: interval not elapsed → none', action.kind === 'none')
}

// 41: window gating — outside window → none
{
  // Use window 09:00-10:00 but now is 14:00 UTC (which will be 14:00 local for simplicity)
  // We test with withinWindow directly using local time — here we test the integration
  // by using a window that's clearly not active: we pass a window and force withinWindow to fail
  // by setting now to a time definitely outside it.
  // For determinism, use a 1-minute window and a time clearly outside it.
  const nowOutside = new Date()
  nowOutside.setHours(13, 0, 0, 0)  // 13:00 local
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: new Date(nowOutside.getTime() - 35 * 60 * 1000).toISOString(),
      zeroDeltaCount: 0,
      lastSnapshot: { done: 0, total: 5 },
    }),
    source: 'file',
    snap: { done: 0, total: 5 },
    slug: 'test',
    nowIso: nowOutside.toISOString(),
    heartbeatWindow: '09:00-10:00',  // window long past
  })
  check('fsm-41: outside heartbeat window → none', action.kind === 'none')
}

// 42: window gating disabled — respectHeartbeatWindow=false → nudge
{
  const nowAny = new Date()
  nowAny.setHours(13, 0, 0, 0)
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: new Date(nowAny.getTime() - 35 * 60 * 1000).toISOString(),
      zeroDeltaCount: 0,
      lastSnapshot: { done: 0, total: 5 },
      respectHeartbeatWindow: false,
    }),
    source: 'file',
    snap: { done: 0, total: 5 },
    slug: 'test',
    nowIso: nowAny.toISOString(),
    heartbeatWindow: '09:00-10:00',
  })
  check('fsm-42: respectHeartbeatWindow=false → nudge fires even outside window', action.kind === 'nudge')
}

// 43–45: zero-delta stall at threshold=3
{
  // Fire 1: zero delta — count becomes 1, no stall
  const { action: a1, patch: p1 } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: '2026-07-18T10:00:00Z',
      zeroDeltaCount: 0,
      lastSnapshot: { done: 1, total: 5 },
    }),
    source: 'file',
    snap: { done: 1, total: 5 },  // no progress
    slug: 'test',
    nowIso: '2026-07-18T10:31:00Z',
  })
  check('fsm-43: zero-delta fire 1 → nudge (count=1)', a1.kind === 'nudge')
  check('fsm-43b: zeroDeltaCount=1', p1.zeroDeltaCount === 1)

  // Fire 2: zero delta — count becomes 2, no stall
  const { action: a2, patch: p2 } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: '2026-07-18T10:31:00Z',
      zeroDeltaCount: 1,
      lastSnapshot: { done: 1, total: 5 },
    }),
    source: 'file',
    snap: { done: 1, total: 5 },
    slug: 'test',
    nowIso: '2026-07-18T11:02:00Z',
  })
  check('fsm-44: zero-delta fire 2 → nudge (count=2)', a2.kind === 'nudge')
  check('fsm-44b: zeroDeltaCount=2', p2.zeroDeltaCount === 2)

  // Fire 3: zero delta — count hits threshold=3 → stall
  const { action: a3, patch: p3 } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: '2026-07-18T11:02:00Z',
      zeroDeltaCount: 2,
      lastSnapshot: { done: 1, total: 5 },
    }),
    source: 'file',
    snap: { done: 1, total: 5 },
    slug: 'test',
    nowIso: '2026-07-18T11:33:00Z',
  })
  check('fsm-45: zero-delta fire 3 → stall', a3.kind === 'stall')
  check('fsm-45b: patch state=halted', p3.state === 'halted')
  check('fsm-45c: zeroDeltaCount=3', p3.zeroDeltaCount === 3)
}

// 46: progress resets zero-delta counter
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: '2026-07-18T10:00:00Z',
      zeroDeltaCount: 2,
      lastSnapshot: { done: 1, total: 5 },
    }),
    source: 'file',
    snap: { done: 2, total: 5 },  // one item done since last fire
    slug: 'test',
    nowIso: '2026-07-18T10:31:00Z',
  })
  check('fsm-46: progress resets counter → nudge', action.kind === 'nudge')
  check('fsm-46b: zeroDeltaCount reset to 0', patch.zeroDeltaCount === 0)
}

// 47: complete — all done
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'running',
      lastFireAt: '2026-07-18T10:00:00Z',
      zeroDeltaCount: 0,
      lastSnapshot: { done: 4, total: 5 },
    }),
    source: 'file',
    snap: { done: 5, total: 5 },
    slug: 'test',
    nowIso: '2026-07-18T10:31:00Z',
  })
  check('fsm-47: done===total → complete', action.kind === 'complete')
  check('fsm-47b: patch state=complete', patch.state === 'complete')
}

// 48: rearm — new items appear after complete
{
  const { action, patch } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'complete',
      lastSnapshot: { done: 5, total: 5 },
    }),
    source: 'file',
    snap: { done: 5, total: 7 },  // 2 new open items
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-48: new items after complete → rearm', action.kind === 'rearm')
  check('fsm-48b: patch state=running', patch.state === 'running')
}

// 49: halted → none (inert)
{
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({ state: 'halted' }),
    source: 'file',
    snap: { done: 1, total: 5 },
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-49: halted → none always', action.kind === 'none')
}

// 50: complete, no new items → none
{
  const { action } = nextAutopilotAction({
    autopilot: baseAutopilot({
      state: 'complete',
      lastSnapshot: { done: 5, total: 5 },
    }),
    source: 'file',
    snap: { done: 5, total: 5 },
    slug: 'test',
    nowIso: NOW,
  })
  check('fsm-50: complete + no new items → none', action.kind === 'none')
}

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`)
  process.exit(1)
} else {
  console.log(`\nAll ${50} checks passed.`)
}
