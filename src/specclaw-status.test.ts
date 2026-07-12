/**
 * bun src/specclaw-status.test.ts
 *
 * Tests for src/specclaw-status.ts — verifies AC1–AC4 and edge cases from the spec.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { readSpecclawStatus } from './specclaw-status.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ── fixture helpers ──────────────────────────────────────────────────────────

const DASHBOARD_HEADER = `# 🦞 SpecClaw Dashboard

> Generated: 2026-07-12T10:00:00Z

`

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'specclaw-status-test-'))
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

/**
 * Build a realistic STATUS.md dashboard with given sections.
 */
function buildDashboard(opts: {
  activeChanges?: string[]
  pendingProposals?: string[]
  completedChanges?: string[]
}): string {
  const parts: string[] = [DASHBOARD_HEADER]

  parts.push('## Active Changes\n\n')
  if (opts.activeChanges && opts.activeChanges.length > 0) {
    for (const line of opts.activeChanges) {
      parts.push(line + '\n')
    }
  } else {
    parts.push('_None_\n')
  }

  parts.push('\n## Pending Proposals\n\n')
  if (opts.pendingProposals && opts.pendingProposals.length > 0) {
    for (const line of opts.pendingProposals) {
      parts.push(line + '\n')
    }
  } else {
    parts.push('_None_\n')
  }

  parts.push('\n## Completed Changes\n\n')
  if (opts.completedChanges && opts.completedChanges.length > 0) {
    for (const line of opts.completedChanges) {
      parts.push(line + '\n')
    }
  } else {
    parts.push('_None_\n')
  }

  parts.push('\n## Stats\n\n- **Total changes:** 1\n- **Active:** 1\n')

  return parts.join('')
}

/**
 * Build a realistic changes/<name>/status.md with a Progress table.
 */
function buildChangeStatus(name: string, phaseStatuses: Record<string, string>): string {
  const rows = Object.entries(phaseStatuses)
    .map(([phase, status]) => `| ${phase} | ${status} | — |`)
    .join('\n')

  return `# Status: ${name}

**Change:** ${name}
**Created:** 2026-07-12
**Status:** 🔨 In Progress

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
${rows}

## Notes

- Work in progress
`
}

// ── AC1: no .specclaw dir → {present:false}; STATUS.md missing → {present:false} ──

