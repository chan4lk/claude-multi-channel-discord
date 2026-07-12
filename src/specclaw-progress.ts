/**
 * progressMode "phases" — specclaw lifecycle transition detection.
 *
 * Pure snapshot/diff over `.specclaw/` disk state. The classifier takes two
 * snapshots and returns bare timeline lines (no timestamps, no Date) so it
 * is fully fixture-testable; the server stamps observation time at dispatch.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readSpecclawStatus } from './specclaw-status.ts'

export interface SpecclawProgressSnapshot {
  present: boolean
  activeChange?: string
  phase?: string
  tasksDone?: number
  tasksTotal?: number
  verify?: 'pass' | 'fail'
}

/**
 * Read the current specclaw state for diffing. Extends readSpecclawStatus()
 * with the active change's Verify verdict (🟢/✅ pass, 🔴/❌ fail).
 */
export function takeSpecclawProgressSnapshot(projectCwd: string): SpecclawProgressSnapshot {
  const ss = readSpecclawStatus(projectCwd)
  if (!ss.present) return { present: false }

  const snap: SpecclawProgressSnapshot = { present: true }
  if (ss.activeChange !== undefined) snap.activeChange = ss.activeChange
  if (ss.phase !== undefined) snap.phase = ss.phase
  if (ss.tasksDone !== undefined) snap.tasksDone = ss.tasksDone
  if (ss.tasksTotal !== undefined) snap.tasksTotal = ss.tasksTotal

  if (ss.activeChange !== undefined) {
    const verdict = readVerifyVerdict(join(projectCwd, '.specclaw', 'changes', ss.activeChange, 'status.md'))
    if (verdict !== undefined) snap.verify = verdict
  }
  return snap
}

function readVerifyVerdict(changeStatusPath: string): 'pass' | 'fail' | undefined {
  let content: string
  try {
    content = readFileSync(changeStatusPath, 'utf8')
  } catch {
    return undefined
  }
  const lines = content.split('\n')
  const progressIdx = lines.findIndex((l) => l.trim() === '## Progress')
  if (progressIdx === -1) return undefined
  for (let i = progressIdx + 1; i < lines.length; i++) {
    const t = lines[i]!.trim()
    if (!t) continue
    if (!t.startsWith('|')) break
    const cols = t.split('|').map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    if (cols.length < 2) continue
    if (cols[0]!.toLowerCase() !== 'verify') continue
    const status = cols[1]!
    if (status.includes('🟢') || status.includes('✅')) return 'pass'
    if (status.includes('🔴') || status.includes('❌')) return 'fail'
    return undefined
  }
  return undefined
}

/**
 * Diff two snapshots into timeline lines. Each meaningful transition yields
 * exactly one line; no transition yields []. A change switch suppresses
 * same-tick counter diffs — the old change's numbers aren't comparable.
 */
export function classifySpecclawTransitions(
  prev: SpecclawProgressSnapshot,
  next: SpecclawProgressSnapshot,
): string[] {
  if (!next.present || next.activeChange === undefined) return []

  if (next.activeChange !== prev.activeChange) {
    return [`🔨 ${next.activeChange} started`]
  }

  const lines: string[] = []
  if (next.phase !== undefined && next.phase !== prev.phase) {
    const taskSuffix = next.phase === 'build' && next.tasksTotal !== undefined
      ? ` (${next.tasksTotal} tasks)`
      : ''
    lines.push(`${next.phase} started${taskSuffix}`)
  }
  // prev.tasksDone must be known — undefined→0 is discovery, not progress.
  if (next.tasksDone !== undefined && prev.tasksDone !== undefined && next.tasksDone !== prev.tasksDone && next.tasksTotal !== undefined) {
    lines.push(`tasks ${next.tasksDone}/${next.tasksTotal} ✅`)
  }
  if (next.verify !== undefined && next.verify !== prev.verify) {
    lines.push(`verify ${next.verify === 'pass' ? '🟢' : '🔴'}`)
  }
  return lines
}
