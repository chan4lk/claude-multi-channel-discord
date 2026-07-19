import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { countCheckboxes } from './backlog.ts'

export interface SpecclawStatus {
  present: boolean
  activeChange?: string
  phase?: string
  tasksDone?: number
  tasksTotal?: number
  failedTasks?: number
  pendingProposals?: number
}

export interface SpecclawHalt {
  halted: boolean
  change?: string
  evidence?: string
}

/**
 * Detect a specclaw guardrail halt on disk. Conservative by design:
 * only explicit failure markers count (failed-task count in the
 * dashboard, 🔴/❌ phase rows, non-empty Issues section). Anything
 * unreadable or ambiguous is healthy — a false positive would
 * silently suspend a working loop, a false negative costs one
 * redundant fire.
 */
export function detectSpecclawHalt(projectCwd: string): SpecclawHalt {
  const ss = readSpecclawStatus(projectCwd)
  if (!ss.present || ss.activeChange === undefined) return { halted: false }

  if (ss.failedTasks !== undefined && ss.failedTasks > 0) {
    return { halted: true, change: ss.activeChange, evidence: `${ss.failedTasks} failed task(s)` }
  }

  const changePath = join(projectCwd, '.specclaw', 'changes', ss.activeChange, 'status.md')
  let content: string
  try {
    content = readFileSync(changePath, 'utf8')
  } catch {
    return { halted: false }
  }
  const lines = content.split('\n')

  const progressIdx = lines.findIndex((l) => l.trim() === '## Progress')
  if (progressIdx !== -1) {
    for (let i = progressIdx + 1; i < lines.length; i++) {
      const t = lines[i]!.trim()
      if (!t) continue
      if (!t.startsWith('|')) break
      if (t.includes('🔴') || t.includes('❌')) {
        const phase = t.split('|').map((c) => c.trim()).find((c) => c.length > 0) ?? 'unknown'
        return { halted: true, change: ss.activeChange, evidence: `phase ${phase} ${t.includes('🔴') ? '🔴' : '❌'}` }
      }
    }
  }

  const issuesIdx = lines.findIndex((l) => l.trim() === '## Issues')
  if (issuesIdx !== -1) {
    for (let i = issuesIdx + 1; i < lines.length; i++) {
      const t = lines[i]!.trim()
      if (!t) continue
      if (t.startsWith('## ')) break
      const bare = t.replace(/^[-*]\s*/, '').replace(/[_*]/g, '').replace(/\.$/, '').toLowerCase()
      if (bare === 'none') break
      return { halted: true, change: ss.activeChange, evidence: `open issue: ${t.slice(0, 80)}` }
    }
  }

  return { halted: false }
}

/**
 * Build the SPECCLAW RESUME block appended to a rotation context brief.
 * Disk state under .specclaw/ is authoritative after rotation — the block
 * steers a fresh session to read it instead of re-planning from lossy prose.
 * Returns '' when the project has no .specclaw/, so callers can append
 * unconditionally-when-non-empty and keep non-specclaw briefs byte-identical.
 */
export function buildSpecclawResumeBlock(projectCwd: string): string {
  const ss = readSpecclawStatus(projectCwd)
  if (!ss.present) return ''

  if (ss.activeChange === undefined) {
    return 'SPECCLAW: no active change. Check BACKLOG.md and .specclaw/STATUS.md for pending work before starting anything new.'
  }

  const phase = ss.phase ?? 'unknown phase'
  const counts = ss.tasksDone !== undefined && ss.tasksTotal !== undefined
    ? `, ${ss.tasksDone}/${ss.tasksTotal} tasks done`
    : ''
  const allDone =
    ss.tasksDone !== undefined && ss.tasksTotal !== undefined &&
    ss.tasksTotal > 0 && ss.tasksDone === ss.tasksTotal
  if (allDone) {
    return [
      'SPECCLAW RESUME: This project uses specclaw. Authoritative state is on disk, not in this brief.',
      `Active change: ${ss.activeChange} (${phase}${counts}).`,
      'All build tasks are complete — do NOT re-run /specclaw:build.',
      `Read .specclaw/changes/${ss.activeChange}/status.md, then run /specclaw:verify (and /specclaw:pr once verified).`,
      'Do not re-run /specclaw:propose or /specclaw:plan for this change.',
    ].join('\n')
  }
  return [
    'SPECCLAW RESUME: This project uses specclaw. Authoritative state is on disk, not in this brief.',
    `Active change: ${ss.activeChange} (${phase}${counts}).`,
    `Before doing anything else: read .specclaw/changes/${ss.activeChange}/status.md and tasks.md,`,
    'then continue from the first non-completed task via /specclaw:build.',
    'Do not re-run /specclaw:propose or /specclaw:plan for this change.',
  ].join('\n')
}

