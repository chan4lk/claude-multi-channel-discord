/**
 * Backlog autopilot — pure logic module.
 * No timers, no Discord, no process side-effects.
 * fs reads only in detectBacklogSource / snapshotBacklog.
 *
 * Run: bun src/backlog.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AutopilotConfig } from './channels-config.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The exact reply-required footer injected by the scheduler (scheduler.ts envelopeFor). */
const REPLY_REQUIRED_FOOTER =
  '\n\n[Scheduled task — REQUIRED: you MUST call mcp__mcd__reply when done. ' +
  'mcp__mcd__reply is the ONLY way your output reaches Discord. ' +
  'Include all key results: PR URLs, branch names, error messages, or "no changes needed". ' +
  'If you created or updated a PR, post the full URL. ' +
  'Finishing without calling mcp__mcd__reply means the operator sees nothing.]'

/** Regex matching a markdown checkbox task line (`- [ ]`, `- [x]`, `* [ ]`, `* [x]`). */
const TASK_LINE_RE = /^\s*[-*] \[( |x)\]/i

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacklogSource = 'specclaw' | 'file' | 'none'

export type AutopilotAction =
  | { kind: 'seed'; prompt: string }
  | { kind: 'nudge'; prompt: string }
  | { kind: 'verify-failed' }
  | { kind: 'stall' }
  | { kind: 'complete' }
  | { kind: 'rearm' }
  | { kind: 'none' }

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

/**
 * Detect which backlog source exists for a project.
 * `.specclaw/STATUS.md` presence → 'specclaw' (wins over any backlog file).
 * Backlog file (default 'BACKLOG.md') with ≥1 checkbox task line → 'file'.
 * Otherwise → 'none'.
 */
export function detectBacklogSource(projectCwd: string, file: string = 'BACKLOG.md'): BacklogSource {
  // Specclaw wins
  if (existsSync(join(projectCwd, '.specclaw', 'STATUS.md'))) return 'specclaw'
  // File fallback
  const filePath = join(projectCwd, file)
  if (!existsSync(filePath)) return 'none'
  try {
    const text = readFileSync(filePath, 'utf8')
    const hasTask = text.split('\n').some(line => TASK_LINE_RE.test(line))
    return hasTask ? 'file' : 'none'
  } catch {
    return 'none'
  }
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Count done / total checkbox task lines for a project.
 *
 * file flavor: counts lines matching `- [ ]` or `- [x]` in the backlog file.
 * specclaw flavor: for each non-archive dir under `.specclaw/changes/`:
 *   - if `tasks.md` exists → count its checkbox lines (done = `[x]`, total = either).
 *   - else if `proposal.md` exists (pending proposal, no plan yet) → +1 total open item.
 * Returns {0, 0} on any error; never throws.
 */
export function snapshotBacklog(
  projectCwd: string,
  source: BacklogSource,
  file: string = 'BACKLOG.md',
): { done: number; total: number } {
  try {
    if (source === 'file') {
      return countCheckboxes(join(projectCwd, file))
    }
    if (source === 'specclaw') {
      return snapshotSpecclaw(projectCwd)
    }
  } catch {
    // fall through
  }
  return { done: 0, total: 0 }
}

/** Count done / total checkbox lines in a single file. */
export function countCheckboxes(filePath: string): { done: number; total: number } {
  if (!existsSync(filePath)) return { done: 0, total: 0 }
  let done = 0
  let total = 0
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    for (const line of lines) {
      const m = TASK_LINE_RE.exec(line)
      if (!m) continue
      total++
      if (m[1].toLowerCase() === 'x') done++
    }
  } catch {
    // partial read — return what we have
  }
  return { done, total }
}

/** Snapshot the specclaw changes directory. */
function snapshotSpecclaw(projectCwd: string): { done: number; total: number } {
  const changesDir = join(projectCwd, '.specclaw', 'changes')
  if (!existsSync(changesDir)) return { done: 0, total: 0 }
  let done = 0
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(changesDir)
  } catch {
    return { done: 0, total: 0 }
  }
  for (const name of entries) {
    if (name === 'archive') continue
    const changeDir = join(changesDir, name)
    const tasksPath = join(changeDir, 'tasks.md')
    if (existsSync(tasksPath)) {
      const counts = countCheckboxes(tasksPath)
      done += counts.done
      total += counts.total
    } else if (existsSync(join(changeDir, 'proposal.md'))) {
      // Pending proposal with no plan yet → one open item
      total += 1
    }
  }
  return { done, total }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the one-shot backlog-authoring seed prompt.
 * When `goal` is provided it is included verbatim; otherwise a CLAUDE.md-derived
 * instruction is used.
 */