{
  const dir = makeTmpDir()
  try {
    // No .specclaw directory at all
    const result = readSpecclawStatus(dir)
    check('AC1: no .specclaw dir → present:false', result.present === false)
    check('AC1: no .specclaw dir → no throw (got result)', typeof result === 'object')

    // .specclaw dir exists but no STATUS.md
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    const result2 = readSpecclawStatus(dir)
    check('AC1: STATUS.md missing → present:false', result2.present === false)
    check('AC1: STATUS.md missing → no throw (got result)', typeof result2 === 'object')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── AC2: dashboard with 🔨 foo — 3/8 tasks (38%) | 1 failed + 2 pending proposals ──

{
  const dir = makeTmpDir()
  try {
    const dashboard = buildDashboard({
      activeChanges: [
        '- 🔨 **foo** — 3/8 tasks (38%) | 1 failed',
      ],
      pendingProposals: [
        '- 📋 **bar-proposal** — awaiting planning',
        '- 📋 **baz-proposal** — awaiting planning',
      ],
    })
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'STATUS.md'), dashboard, 'utf8')

    const result = readSpecclawStatus(dir)
    check('AC2: present:true', result.present === true)
    check('AC2: activeChange = "foo"', result.activeChange === 'foo', `got: ${result.activeChange}`)
    check('AC2: tasksDone = 3', result.tasksDone === 3, `got: ${result.tasksDone}`)
    check('AC2: tasksTotal = 8', result.tasksTotal === 8, `got: ${result.tasksTotal}`)
    check('AC2: failedTasks = 1', result.failedTasks === 1, `got: ${result.failedTasks}`)
    check('AC2: pendingProposals = 2', result.pendingProposals === 2, `got: ${result.pendingProposals}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── AC3: change status.md where Build row is 🔨, earlier rows 🟢 → phase:'build' ──

{
  const dir = makeTmpDir()
  try {
    const dashboard = buildDashboard({
      activeChanges: [
        '- 🔨 **foo** — 3/8 tasks (38%) | 1 failed',
      ],
      pendingProposals: [
        '- 📋 **bar-proposal** — awaiting planning',
        '- 📋 **baz-proposal** — awaiting planning',
      ],
    })
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'STATUS.md'), dashboard, 'utf8')

    // Write changes/foo/status.md with Proposal+Spec+Design+Tasks = 🟢/✅, Build = 🔨
    const changeStatus = buildChangeStatus('foo', {
      Proposal: '🟢 Approved',
      Spec: '✅ Done',
      Design: '🟢 Done',
      Tasks: '✅ Done',
      Build: '🔨 In Progress',
    })
    mkdirSync(join(dir, '.specclaw', 'changes', 'foo'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'changes', 'foo', 'status.md'), changeStatus, 'utf8')

    const result = readSpecclawStatus(dir)
    check('AC3: present:true', result.present === true)
    check('AC3: activeChange = "foo"', result.activeChange === 'foo', `got: ${result.activeChange}`)
    check('AC3: phase = "build"', result.phase === 'build', `got: ${result.phase}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── AC4: dashboard with only ✅ entries → activeChange undefined, present:true ──

{
  const dir = makeTmpDir()
  try {
    const dashboard = buildDashboard({
      activeChanges: [
        '- ✅ **done-thing** — 5/5 tasks (100%) | 0 failed',
      ],
      pendingProposals: [],
    })
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'STATUS.md'), dashboard, 'utf8')

    const result = readSpecclawStatus(dir)
    check('AC4: present:true', result.present === true)
    check('AC4: activeChange is undefined', result.activeChange === undefined, `got: ${result.activeChange}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── Edge: activeChange set but changes/<name>/status.md missing → phase undefined, counts populated ──

{
  const dir = makeTmpDir()
  try {
    const dashboard = buildDashboard({
      activeChanges: [
        '- 🔨 **orphan** — 2/5 tasks (40%) | 0 failed',
      ],
      pendingProposals: [],
    })
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'STATUS.md'), dashboard, 'utf8')
    // Intentionally do NOT write changes/orphan/status.md

    const result = readSpecclawStatus(dir)
    check('Edge (missing status.md): present:true', result.present === true)
    check('Edge (missing status.md): activeChange = "orphan"', result.activeChange === 'orphan', `got: ${result.activeChange}`)
    check('Edge (missing status.md): phase undefined', result.phase === undefined, `got: ${result.phase}`)
    check('Edge (missing status.md): tasksDone = 2', result.tasksDone === 2, `got: ${result.tasksDone}`)
    check('Edge (missing status.md): tasksTotal = 5', result.tasksTotal === 5, `got: ${result.tasksTotal}`)
    check('Edge (missing status.md): failedTasks = 0', result.failedTasks === 0, `got: ${result.failedTasks}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── Edge: bullet without task counts → activeChange set, counts undefined ──

{
  const dir = makeTmpDir()
  try {
    const dashboard = buildDashboard({
      activeChanges: [
        '- 🔨 **bare** — proposal ready, awaiting planning',
      ],
      pendingProposals: [],
    })
    mkdirSync(join(dir, '.specclaw'), { recursive: true })
    writeFileSync(join(dir, '.specclaw', 'STATUS.md'), dashboard, 'utf8')

    const result = readSpecclawStatus(dir)
    check('Edge (no counts): present:true', result.present === true)
    check('Edge (no counts): activeChange = "bare"', result.activeChange === 'bare', `got: ${result.activeChange}`)
    check('Edge (no counts): tasksDone undefined', result.tasksDone === undefined, `got: ${result.tasksDone}`)
    check('Edge (no counts): tasksTotal undefined', result.tasksTotal === undefined, `got: ${result.tasksTotal}`)
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
