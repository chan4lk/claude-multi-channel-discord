/**
 * bun src/specclaw-progress.test.ts
 *
 * Tests for progressMode "phases" — snapshot parsing (verify verdict) and
 * transition classification from fixture sequences (AC1/AC2/AC5).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  classifySpecclawTransitions,
  takeSpecclawProgressSnapshot,
  type SpecclawProgressSnapshot,
} from './specclaw-progress.ts'
import { ChannelsConfigSchema } from './channels-config.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ── fixture helpers ──────────────────────────────────────────────────────────

function writeFixture(dir: string, opts: {
  activeLine?: string
  changeName?: string
  phaseRows?: Record<string, string>
}): void {
  mkdirSync(join(dir, '.specclaw'), { recursive: true })
  const active = opts.activeLine ? `${opts.activeLine}\n` : '_None_\n'
  writeFileSync(join(dir, '.specclaw', 'STATUS.md'), `# 🦞 SpecClaw Dashboard

## Active Changes

${active}
## Pending Proposals

_None_
`)
  if (opts.changeName && opts.phaseRows) {
    const changeDir = join(dir, '.specclaw', 'changes', opts.changeName)
    mkdirSync(changeDir, { recursive: true })
    const rows = Object.entries(opts.phaseRows).map(([p, s]) => `| ${p} | ${s} | — |`).join('\n')
    writeFileSync(join(changeDir, 'status.md'), `# Status

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
${rows}
`)
  }
}

function snap(o: Partial<SpecclawProgressSnapshot>): SpecclawProgressSnapshot {
  return { present: true, ...o }
}

// ── AC1: schema accepts progressMode "phases" ────────────────────────────────

{
  const SNOWFLAKE_MASTER = '100000000000000001'
  const SNOWFLAKE_PROJECT = '100000000000000002'
  const parsed = ChannelsConfigSchema.safeParse({
    master: { chatId: SNOWFLAKE_MASTER },
    projects: { [SNOWFLAKE_PROJECT]: { slug: 'x', progressMode: 'phases' } },
  })
  check('AC1: project progressMode "phases" accepted', parsed.success, parsed.success ? '' : parsed.error.toString())
  const bad = ChannelsConfigSchema.safeParse({
    master: { chatId: SNOWFLAKE_MASTER },
    projects: { [SNOWFLAKE_PROJECT]: { slug: 'x', progressMode: 'bogus' } },
  })
  check('AC1: unknown mode still rejected', !bad.success)
}

// ── snapshot: verify verdict parsing ─────────────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'sc-progress-'))
  try {
    writeFixture(dir, {
      activeLine: '- 🔨 **my-change** — 3/8 tasks (38%)',
      changeName: 'my-change',
      phaseRows: { Spec: '✅ Done', Build: '✅ Done', Verify: '🟢 Pass' },
    })
    const s = takeSpecclawProgressSnapshot(dir)
    check('snapshot: active change + counts', s.activeChange === 'my-change' && s.tasksDone === 3 && s.tasksTotal === 8)
    check('snapshot: verify 🟢 → pass', s.verify === 'pass')

    writeFixture(dir, {
      activeLine: '- 🔨 **my-change** — 3/8 tasks (38%)',
      changeName: 'my-change',
      phaseRows: { Build: '✅ Done', Verify: '🔴 Fail' },
    })
    check('snapshot: verify 🔴 → fail', takeSpecclawProgressSnapshot(dir).verify === 'fail')

    writeFixture(dir, {
      activeLine: '- 🔨 **my-change** — 3/8 tasks (38%)',
      changeName: 'my-change',
      phaseRows: { Build: '🔨 In Progress', Verify: '⬜ Pending' },
    })
    check('snapshot: pending verify → undefined', takeSpecclawProgressSnapshot(dir).verify === undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── snapshot: no .specclaw → present false ───────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'sc-progress-'))
  try {
    const s = takeSpecclawProgressSnapshot(dir)
    check('snapshot: no .specclaw → present false', s.present === false)
    check('no .specclaw: baseline diff → no transitions', classifySpecclawTransitions(s, takeSpecclawProgressSnapshot(dir)).length === 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── AC2: each transition kind → exactly one line ─────────────────────────────

{
  // change started
  const t1 = classifySpecclawTransitions(snap({}), snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 0, tasksTotal: 8 }))
  check('AC2: new change → one line', t1.length === 1 && t1[0] === '🔨 feat-x started', JSON.stringify(t1))

  // phase entered (build, with task total)
  const t2 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'spec' }),
    snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 0, tasksTotal: 8 }),
  )
  check('AC2: phase → build one line with task count', t2.length === 1 && t2[0] === 'build started (8 tasks)', JSON.stringify(t2))

  // task count change
  const t3 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 2, tasksTotal: 8 }),
    snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 3, tasksTotal: 8 }),
  )
  check('AC2: task count → one line', t3.length === 1 && t3[0] === 'tasks 3/8 ✅', JSON.stringify(t3))

  // verify verdict
  const t4 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'verify', tasksDone: 8, tasksTotal: 8 }),
    snap({ activeChange: 'feat-x', phase: 'verify', tasksDone: 8, tasksTotal: 8, verify: 'pass' }),
  )
  check('AC2: verify pass → one line', t4.length === 1 && t4[0] === 'verify 🟢', JSON.stringify(t4))

  const t5 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'verify' }),
    snap({ activeChange: 'feat-x', phase: 'verify', verify: 'fail' }),
  )
  check('AC2: verify fail → one line', t5.length === 1 && t5[0] === 'verify 🔴', JSON.stringify(t5))

  // no diff → no lines
  const same = snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 3, tasksTotal: 8 })
  check('AC2: no diff → no lines', classifySpecclawTransitions(same, same).length === 0)

  // multiple same-tick transitions each get their own line, ordered
  const t6 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'build', tasksDone: 7, tasksTotal: 8 }),
    snap({ activeChange: 'feat-x', phase: 'verify', tasksDone: 8, tasksTotal: 8, verify: 'pass' }),
  )
  check('AC2: multi-transition tick → one line each', t6.length === 3 && t6[0] === 'verify started' && t6[1] === 'tasks 8/8 ✅' && t6[2] === 'verify 🟢', JSON.stringify(t6))

  // change switch suppresses stale counter diffs
  const t7 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'verify', tasksDone: 8, tasksTotal: 8, verify: 'pass' }),
    snap({ activeChange: 'feat-y', phase: 'plan', tasksDone: 0, tasksTotal: 4 }),
  )
  check('AC2: change switch → single started line', t7.length === 1 && t7[0] === '🔨 feat-y started', JSON.stringify(t7))

  // active change disappears (archived) → silent
  const t8 = classifySpecclawTransitions(
    snap({ activeChange: 'feat-x', phase: 'verify', verify: 'pass' }),
    snap({}),
  )
  check('AC2: change archived → no lines', t8.length === 0)
}

// ── end-to-end fixture sequence: build → tasks → verify ──────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), 'sc-progress-'))
  try {
    writeFixture(dir, {
      activeLine: '- 🔨 **seq** — 0/4 tasks (0%)',
      changeName: 'seq',
      phaseRows: { Spec: '✅ Done', Build: '🔨 In Progress', Verify: '⬜ Pending' },
    })
    const s1 = takeSpecclawProgressSnapshot(dir)

    writeFixture(dir, {
      activeLine: '- 🔨 **seq** — 2/4 tasks (50%)',
      changeName: 'seq',
      phaseRows: { Spec: '✅ Done', Build: '🔨 In Progress', Verify: '⬜ Pending' },
    })
    const s2 = takeSpecclawProgressSnapshot(dir)
    const l12 = classifySpecclawTransitions(s1, s2)
    check('sequence: task progress line', l12.length === 1 && l12[0] === 'tasks 2/4 ✅', JSON.stringify(l12))

    writeFixture(dir, {
      activeLine: '- 🔨 **seq** — 4/4 tasks (100%)',
      changeName: 'seq',
      phaseRows: { Spec: '✅ Done', Build: '✅ Done', Verify: '🟢 Pass' },
    })
    const s3 = takeSpecclawProgressSnapshot(dir)
    const l23 = classifySpecclawTransitions(s2, s3)
    check('sequence: final tick has tasks + verify lines', l23.includes('tasks 4/4 ✅') && l23.includes('verify 🟢'), JSON.stringify(l23))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── summary ──────────────────────────────────────────────────────────────────

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