export function buildSeedPrompt(slug: string, goal?: string): string {
  const goalText = goal
    ? goal
    : 'derive the goals from this project\'s CLAUDE.md and current repository state'
  return (
    `Create or update BACKLOG.md as a prioritized markdown checkbox list of concrete, ` +
    `independently completable work items. Goal: ${goalText}. ` +
    `Requirements: use checkbox format only (\`- [ ] item\`), no prose-only sections, ` +
    `every item must be actionable and self-contained. ` +
    `When done, reply via mcp__mcd__reply with the total item count.`
  )
}

/**
 * Build the periodic nudge prompt for the autopilot loop.
 * Both flavors append the exact reply-required footer from envelopeFor().
 */
export function buildNudgePrompt(source: BacklogSource, snap: { done: number; total: number }): string {
  let body: string
  if (source === 'specclaw') {
    body =
      `Advance the specclaw lifecycle for the next pending change or incomplete task. ` +
      `Plan any approved proposals that lack a plan, run /specclaw:build for tasks that ` +
      `are planned but not yet built, and stop once a change is ready for a PR. ` +
      `Current progress: ${snap.done}/${snap.total} tasks done.`
  } else {
    body =
      `Work the NEXT unchecked item in BACKLOG.md, top-to-bottom. ` +
      `Check it off (\`- [x]\`) when complete. One item per turn only. ` +
      `Current progress: ${snap.done}/${snap.total} items done.`
  }
  return body + REPLY_REQUIRED_FOOTER
}

// ---------------------------------------------------------------------------
// Window check
// ---------------------------------------------------------------------------

/**
 * Return true when `now` falls within the HH:MM-HH:MM local-time window.
 * Start is inclusive, end is exclusive. Midnight wrap-around is supported
 * (e.g. '22:00-06:00').
 */
