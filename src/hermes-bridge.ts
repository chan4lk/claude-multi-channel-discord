import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'

import type { HermesConfig } from './channels-config.ts'
import { hermesRunsDir } from './paths.ts'

export function newRunId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
  return `h-${ts}-${rand}`
}

export function wrapHermesPrompt(
  rawPrompt: string,
  runId: string,
  masterChatId: string,
  opts?: { report?: boolean },
): string {
  const report = opts?.report !== false
  const parts: string[] = [
    `MCD bridge run ${runId}`,
    '',
    rawPrompt,
    '',
    'If this task involves killing or restarting the MCD server, wait 5 seconds after receiving this prompt before any destructive step.',
  ]
  if (report) {
    parts.push('')
    parts.push(
      `When finished, report the outcome by running: hermes send --to discord:${masterChatId} "[hermes:${runId}] <one-line outcome>"`,
    )
  }
  return parts.join('\n')
}

export function buildHermesArgv(
  cfg: HermesConfig,
  wrappedPrompt: string,
  opts?: { model?: string },
): string[] {
  return [
    '-z',
    wrappedPrompt,
    ...(cfg.yolo ? ['--yolo'] : []),
    ...(opts?.model ? ['-m', opts.model] : []),
    ...cfg.extraArgs,
  ]
}

export function launchHermesRun(opts: {
  prompt: string
  cfg: HermesConfig
  masterChatId: string
  model?: string
  report?: boolean
  spawnFn?: typeof nodeSpawn
}): { runId: string; logPath: string } {
  const { prompt, cfg, masterChatId, model, report, spawnFn = nodeSpawn } = opts

  if (!cfg.enabled) {
    throw new Error('hermes bridge disabled')
  }

  if (!prompt || !prompt.trim()) {
    throw new Error('prompt must not be empty')
  }

  const runId = newRunId()
  const runsDir = hermesRunsDir()
  mkdirSync(runsDir, { recursive: true })

  const logPath = join(runsDir, `${runId}.log`)
  const metaPath = join(runsDir, `${runId}.json`)

  const fd = openSync(logPath, 'a')

  const wrappedPrompt = wrapHermesPrompt(prompt, runId, masterChatId, { report })
  const argv = buildHermesArgv(cfg, wrappedPrompt, { model })

  let child: ReturnType<typeof nodeSpawn>
  try {
    child = spawnFn(cfg.binPath, argv, {
      detached: true,
      stdio: ['ignore', fd, fd],
    })
  } catch (err) {
    closeSync(fd)
    throw new Error(`failed to spawn ${cfg.binPath}: ${(err as Error).message}`)
  }

  child.on('error', (err) => {
    try {
      writeFileSync(logPath, `\n[spawn error] ${err.message}\n`, { flag: 'a' })
    } catch {
      // best-effort
    }
  })

  child.unref()

  closeSync(fd)

  const meta = {
    runId,
    rawPrompt: prompt,
    wrappedPrompt,
    argv,
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    masterChatId,
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')

  return { runId, logPath }
}

export function tailHermesRun(runId: string, lines = 40): string | null {
  const logPath = join(hermesRunsDir(), `${runId}.log`)
  let content: string
  try {
    content = readFileSync(logPath, 'utf8')
  } catch {
    return null
  }
  const all = content.split('\n')
  // Remove trailing empty line if present
  if (all.at(-1) === '') all.pop()
  return all.slice(-lines).join('\n')
}

export function listRecentRuns(n = 10): string[] {
  const runsDir = hermesRunsDir()
  let entries: { id: string; mtime: number }[]
  try {
    entries = readdirSync(runsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const id = f.slice(0, -5)
        try {
          const mtime = statSync(join(runsDir, f)).mtimeMs
          return { id, mtime }
        } catch {
          return { id, mtime: 0 }
        }
      })
  } catch {
    return []
  }
  return entries
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n)
    .map((e) => e.id)
}
