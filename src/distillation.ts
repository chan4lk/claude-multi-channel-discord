/**
 * Cross-session memory distillation (P38).
 *
 * After a Claude project session ends, spawn a short-lived `claude -p` process
 * in the project directory that summarises the session into MEMORY.md.
 * The process merges with existing content — it reads MEMORY.md via its tools
 * and rewrites it with the combined summary. Hard timeout: 90s; retried once on
 * non-zero exit. Fires-and-forgets — callers do not await.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const DISTILL_TIMEOUT_MS = 90_000
const DISTILL_PROMPT =
  'Summarise the key facts, decisions, and open questions from this session into MEMORY.md ' +
  'in 500 words or less. Merge with any existing content — do not replace sections that are ' +
  'still relevant. Write only to MEMORY.md; output nothing else.'

export interface DistillationResult {
  success: boolean
  durationMs: number
  attempt: number
  error?: string
}

function attempt(
  cwd: string,
  claudeBin: string,
  log: (msg: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const child = spawn(claudeBin, ['-p', DISTILL_PROMPT, '--permission-mode', 'auto'], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env },
    })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      log(`distillation: timed out after ${DISTILL_TIMEOUT_MS}ms`)
      resolve({ ok: false, error: 'timeout' })
    }, DISTILL_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = Date.now() - start
      if (code === 0) {
        log(`distillation: completed in ${durationMs}ms`)
        resolve({ ok: true })
      } else {
        const err = stderr.slice(0, 200).trim() || `exit ${code}`
        log(`distillation: failed (${err})`)
        resolve({ ok: false, error: err })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      log(`distillation: spawn error: ${err.message}`)
      resolve({ ok: false, error: err.message })
    })
  })
}

/**
 * Run distillation for a project. Fire-and-forget — do NOT await if you want
 * non-blocking behaviour (e.g. call from kill()). Returns the result for
 * callers that DO want to observe completion (e.g. tests).
 */
export async function runDistillation(opts: {
  slug: string
  cwd: string
  claudeBin?: string
  log: (msg: string) => void
  onComplete?: (result: DistillationResult) => void
}): Promise<DistillationResult> {
  const { cwd, claudeBin = 'claude', log, onComplete } = opts

  if (!existsSync(cwd)) {
    log(`distillation: cwd ${cwd} does not exist — skipping`)
    const r: DistillationResult = { success: false, durationMs: 0, attempt: 0, error: 'cwd missing' }
    onComplete?.(r)
    return r
  }

  const start = Date.now()
  log(`distillation: starting for cwd=${cwd}`)

  let result = await attempt(cwd, claudeBin, log)
  let attemptNum = 1

  if (!result.ok) {
    log('distillation: retrying once')
    result = await attempt(cwd, claudeBin, log)
    attemptNum = 2
  }

  const r: DistillationResult = {
    success: result.ok,
    durationMs: Date.now() - start,
    attempt: attemptNum,
    ...(result.error ? { error: result.error } : {}),
  }
  onComplete?.(r)
  return r
}