export function withinWindow(window: string, now: Date): boolean {
  const [startStr, endStr] = window.split('-')
  if (!startStr || !endStr) return false
  const [sh, sm] = startStr.split(':').map(Number)
  const [eh, em] = endStr.split(':').map(Number)
  if (
    isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em) ||
    sh > 23 || sm > 59 || eh > 23 || em > 59
  ) return false

  const nowMins = now.getHours() * 60 + now.getMinutes()
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em

  if (startMins < endMins) {
    // Normal range (e.g. 09:00-17:00)
    return nowMins >= startMins && nowMins < endMins
  } else {
    // Wrap-around midnight (e.g. 22:00-06:00)
    return nowMins >= startMins || nowMins < endMins
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** Effective defaults when neither project nor global defaults specify a value. */
const BUILT_IN_INTERVAL_MINUTES = 30
const BUILT_IN_STALL_THRESHOLD = 3

/**
 * Pure autopilot state machine transition.
 *
 * Returns an action to execute and a patch to merge into autopilot config.
 * All timing decisions are made here; callers pass `nowIso` so tests can
 * inject the clock.
 */
export function nextAutopilotAction(opts: {
  autopilot: AutopilotConfig
  defaults?: { intervalMinutes?: number; stallThreshold?: number }
  source: BacklogSource
  snap: { done: number; total: number }
  slug: string
  nowIso: string
  heartbeatWindow?: string
}): { action: AutopilotAction; patch: Partial<AutopilotConfig> } {
  const { autopilot, defaults, source, snap, slug, nowIso, heartbeatWindow } = opts

  // Disabled — no-op
  if (!autopilot.enabled) {
    return { action: { kind: 'none' }, patch: {} }
  }

  const intervalMs =
    (autopilot.intervalMinutes ?? defaults?.intervalMinutes ?? BUILT_IN_INTERVAL_MINUTES) * 60 * 1000
  const stallThreshold =
    autopilot.stallThreshold ?? defaults?.stallThreshold ?? BUILT_IN_STALL_THRESHOLD
  const respectWindow = autopilot.respectHeartbeatWindow ?? true

  const now = new Date(nowIso)
  const state = autopilot.state

  // -------------------------------------------------------------------------
  // Fresh enable (no state yet)
  // -------------------------------------------------------------------------
  if (state === undefined) {
    if (source === 'none') {
      // No backlog exists — seed it
      return {
        action: { kind: 'seed', prompt: buildSeedPrompt(slug, autopilot.seedGoal) },
        patch: {
          state: 'seeding',
          seededAt: nowIso,
          lastFireAt: nowIso,
          zeroDeltaCount: 0,
        },
      }
    }
    // Backlog already exists — go straight to running (first nudge next tick)
    return {
      action: { kind: 'none' },
      patch: {
        state: 'running',
        lastSnapshot: snap,
        zeroDeltaCount: 0,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Seeding — waiting for backlog to appear
  // -------------------------------------------------------------------------
  if (state === 'seeding') {
    if (source !== 'none' && snap.total >= 1) {
      // Backlog appeared — move to running
      return {
        action: { kind: 'none' },
        patch: {
          state: 'running',
          lastSnapshot: snap,
          zeroDeltaCount: 0,
        },
      }
    }
    // Check if seed verification window expired (2 × interval)
    const seededAt = autopilot.seededAt ? new Date(autopilot.seededAt).getTime() : now.getTime()
    if (now.getTime() - seededAt >= 2 * intervalMs) {
      return { action: { kind: 'verify-failed' }, patch: { state: 'halted' } }
    }
    return { action: { kind: 'none' }, patch: {} }
  }

  // -------------------------------------------------------------------------
  // Halted — manual re-arm only
  // -------------------------------------------------------------------------
  if (state === 'halted') {
    return { action: { kind: 'none' }, patch: {} }
  }

  // -------------------------------------------------------------------------
  // Complete — watch for re-arm
  // -------------------------------------------------------------------------
  if (state === 'complete') {
    if (snap.done < snap.total) {
      // New items appeared
      return {
        action: { kind: 'rearm' },
        patch: { state: 'running', lastSnapshot: snap, zeroDeltaCount: 0 },
      }
    }
    return { action: { kind: 'none' }, patch: {} }
  }

  // -------------------------------------------------------------------------
  // Running — the main nudge loop
  // -------------------------------------------------------------------------
  // state === 'running'

  // Completion check
  if (snap.total > 0 && snap.done === snap.total) {
    return {
      action: { kind: 'complete' },
      patch: { state: 'complete', lastSnapshot: snap },
    }
  }

  // Window gate (seed exempt; only nudges respect window)
  if (respectWindow && heartbeatWindow && !withinWindow(heartbeatWindow, now)) {
    return { action: { kind: 'none' }, patch: {} }
  }

  // Interval gate
  const lastFireAt = autopilot.lastFireAt ? new Date(autopilot.lastFireAt).getTime() : 0
  if (now.getTime() - lastFireAt < intervalMs) {
    return { action: { kind: 'none' }, patch: {} }
  }

  // Interval elapsed — check progress
  const prev = autopilot.lastSnapshot ?? { done: 0, total: 0 }
  const delta = snap.done - prev.done + (snap.total - prev.total > 0 ? 0 : 0)
  // Delta = number of newly-done items since last fire
  const progressDelta = snap.done - prev.done
  const zeroDeltaCount = (autopilot.zeroDeltaCount ?? 0) + (progressDelta > 0 ? 0 : 1)
  // Reset if there's progress
  const newZeroDeltaCount = progressDelta > 0 ? 0 : zeroDeltaCount

  if (progressDelta === 0 && newZeroDeltaCount >= stallThreshold) {
    return {
      action: { kind: 'stall' },
      patch: { state: 'halted', zeroDeltaCount: newZeroDeltaCount },
    }
  }

  return {
    action: { kind: 'nudge', prompt: buildNudgePrompt(source, snap) },
    patch: {
      lastFireAt: nowIso,
      lastSnapshot: snap,
      zeroDeltaCount: newZeroDeltaCount,
    },
  }
}