export function readSpecclawStatus(projectCwd: string): SpecclawStatus {
  const dashboardPath = join(projectCwd, '.specclaw', 'STATUS.md')
  let content: string
  try {
    content = readFileSync(dashboardPath, 'utf8')
  } catch {
    return { present: false }
  }

  const lines = content.split('\n')

  let activeChange: string | undefined
  let tasksDone: number | undefined
  let tasksTotal: number | undefined
  let failedTasks: number | undefined
  let pendingProposals: number | undefined

  // Find Active Changes section and parse 🔨 entries
  let inActiveChanges = false
  let inPendingProposals = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('## ')) {
      inActiveChanges = trimmed === '## Active Changes'
      inPendingProposals = trimmed === '## Pending Proposals'
      continue
    }

    if (inActiveChanges && trimmed.startsWith('- 🔨') && activeChange === undefined) {
      // - 🔨 **name** — 3/8 tasks (38%) | 1 failed
      const nameMatch = trimmed.match(/\*\*([^*]+)\*\*/)
      if (nameMatch) {
        activeChange = nameMatch[1]
        const countsMatch = trimmed.match(/(\d+)\/(\d+)\s+tasks/)
        if (countsMatch) {
          tasksDone = parseInt(countsMatch[1], 10)
          tasksTotal = parseInt(countsMatch[2], 10)
        }
        const failedMatch = trimmed.match(/\|\s*(\d+)\s+failed/)
        if (failedMatch) {
          failedTasks = parseInt(failedMatch[1], 10)
        }
      }
    }

    if (inPendingProposals && trimmed.startsWith('- 📋')) {
      pendingProposals = (pendingProposals ?? 0) + 1
    }
  }

  const result: SpecclawStatus = { present: true }
  if (activeChange !== undefined) result.activeChange = activeChange
  if (tasksDone !== undefined) result.tasksDone = tasksDone
  if (tasksTotal !== undefined) result.tasksTotal = tasksTotal
  if (failedTasks !== undefined) result.failedTasks = failedTasks
  if (pendingProposals !== undefined) result.pendingProposals = pendingProposals

  // STATUS.md is only as fresh as the last dashboard regeneration; tasks.md is
  // the ground truth during an active build. Live checkbox counts win when the
  // file has at least one task line (missing/empty file keeps dashboard counts).
  if (activeChange !== undefined) {
    const live = countCheckboxes(join(projectCwd, '.specclaw', 'changes', activeChange, 'tasks.md'))
    if (live.total >= 1) {
      result.tasksDone = live.done
      result.tasksTotal = live.total
    }
  }

  // FR3: resolve phase from change's status.md
  if (activeChange !== undefined) {
    const changePath = join(projectCwd, '.specclaw', 'changes', activeChange, 'status.md')
    let changeContent: string
    try {
      changeContent = readFileSync(changePath, 'utf8')
    } catch {
      return result
    }

    const changeLines = changeContent.split('\n')
    const progressIdx = changeLines.findIndex(l => l.trim() === '## Progress')
    if (progressIdx !== -1) {
      for (let i = progressIdx + 1; i < changeLines.length; i++) {
        const cl = changeLines[i].trim()
        if (!cl) continue
        if (!cl.startsWith('|')) break

        const cols = cl.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
        if (cols.length < 2) continue

        const phase = cols[0]
        const status = cols[1]

        if (!phase || phase.startsWith('-') || phase.toLowerCase() === 'phase') continue
        if (phase.toLowerCase() === 'proposal') continue

        if (!status.includes('🟢') && !status.includes('✅')) {
          result.phase = phase.toLowerCase()
          break
        }
      }
    }
  }

  return result
}
