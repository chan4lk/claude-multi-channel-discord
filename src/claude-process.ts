/**
 * Real-Claude implementation of ProjectProcess. Each project runs a
 * dedicated `claude` CLI inside a detached tmux session, kept warm
 * across messages. Inbound Discord messages are injected via
 * `tmux send-keys` so the running interactive claude treats them as
 * keyboard input — same behavior as a human typing in the prompt box.
 *
 * Reply path is unchanged: the running claude is launched with
 * --mcp-config pointing at the master HTTP MCP server, and its
 * `reply` tool calls flow back through MasterMcpServer → ProjectPool →
 * Discord client. tmux gives claude a real PTY so it stays interactive;
 * send-keys gives us a programmatic way to drive it without holding
 * a terminal.
 *
 * Lifecycle:
 *  - start(): tmux new-session -d -s <name> 'claude --mcp-config ...'
 *  - deliver(): tmux send-keys -l "<content>"; tmux send-keys Enter
 *  - alive == has-session check (polled at low frequency)
 *  - kill(): tmux kill-session -t <name>
 *
 * Cross-platform: requires `tmux` (Linux + macOS). Windows operators need
 * WSL until a future fallback path lands.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { ClaudeArgs } from './channels-config.ts'
import type { MasterMcpServer } from './master-mcp-server.ts'
import { projectDir, projectGoalFile, projectSessionFile } from './paths.ts'
import { runDistillation } from './distillation.ts'
import { parseLimitMessage, type LimitHitEvent } from './limit-offer.ts'
import { buildGitEnv, type GitResult as _GitResultUnused } from './git-ops.ts'
import { getCredential, loadCredentials, type Credential } from './git-credentials.ts'
import { loadUserEnv, UserEnvError } from './user-env.ts'
import type {
  InboundEnvelope,
  OutboundReply,
  ProjectProcess,
  ToolProgressEvent,
} from './project-process.ts'

const TMUX_POLL_INTERVAL_MS = 5_000
const MAX_TURN_HISTORY = 5
const ADAPTIVE_MULTIPLIER = 1.5
const MAX_ADAPTIVE_THRESHOLD_MS = 30 * 60_000

/**
 * Exit code we synthesise when a spawned `claude` subprocess never
 * renders its TUI within the wait timeout (or regresses to a non-prompt
 * state mid-life). The pool turns this into a `crashed` event so the
 * server can surface it on Discord.
 */
export const TUI_FAILURE_EXIT_CODE = 99

/**
 * Hard cap on how big a transcript can grow before we refuse to
 * `--resume` it. The .jsonl is replayed on every resume; once it gets
 * fat enough (~512 KB ≈ 75K tokens in this corpus) claude either auto-
 * compacts on every spawn or hangs replaying tool calls. Past the cap
 * we rotate the .session-id aside and start fresh. Conversation
 * continuity is lost for that one channel, but a stuck pool is worse —
 * and the prior `.session-id.rotated-<ts>` is preserved on disk for
 * post-mortem.
 *
 * Per-project override: set `ClaudeProjectProcessOptions.sessionRotateThresholdBytes`
 * to a different byte count; this constant is only the fallback.
 */
export const RESUME_TRANSCRIPT_MAX_BYTES = 512_000

/**
 * Shell-escape a single argv entry for use inside a `tmux new-session ... '<cmd>'`
 * string. Single-quote everything; embedded single quotes become `'\''`.
 */
function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Walk descendants of pid looking for a process whose comm == "claude" or
 * "node" (claude runs on node). Returns the pid of the first match or null.
 */
/**
 * Encode a cwd the same way Claude Code does when computing its
 * transcript directory under `~/.claude/projects/<encoded>`. Every
 * non-alphanumeric char becomes `-`. So
 *   /home/openclaw/.claude/channels/discord-multi/projects/academy-videos
 *   → -home-openclaw--claude-channels-discord-multi-projects-academy-videos
 *
 * Claude itself resolves the cwd through any symlinks before encoding —
 * a project dir like `projects/agent-nexus` that's a symlink to
 * `/home/openclaw/dev/agent-nexus` has its transcripts land under
 * `-home-openclaw-dev-agent-nexus`, not the symlink path. realpathSync
 * the cwd here so our snapshot/diff/stat logic targets the same dir.
 * realpathSync is a no-op on non-symlink paths, so existing channels are
 * unaffected. Falls back to the literal path if realpath throws
 * (broken symlink, ENOENT) — best-effort.
 */
function encodeProjectCwd(cwd: string): string {
  let real = cwd
  try {
    real = realpathSync(cwd)
  } catch {
    // Path doesn't exist yet or symlink target missing — best-effort.
  }
  return real.replace(/[^a-zA-Z0-9]/g, '-')
}

/** List the set of `<uuid>.jsonl` basenames (without extension) in cwd's
 * transcript dir. Used to snapshot existing sessions before spawn so we
 * can identify the newly-created one after the TUI comes up.
 */
function listSessionIds(cwd: string): Set<string> {
  const dir = join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd))
  if (!existsSync(dir)) return new Set()
  try {
    return new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace(/\.jsonl$/, '')),
    )
  } catch {
    return new Set()
  }
}

/**
 * Find the session UUID for the `claude` process we just spawned.
 *
 * We can't trust "newest .jsonl mtime" — Claude writes its first
 * append several seconds after the TUI is interactive, so at capture
 * time a stale session from a previous run is often the newest file
 * on disk. We'd then write a stranger's UUID into .session-id and the
 * next resume would attach the channel to someone else's conversation.
 *
 * Instead: snapshot the set of `<uuid>.jsonl` files BEFORE spawn (the
 * `preSpawn` set), then after TUI ready scan the dir and return any
 * entry that wasn't there before. If multiple new entries exist (race),
 * pick the newest by mtime. If none, return null — caller treats it as
 * "session-id capture deferred; retry next deliver" rather than
 * picking a wrong file.
 */
function findNewSessionId(cwd: string, preSpawn: Set<string>): string | null {
  const dir = join(homedir(), '.claude', 'projects', encodeProjectCwd(cwd))
  if (!existsSync(dir)) return null
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const candidates: Array<{ id: string; mtime: number }> = []
  for (const f of entries) {
    if (!f.endsWith('.jsonl')) continue
    const id = f.replace(/\.jsonl$/, '')
    if (preSpawn.has(id)) continue
    try {
      const m = statSync(join(dir, f)).mtimeMs
      candidates.push({ id, mtime: m })
    } catch {
      // Race: file deleted between readdir and stat. Skip.
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]!.id
}

function findClaudeChild(rootPid: number): number | null {
  // BFS via /proc/<pid>/task/<tid>/children. We don't pull in a
  // process-tree dep — single fs scan is enough.
  const queue: number[] = [rootPid]
  const seen = new Set<number>()
  while (queue.length > 0) {
    const pid = queue.shift()!
    if (seen.has(pid)) continue
    seen.add(pid)
    let comm = ''
    try {
      // /proc/<pid>/comm is the short executable name.
      const fs = require('node:fs') as typeof import('node:fs')
      comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim()
    } catch {
      continue
    }
    if (comm === 'claude' || comm === 'node') return pid
    let childrenRaw = ''
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      childrenRaw = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim()
    } catch {
      continue
    }
    for (const c of childrenRaw.split(/\s+/).filter(Boolean)) {
      const n = parseInt(c, 10)
      if (Number.isFinite(n)) queue.push(n)
    }
  }
  return null
}

/**
 * Read /proc/<pid>/stat (CPU time + start time) and /proc/<pid>/status
 * (VmRSS) into a stat snapshot. Returns null if /proc isn't present
 * (non-Linux) or the pid disappeared mid-read.
 */
function readProcStats(pid: number): { pid: number; cpuTimeMs?: number; memoryMb?: number; uptimeMs?: number } | null {
  try {
    const fs = require('node:fs') as typeof import('node:fs')

    // /proc/<pid>/stat — fields after `comm` are space-separated. comm itself
    // is wrapped in `()` and may contain spaces, so split off everything
    // after the LAST `)`.
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const tail = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)
    const utime = Number(tail[11] ?? 0)
    const stime = Number(tail[12] ?? 0)
    const starttime = Number(tail[19] ?? 0) // jiffies since boot
    const clk = 100 // CLK_TCK; conventionally 100 on Linux. ok within ~1%.

    const cpuTimeMs = ((utime + stime) / clk) * 1000

    let bootTimeSec = 0
    try {
      const uptime = fs.readFileSync('/proc/uptime', 'utf8').split(/\s+/)[0]
      bootTimeSec = Date.now() / 1000 - Number(uptime)
    } catch {}
    const startTimeMs = bootTimeSec ? (bootTimeSec + starttime / clk) * 1000 : 0
    const uptimeMs = startTimeMs ? Math.max(0, Date.now() - startTimeMs) : undefined

    let memoryMb: number | undefined
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
      const m = status.match(/VmRSS:\s+(\d+)\s+kB/)
      if (m) memoryMb = Number(m[1]) / 1024
    } catch {}

    return { pid, cpuTimeMs, memoryMb, uptimeMs }
  } catch {
    return null
  }
}

export interface ClaudeProjectProcessOptions {
  chatId: string
  slug: string
  /** Platform this channel runs on. Affects channel tag source attribute. Defaults to 'discord'. */
  platform?: 'discord' | 'teams' | 'whatsapp'
  /** Pre-started MasterMcpServer; shared across all ClaudeProjectProcesses. */
  master: MasterMcpServer
  /**
   * Resolved per-project Claude CLI args (already merged with defaults).
   * Use channels-config.ts:resolveClaudeArgs() to build this from the
   * config + project entries.
   */
  claudeArgs?: ClaudeArgs
  /** Optional model alias passed via --model. Per-project model override. */
  model?: string
  /**
   * Credential alias from git-credentials.json. When set, the
   * subprocess inherits GIT_ASKPASS / GIT_SSH_COMMAND env vars so
   * `git push` and `gh pr create` work non-interactively.
   */
  gitCredential?: string
  /**
   * Optional Anthropic-compatible provider override. When set, the
   * subprocess gets ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY in its env,
   * routing model calls to that provider instead of Anthropic. Unset =
   * inherit the operator's Claude Code subscription auth.
   */
  provider?: { baseUrl: string; apiKey: string; name?: string }
  /** Override `claude` binary path. Falls back to PATH lookup. */
  claudeBin?: string
  /** Diagnostics. Defaults to stderr with a slug prefix. */
  log?: (msg: string) => void
  /**
   * Context window usage % that triggers a compression prompt injection.
   * 0–100, default 80 (i.e. 80% of the model's context limit).
   * Model context assumed to be 200k tokens.
   */
  contextWarningThresholdPct?: number
  /** Called when a context-warning is emitted (for MC event emission). */
  onContextWarning?: (inputTokens: number, thresholdPct: number) => void
  /**
   * When true, a background `claude -p` distillation job runs after the
   * session ends (clean stop or watchdog kill), merging a session summary
   * into `projects/<slug>/MEMORY.md`. See `src/distillation.ts`.
   */
  distillOnStop?: boolean
  /** Called when distillation completes (for audit trail emission). */
  onDistillationComplete?: (result: { success: boolean; durationMs: number; attempt: number; error?: string }) => void
  /** Per-project transcript size threshold in bytes. Falls back to RESUME_TRANSCRIPT_MAX_BYTES. */
  sessionRotateThresholdBytes?: number
  /** Called when session is auto-rotated due to oversized transcript. */
  onSessionRotated?: (info: { slug: string; chatId: string; transcriptBytes: number }) => void
}

function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  const s = (v: unknown, max = 80) => {
    const str = String(v ?? '')
    return str.length > max ? str.slice(0, max - 3) + '...' : str
  }
  if (name === 'Bash') return s(input.command ?? input.cmd ?? '')
  if (['Read', 'Write', 'Edit'].includes(name)) return s(input.file_path ?? input.path ?? '')
  if (name === 'WebFetch') return s(input.url ?? '')
  if (name === 'WebSearch') return s(input.query ?? '')
  if (name === 'Agent') return s(input.description ?? '', 60)
  const first = Object.values(input).find((v) => typeof v === 'string')
  return first ? s(first, 60) : ''
}

export class ClaudeProjectProcess implements ProjectProcess {
  readonly chatId: string
  readonly slug: string

  private readonly master: MasterMcpServer
  private readonly opts: ClaudeProjectProcessOptions
  private readonly log: (msg: string) => void
  private mcpConfigPath: string | null = null
  private tmuxSessionName: string | null = null
  private aliveCheckTimer: ReturnType<typeof setInterval> | null = null
  private transcriptWatcherTimer: ReturnType<typeof setInterval> | null = null
  private transcriptWatcherOffset = 0
  private transcriptWatcherPath: string | null = null
  private transcriptPendingTools = new Map<string, { toolName: string; inputSummary: string; startMs: number }>()
  private gitCredentialCleanup: (() => void) | null = null
  private _alive = false
  private _lastActivity = Date.now()
  private _pendingDeliverAt: number | null = null
  private spawnedAtMs: number | null = null
  private resumedSession = false
  private projectCwd: string | null = null
  private sessionIdPersisted = false
  private preSpawnSessionIds: Set<string> = new Set()
  /**
   * Cached session UUID for this spawn, populated lazily on first
   * successful `findNewSessionId` resolution. Read by `transcriptMtimeMs()`
   * so the watchdog veto works even when `.session-id` is not (yet) on
   * disk — `persistSessionAndRename` is one-shot at TUI-ready and can
   * lose the race with claude's first transcript write.
   */
  private observedSessionId: string | null = null
  private replyHandlers = new Set<(reply: OutboundReply) => void>()
  private toolProgressHandlers = new Set<(ev: ToolProgressEvent) => void>()
  private limitHitHandlers = new Set<(ev: LimitHitEvent) => void>()
  private lastLimitRaw: string | null = null
  private _lastContextWarnAt = 0
  private _latestInputTokens = 0
  private readonly turnHistory: number[] = []
  private exitHandlers = new Set<(info: { code: number | null; signal: NodeJS.Signals | null }) => void>()
  /** Goal text loaded from GOAL.md at session start; injected into the first delivery. */
  private goalText: string | null = null
  /** True after the first message has been sent this session (goal injection is one-shot). */
  private firstMessageSent = false
  private rotatedContextText: string | null = null
  private contextSnapshotPath: string | null = null

  constructor(opts: ClaudeProjectProcessOptions) {
    this.opts = opts
    this.chatId = opts.chatId
    this.slug = opts.slug
    this.master = opts.master
    this.log = opts.log ?? ((m) => process.stderr.write(`[claude:${opts.slug}] ${m}\n`))
  }

  async start(): Promise<void> {
    if (this._alive) throw new Error('ClaudeProjectProcess already started')

    const cwd = projectDir(this.slug)
    if (!existsSync(cwd)) throw new Error(`project working dir missing: ${cwd}`)

    // Set projectCwd BEFORE writeMcpConfig() — the latter reads
    // this.projectCwd to compute the project-level .mcp.json path
    // (line ~1098), and at the time of the call it was still null,
    // causing path.join(null, ...) to throw on every spawn.
    this.projectCwd = cwd

    // Load GOAL.md once at session start for first-message injection (P39).
    const goalPath = projectGoalFile(this.slug)
    try {
      if (existsSync(goalPath)) {
        const raw = readFileSync(goalPath, 'utf8').trim()
        if (raw) {
          this.goalText = raw.slice(0, 500)
          this.log(`goal loaded: ${this.goalText.length} chars`)
        }
      }
    } catch {
      // Non-fatal — proceed without goal injection.
    }

    const snapshotPath = join(projectDir(this.slug), '.session-context.md')
    try {
      if (existsSync(snapshotPath)) {
        this.rotatedContextText = readFileSync(snapshotPath, 'utf8').trim() || null
        this.contextSnapshotPath = snapshotPath
        if (this.rotatedContextText) this.log(`context snapshot loaded: ${this.rotatedContextText.length} chars`)
      }
    } catch {
      // Non-fatal.
    }

    this.firstMessageSent = false

    this.mcpConfigPath = this.writeMcpConfig()

    const claudeArgs = this.opts.claudeArgs ?? {}
    const argv: string[] = [this.opts.claudeBin ?? 'claude']
    argv.push('--mcp-config', this.mcpConfigPath)
    // Without this, the auto-loaded upstream claude-plugins-official Discord
    // plugin still installs its `mcp__discord__reply` tool and Claude often
    // picks that one over our `mcp__mcd__reply` — and it then refuses with
    // "channel not allowlisted" because the upstream's access.json is for a
    // different bot. --strict-mcp-config restricts MCP servers to ONLY the
    // ones we provide via --mcp-config above.
    argv.push('--strict-mcp-config')

    // When routing to a third-party provider (MiniMax, etc.), the
    // operator's Claude Code OAuth token coexists with our ANTHROPIC_API_KEY
    // env override. Claude prints "Auth conflict: Both a token (claude.ai)
    // and an API key (ANTHROPIC_API_KEY) are set" and defaults to OAuth —
    // so calls go to Anthropic instead of the provider. --bare forces
    // strict API-key auth (OAuth and keychain are never read). It also
    // disables CLAUDE.md auto-discovery, so we re-add the project dir
    // explicitly via --add-dir.
    //
    // Subscription-auth projects (no provider override) skip --bare to
    // preserve hooks, auto-memory, plugin sync, etc.
    if (this.opts.provider) {
      argv.push('--bare')
      argv.push('--add-dir', cwd)
    }

    argv.push('--permission-mode', claudeArgs.permissionMode ?? 'auto')
    if (this.opts.model) argv.push('--model', this.opts.model)
    if (claudeArgs.allowedTools?.length) argv.push('--allowed-tools', claudeArgs.allowedTools.join(','))
    if (claudeArgs.disallowedTools?.length) argv.push('--disallowed-tools', claudeArgs.disallowedTools.join(','))
    const sessionId = this.readSessionId()
    if (sessionId) {
      argv.push('--resume', sessionId)
      this.log(`resuming session ${sessionId}`)
    }
    // Remember whether we're resuming for first-turn bookkeeping below.
    this.resumedSession = !!sessionId
    // Snapshot the current set of session jsonl files BEFORE we hand
    // control to tmux. After waitForTuiReady we use this to identify
    // which UUID belongs to *this* spawn rather than picking whatever
    // happens to be newest by mtime (which can be a stale session from
    // a prior run — see #5).
    this.preSpawnSessionIds = listSessionIds(cwd)
    if (claudeArgs.extraArgs?.length) argv.push(...claudeArgs.extraArgs)

    const cmd = argv.map(shellEscape).join(' ')
    const sessionName = `mcd-${this.slug}-${Date.now().toString(36)}`
    this.tmuxSessionName = sessionName

    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' })

    // Track env vars we want to land on the pane process. tmux's
    // long-running server is the actual parent of the pane, and it
    // ignores the `env` we pass to `spawnSync('tmux', ...)`. The only
    // reliable way to inject is `tmux new-session -e KEY=VAL` flags.
    // Build the list explicitly so we don't dump every var we have.
    const tmuxEnvFlags: string[] = []
    const addEnv = (key: string, val: string | undefined) => {
      if (val === undefined) return
      tmuxEnvFlags.push('-e', `${key}=${val}`)
    }

    // claude probes isTTY via TERM. When the bot runs under launchd or
    // systemd, TERM isn't set in the service env, and once the tmux
    // daemon has been started without TERM it persists (often for hours,
    // owned by PID 1 after the bot exits). Passing -e per session is the
    // only way to guarantee claude sees a TTY regardless of daemon state.
    addEnv('TERM', process.env.TERM || 'xterm-256color')

    // Provider routing: when set, point claude's API client at a third
    // party Anthropic-compatible endpoint (e.g. MiniMax). Without this,
    // claude uses the operator's stored Claude Code OAuth.
    if (this.opts.provider) {
      addEnv('ANTHROPIC_BASE_URL', this.opts.provider.baseUrl)
      addEnv('ANTHROPIC_API_KEY', this.opts.provider.apiKey)
      this.log(`provider override: ${this.opts.provider.name ?? '(unnamed)'} → ${this.opts.provider.baseUrl}`)
    }

    if (this.opts.gitCredential) {
      try {
        const creds = loadCredentials()
        const cred: Credential = getCredential(creds, this.opts.gitCredential)
        const built = buildGitEnv(cred, process.env)
        for (const [k, v] of Object.entries(built.env)) {
          // Only add the keys buildGitEnv actually injected (vs the
          // entire process.env it copied from). Detect by comparing
          // against process.env's value — diff-only.
          if (process.env[k] !== v) addEnv(k, v)
        }
        this.gitCredentialCleanup = built.cleanup
      } catch (err) {
        this.log(`gitCredential resolve failed: ${(err as Error).message}`)
      }
    }

    // Operator-defined env passthrough from ~/.config/multi-channel-discord/env
    // (overridable via MCD_USER_ENV_FILE). Injects any KEY=VAL entries
    // into the pane env so spawned Claude sessions can see them — e.g.
    // OPENAI_API_KEY, ANTHROPIC_API_KEY for a non-routed provider, etc.
    // Skipped if the file is missing. If it's present but has bad mode
    // or parse issues, log and continue — don't fail the spawn.
    try {
      const userEnv = loadUserEnv()
      let injected = 0
      for (const [k, v] of Object.entries(userEnv)) {
        // process.env wins. This prevents the file from clobbering
        // values the bot was launched with (e.g. ANTHROPIC_API_KEY
        // set on the service for a routed provider).
        if (process.env[k] !== undefined) continue
        addEnv(k, v)
        injected += 1
      }
      if (injected > 0) this.log(`user-env: injected ${injected} key(s) from ${process.env.MCD_USER_ENV_FILE ?? '~/.config/multi-channel-discord/env'}`)
    } catch (err) {
      if (err instanceof UserEnvError) {
        this.log(`user-env: ${err.message} (skipping)`)
      } else {
        this.log(`user-env: unexpected error: ${(err as Error).message} (skipping)`)
      }
    }

    this.log(`tmux new-session -d -s ${sessionName} '${cmd}' (cwd=${cwd}, env+=${tmuxEnvFlags.length / 2})`)
    const result = spawnSync(
      'tmux',
      [
        'new-session',
        '-d',
        ...tmuxEnvFlags,
        '-s',
        sessionName,
        '-x',
        '200',
        '-y',
        '50',
        '-c',
        cwd,
        cmd,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    )
    if (result.status !== 0) {
      const err = result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.status}`
      throw new Error(`tmux new-session failed: ${err}`)
    }
    // Keep the pane around after claude exits so a post-mortem capture-pane
    // can show what claude printed before dying. Without remain-on-exit the
    // session disappears and we lose all diagnostic output.
    spawnSync('tmux', ['set-option', '-t', sessionName, 'remain-on-exit', 'on'], { stdio: 'ignore' })

    this._alive = true
    this._lastActivity = Date.now()
    this.spawnedAtMs = Date.now()
    this.startAliveCheck()
    this.startTranscriptWatcher()
  }

  lastActivityMs(): number {
    return this._lastActivity
  }

  pendingDeliverAtMs(): number | null {
    return this._pendingDeliverAt
  }

  /**
   * Wall-clock ms of the most recent write to the session transcript .jsonl.
   * Returns null when the session id has not yet been captured (pre-first-turn),
   * the transcript file does not exist, or stat throws. Cheap — one statSync.
   * Used by the pool's stuck-watchdog as a veto signal: a healthy agent doing
   * long internal work (parallel subagents, big bash) still appends tool_use /
   * tool_result entries every few hundred ms, so a fresh mtime overrides the
   * "no reply tool fired in 5 min" kill.
   */
  transcriptMtimeMs(): number | null {
    if (!this.projectCwd) return null
    const sessionId = this.resolveSessionId()
    if (!sessionId) return null
    const transcriptPath = join(
      homedir(),
      '.claude',
      'projects',
      encodeProjectCwd(this.projectCwd),
      `${sessionId}.jsonl`,
    )
    try {
      return statSync(transcriptPath).mtimeMs
    } catch {
      return null
    }
  }

  /**
   * Resolve the session UUID for *this* spawn, in priority order:
   *   1. In-memory cache (populated once we've observed it).
   *   2. `.session-id` on disk (set by `persistSessionAndRename` for fresh
   *      spawns, or pre-existing for resumed spawns).
   *   3. Diff `<transcript-dir>` against `preSpawnSessionIds` — the same
   *      logic `findNewSessionId` uses. Catches the case where
   *      `persistSessionAndRename` lost the race with claude's first
   *      transcript write and never re-ran.
   *
   * Returns null when the spawn has not yet produced any transcript file
   * (very early after spawn, before claude's first append).
   */
  private resolveSessionId(): string | null {
    if (this.observedSessionId) return this.observedSessionId
    const sessionFile = projectSessionFile(this.slug)
    try {
      const persisted = readFileSync(sessionFile, 'utf8').trim()
      if (persisted) {
        this.observedSessionId = persisted
        return persisted
      }
    } catch {
      // .session-id missing — fall through to snapshot diff.
    }
    if (!this.projectCwd) return null
    const id = findNewSessionId(this.projectCwd, this.preSpawnSessionIds)
    if (id) this.observedSessionId = id
    return id
  }

  isAlive(): boolean {
    return this._alive
  }

  /**
   * Synchronous capture-pane check: returns true only if the pane shows
   * the live `❯` prompt + auto-mode footer. Stronger than `isAlive()`,
   * which only verifies the tmux session exists. A subprocess whose TUI
   * never rendered (e.g. malformed `~/.claude/settings.json` aborts the
   * `claude` CLI before Ink draws anything) passes `isAlive()` but fails
   * `isResponsive()`.
   *
   * Cheap (~5ms) — used by the pool's stuck-watchdog and as a pre-send
   * sanity check inside `deliver()`.
   */
  isResponsive(): boolean {
    if (!this._alive || !this.tmuxSessionName) return false
    const r = spawnSync('tmux', ['capture-pane', '-p', '-t', this.tmuxSessionName], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (r.status !== 0) return false
    const pane = r.stdout?.toString() ?? ''
    return pane.includes('❯') && pane.includes('auto mode on')
  }

  /**
   * Find the claude pid inside our tmux session and read /proc for
   * cpu time, memory, and uptime. POSIX-only (relies on /proc); Windows
   * operators won't get stats but the call won't throw.
   */
  async getStats(): Promise<{ pid: number | null; cpuTimeMs?: number; memoryMb?: number; uptimeMs?: number } | null> {
    if (!this._alive || !this.tmuxSessionName) return null
    const r = spawnSync(
      'tmux',
      ['list-panes', '-t', this.tmuxSessionName, '-F', '#{pane_pid}'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (r.status !== 0) return null
    const panePid = parseInt(r.stdout.toString().trim().split('\n')[0]!, 10)
    if (!Number.isFinite(panePid)) return null

    // Walk children for the actual claude pid (the pane usually wraps
    // it under /bin/sh -c).
    const claudePid = findClaudeChild(panePid) ?? panePid
    return readProcStats(claudePid)
  }

  /**
   * Inject a Discord message into the running interactive claude as if the
   * operator typed it.
   *
   * Critical timing detail: if this fires while claude's TUI is still
   * booting, the text lands but the Enter keystroke is silently dropped
   * (the input handler isn't bound yet). So we poll the pane for the
   * prompt-ready marker before sending. After the first message lands,
   * subsequent deliveries skip the wait — fast path.
   */
  async deliver(envelope: InboundEnvelope): Promise<void> {
    if (!this._alive || !this.tmuxSessionName) {
      throw new Error(`deliver() called on dead ClaudeProjectProcess ${this.slug}`)
    }
    const at = Date.now()
    this._lastActivity = at
    if (this._pendingDeliverAt === null) this._pendingDeliverAt = at
    this.log(`deliver msg_id=${envelope.messageId} ts=${envelope.ts}`)

    const session = this.tmuxSessionName

    // First-message wait: the spawned `claude` may still be booting. A
    // failure here means the TUI never came up (malformed ~/.claude/settings.json,
    // login required, plugin install hang, …). Surface to Discord and
    // tear down so the next message respawns clean.
    if (!this.tuiReady) {
      const ok = await this.waitForTuiReady(session)
      if (!ok) {
        await this.handleTuiFailure(envelope, 'startup')
        return
      }
      this.tuiReady = true
      // First-turn-only: capture the session UUID claude opened in its
      // transcript dir so the NEXT spawn can `--resume` it (the actual
      // wiring uses readSessionId() at start()). Also send /rename so
      // operators see `mcd-<slug>` in `claude --resume` pickers instead
      // of a UUID. Only do the rename for fresh spawns — resumed ones
      // already carry the name from their prior life.
      await this.persistSessionAndRename(session)
    } else if (!this.isResponsive()) {
      // Pane regression: the cached `tuiReady = true` is no longer
      // truthful. Re-enter the wait so we don't `send-keys` into a
      // crashed/dialog-blocked pane. If it still won't come back, fail
      // loudly rather than silently dropping the message.
      this.log('pane regressed off prompt — re-validating before send')
      this.tuiReady = false
      const ok = await this.waitForTuiReady(session)
      if (!ok) {
        await this.handleTuiFailure(envelope, 'regression')
        return
      }
      this.tuiReady = true
    }

    // Retry session-id capture on every deliver until it lands. The
    // transcript file may not exist yet at TUI-ready time (race with
    // claude's first write), so the first attempt in persistSessionAndRename
    // can return without capturing. Resumed spawns are guarded inside.
    if (!this.sessionIdPersisted) {
      await this.persistSessionAndRename(session)
    }

    // Stateless mode now — there's no persistent MCP session to wait on.
    // The TUI prompt being up is our readiness signal; claude eagerly
    // connects --mcp-config servers at startup, so the handshake has
    // already happened by the time the user prompt renders.
    await this.master.waitForChatReady(this.chatId)

    const text = this.formatPrompt(envelope)

    const sendText = spawnSync('tmux', ['send-keys', '-t', session, '-l', text], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (sendText.status !== 0) {
      this.log(`send-keys (literal) failed: ${sendText.stderr.toString().trim()}`)
      return
    }

    // Give Ink time to process and re-render the input buffer before
    // submitting. 120ms caused a race where C-m arrived before characters
    // landed in Ink's input state, submitting partial/empty turns.
    await sleep(500)
    const sendEnter = spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (sendEnter.status !== 0) {
      this.log(`send-keys (C-m) failed: ${sendEnter.stderr.toString().trim()}`)
    }
  }

  /**
   * After the first successful `waitForTuiReady` of a fresh spawn,
   * persist Claude Code's session UUID so the next spawn can `--resume`
   * it, and fire `/rename mcd-<slug>` so operators see the project name
   * in `claude --resume` pickers. Idempotent — guarded by
   * `sessionIdPersisted`. Resumed spawns skip both: their `.session-id`
   * is already current, and they inherit the previous rename. Failures
   * are non-fatal — the worst case is we lose memory continuity for one
   * cycle, which is exactly the pre-fix behaviour.
   */
  private async persistSessionAndRename(session: string): Promise<void> {
    if (this.sessionIdPersisted) return
    if (this.resumedSession) {
      // No-op for resumed spawns. Still mark persisted so we don't keep
      // re-checking on every turn.
      this.sessionIdPersisted = true
      return
    }
    if (!this.projectCwd) {
      this.sessionIdPersisted = true
      return
    }

    // Retry up to 6× (3s) in case claude's first transcript write races with TUI-ready.
    let sid: string | null = null
    for (let attempt = 0; attempt < 6; attempt++) {
      sid = findNewSessionId(this.projectCwd, this.preSpawnSessionIds)
      if (sid) break
      if (attempt < 5) await sleep(500)
    }
    if (!sid) {
      this.log(`session-id capture: no new transcript file after retries for cwd=${this.projectCwd} (pre-spawn snapshot had ${this.preSpawnSessionIds.size} entries) — resume unavailable`)
      // Don't mark persisted — try again next deliver in case the
      // transcript was just slow to land.
      return
    }
    try {
      writeFileSync(projectSessionFile(this.slug), sid, { mode: 0o600 })
      this.log(`session-id captured: ${sid}`)
    } catch (err) {
      this.log(`session-id write failed: ${(err as Error).message}`)
      return
    }
    this.sessionIdPersisted = true

    // Cosmetic rename so the resume picker shows a readable label. The
    // slash command is consumed immediately by claude's input handler;
    // we give Ink a beat to render before sending the real user prompt.
    const renameTo = `mcd-${this.slug}`
    spawnSync('tmux', ['send-keys', '-t', session, '-l', `/rename ${renameTo}`], { stdio: 'ignore' })
    await sleep(500)
    spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
    await sleep(500)
    this.log(`renamed session → ${renameTo}`)
  }

  /**
   * Common path when waitForTuiReady gives up — at startup or after a
   * mid-life regression. Posts an error to Discord (synthetic reply) and
   * tears the session down, exiting with TUI_FAILURE_EXIT_CODE so the
   * pool's onExit emits a `crashed` event the operator can act on.
   */
  private async handleTuiFailure(
    envelope: InboundEnvelope,
    cause: 'startup' | 'regression',
  ): Promise<void> {
    this.log(`TUI not ready (${cause}) — dropping message ${envelope.messageId} and tearing down`)
    const text =
      cause === 'startup'
        ? `❌ \`${this.slug}\`: agent failed to start (TUI did not render in 30s). ` +
          'Check `~/.claude/settings.json` for syntax errors, then send another message to retry.'
        : `❌ \`${this.slug}\`: agent stopped responding (pane regressed off prompt). ` +
          'Tearing down — send another message to respawn.'
    const reply: OutboundReply = {
      kind: 'text',
      chatId: this.chatId,
      text,
      replyTo: envelope.messageId,
    }
    for (const h of this.replyHandlers) {
      try {
        h(reply)
      } catch (err) {
        this.log(`replyHandler threw during TUI-failure notify: ${(err as Error).message}`)
      }
    }
    if (this._alive && this.tmuxSessionName) {
      spawnSync('tmux', ['kill-session', '-t', this.tmuxSessionName], { stdio: 'ignore' })
    }
    this.markDead(TUI_FAILURE_EXIT_CODE, null)
  }

  private tuiReady = false
  private dismissedMcpDialog = false
  private dismissedApiKeyDialog = false
  private dismissedSettingsDialog = false
  private dismissedFullscreenRendererDialog = false

  /**
   * Poll the tmux pane for claude's prompt-ready marker (the `❯` cursor
   * line + the auto-mode footer). Returns true once seen, false on
   * timeout. Spawn → TUI ready can take 3-15s depending on plugin warmup.
   *
   * Two interactive dialogs can pre-empt the input prompt and need
   * dismissal: workspace-trust (claude's first-run check that the cwd
   * is trusted) and MCP-discovery (when a .mcp.json sits in the cwd —
   * common for cloned repos that ship their own MCP setup). For the
   * MCP dialog we choose option `3` ("Continue without using this MCP
   * server"); --strict-mcp-config means claude wasn't going to load
   * those servers anyway. For the workspace-trust dialog we send Enter
   * to accept the default (trust this folder).
   */
  private async waitForTuiReady(session: string, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const r = spawnSync('tmux', ['capture-pane', '-p', '-t', session], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const pane = r.stdout?.toString() ?? ''

      if (pane.includes('❯') && pane.includes('auto mode on')) {
        return true
      }

      // Auto-dismiss .mcp.json discovery dialog.
      if (!this.dismissedMcpDialog && (pane.includes('New MCP server found in .mcp.json') || pane.includes('New MCP server found in this project'))) {
        this.log('detected .mcp.json discovery dialog — sending 3 + Enter to skip')
        spawnSync('tmux', ['send-keys', '-t', session, '3'], { stdio: 'ignore' })
        await sleep(120)
        spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
        this.dismissedMcpDialog = true
        await sleep(800)
        continue
      }

      // Auto-dismiss the "Detected a custom API key" dialog. When the
      // operator deliberately set ANTHROPIC_API_KEY for provider routing
      // (MiniMax / Bedrock / etc.) we DO want to use it. Default is "No
      // (recommended)" — pick "1" (Yes).
      if (
        !this.dismissedApiKeyDialog &&
        pane.includes('Detected a custom API key') &&
        pane.includes('ANTHROPIC_API_KEY')
      ) {
        this.log('detected custom-API-key dialog — sending 1 + Enter to use it')
        spawnSync('tmux', ['send-keys', '-t', session, '1'], { stdio: 'ignore' })
        await sleep(120)
        spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
        this.dismissedApiKeyDialog = true
        await sleep(800)
        continue
      }

      // Auto-accept workspace-trust dialog if it appears.
      if (pane.match(/Do you trust the files in this folder\?|Trust this workspace/i)) {
        this.log('detected workspace-trust dialog — pressing Enter to accept')
        spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
        await sleep(800)
        continue
      }

      // Auto-dismiss the "Settings Warning" dialog that Claude shows when
      // ~/.claude/settings.json contains malformed rules (e.g. a wildcard
      // permission without a `Bash(` prefix). Claude still loads the rest
      // of the file, but the dialog blocks the prompt from rendering,
      // which makes the TUI-readiness check time out. Pick "1. Continue"
      // to unblock — operator should fix the rule in settings.json when
      // convenient, but we don't want a typo to brick every channel.
      if (
        !this.dismissedSettingsDialog &&
        (pane.includes('Settings Warning') || pane.includes('Invalid permission rule')) &&
        pane.match(/1\.\s*Continue/)
      ) {
        this.log('detected settings warning dialog — sending 1 + Enter to continue')
        spawnSync('tmux', ['send-keys', '-t', session, '1'], { stdio: 'ignore' })
        await sleep(120)
        spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
        this.dismissedSettingsDialog = true
        await sleep(800)
        continue
      }

      // Auto-dismiss the "Try the new fullscreen renderer?" dialog that
      // Claude Code shows after auto-updating to a version that ships
      // the new renderer. Defaults to "1. Yes, try it", but in a bot
      // tmux pane the fullscreen renderer doesn't have room to render
      // (and breaks the pane-width heuristics the MCD bot relies on for
      // prompt detection). Pick "2. Not now" so the user keeps the
      // classic renderer — the question re-appears on the next launch
      // until they opt in interactively. Same dismissal pattern as the
      // other dialogs: send the option key + Enter, mark dismissed.
      if (
        !this.dismissedFullscreenRendererDialog &&
        pane.includes('Try the new fullscreen renderer') &&
        pane.match(/2\.\s*Not now/)
      ) {
        this.log('detected fullscreen-renderer prompt — sending 2 + Enter to defer')
        spawnSync('tmux', ['send-keys', '-t', session, '2'], { stdio: 'ignore' })
        await sleep(120)
        spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
        this.dismissedFullscreenRendererDialog = true
        await sleep(800)
        continue
      }

      await sleep(500)
    }
    return false
  }

  /**
   * Build the literal text we feed claude's prompt. The same `<channel
   * source="discord" ...>` envelope shape upstream uses, so the
   * per-project CLAUDE.md guidance ("respond by calling the reply tool")
   * stays in effect.
   */
  private checkContextWarning(): void {
    if (this._latestInputTokens === 0) return
    const thresholdPct = this.opts.contextWarningThresholdPct ?? 80
    const MODEL_CONTEXT_TOKENS = 200_000
    const thresholdTokens = Math.floor(MODEL_CONTEXT_TOKENS * thresholdPct / 100)
    if (this._latestInputTokens < thresholdTokens) return
    const COOLDOWN_MS = 10 * 60_000
    if (Date.now() - this._lastContextWarnAt < COOLDOWN_MS) return
    if (!this._alive || !this.tmuxSessionName) return
    this._lastContextWarnAt = Date.now()
    this.log(`context-warning: input_tokens=${this._latestInputTokens} >= ${thresholdTokens} (${thresholdPct}%), injecting compression prompt`)
    const prompt = 'Your context window is large. Please summarise completed work, close finished tasks, and compact your working memory before continuing.'
    const session = this.tmuxSessionName
    spawnSync('tmux', ['send-keys', '-t', session, '-l', prompt], { stdio: 'ignore' })
    spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], { stdio: 'ignore' })
    if (this.opts.onContextWarning) {
      try { this.opts.onContextWarning(this._latestInputTokens, thresholdPct) } catch {}
    }
  }

  /** Expose latest observed input token count for fleet reporting. */
  latestInputTokens(): number {
    return this._latestInputTokens
  }

  private formatPrompt(envelope: InboundEnvelope): string {
    // Attribute values and body come from the remote sender. Escape them so a
    // message body/username cannot close the envelope and forge a second
    // <channel user_id="<operator>"> envelope (prompt-injection breakout).
    const attr = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/[\r\n]/g, ' ')
    // Only the envelope tag itself is neutralized in the body so ordinary
    // markup/code in messages passes through untouched.
    const body = envelope.content.replace(/<(\/?)channel\b/gi, '&lt;$1channel')
    const meta = [
      `source="${this.opts.platform ?? 'discord'}"`,
      `chat_id="${this.chatId}"`,
      `message_id="${attr(envelope.messageId)}"`,
      `user="${attr(envelope.username)}"`,
      `user_id="${attr(envelope.userId)}"`,
      `ts="${attr(envelope.ts)}"`,
    ]
    if (envelope.attachments?.length) {
      meta.push(`attachment_count="${envelope.attachments.length}"`)
      meta.push(`attachments="${attr(envelope.attachments.join('; '))}"`)
    }
    const channelMsg = `<channel ${meta.join(' ')}>${body}</channel>`

    // Inject goal context and/or rotated session snapshot on the first message of each session start.
    if (!this.firstMessageSent) {
      this.firstMessageSent = true
      const prefix: string[] = []
      if (this.goalText) prefix.push(`<goal>${this.goalText}</goal>`)
      if (this.rotatedContextText) {
        prefix.push(this.rotatedContextText)
        if (this.contextSnapshotPath) {
          try { unlinkSync(this.contextSnapshotPath) } catch { /* non-fatal */ }
          this.contextSnapshotPath = null
        }
        this.rotatedContextText = null
      }
      if (prefix.length > 0) return `${prefix.join('\n')}\n${channelMsg}`
    }
    return channelMsg
  }

  onReply(handler: (reply: OutboundReply) => void): () => void {
    this.replyHandlers.add(handler)
    return () => this.replyHandlers.delete(handler)
  }

  onExit(handler: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): () => void {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }

  onToolProgress(handler: (ev: ToolProgressEvent) => void): () => void {
    this.toolProgressHandlers.add(handler)
    return () => this.toolProgressHandlers.delete(handler)
  }

  private fireToolProgress(ev: ToolProgressEvent): void {
    for (const h of this.toolProgressHandlers) {
      try { h(ev) } catch {}
    }
  }

  onLimitHit(handler: (ev: LimitHitEvent) => void): () => void {
    this.limitHitHandlers.add(handler)
    return () => this.limitHitHandlers.delete(handler)
  }

  private fireLimitHit(ev: LimitHitEvent): void {
    for (const h of this.limitHitHandlers) {
      try { h(ev) } catch {}
    }
  }

  private startTranscriptWatcher(): void {
    if (this.transcriptWatcherTimer) return
    const poll = () => {
      if (!this._alive || (this.toolProgressHandlers.size === 0 && this.limitHitHandlers.size === 0)) return
      const sessionId = this.resolveSessionId()
      if (!sessionId || !this.projectCwd) return
      const path = join(homedir(), '.claude', 'projects', encodeProjectCwd(this.projectCwd), `${sessionId}.jsonl`)
      if (path !== this.transcriptWatcherPath) {
        // Seek to end of existing transcript so we only emit tool calls from
        // new turns, not historical ones replayed from a --resume session.
        let currentSize = 0
        try { currentSize = statSync(path).size } catch { /* file not created yet */ }
        this.transcriptWatcherOffset = currentSize
        this.transcriptWatcherPath = path
        this.transcriptPendingTools.clear()
      }
      let fd: number
      try { fd = openSync(path, 'r') } catch { return }
      let chunk: string
      try {
        let size: number
        try { size = statSync(path).size } catch { return }
        if (size <= this.transcriptWatcherOffset) { return }
        const toRead = size - this.transcriptWatcherOffset
        const buf = Buffer.allocUnsafe(toRead)
        const bytesRead = readSync(fd, buf, 0, toRead, this.transcriptWatcherOffset)
        this.transcriptWatcherOffset += bytesRead
        chunk = buf.slice(0, bytesRead).toString('utf8')
      } finally {
        closeSync(fd)
      }
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let obj: Record<string, unknown>
        try { obj = JSON.parse(trimmed) as Record<string, unknown> } catch { continue }
        const rec = obj
        if ((rec as any).isApiErrorMessage === true && (rec as any).apiErrorStatus === 429) {
          const msg = (rec as any).message
          let text = ''
          if (typeof msg?.content === 'string') text = msg.content
          else if (Array.isArray(msg?.content)) text = msg.content.map((b: any) => b?.text ?? '').join(' ').trim()
          if (text && text !== this.lastLimitRaw) {
            this.lastLimitRaw = text
            this.fireLimitHit(parseLimitMessage(text))
          }
        }
        const msg = obj.message as { role?: string; content?: unknown[] } | undefined
        if (!msg) continue
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          // Track input_tokens for context-window saturation detection
          const usage = (obj as { message?: { usage?: { input_tokens?: number } } }).message?.usage
          if (usage?.input_tokens != null) {
            this._latestInputTokens = usage.input_tokens
          }
          for (const block of msg.content) {
            const b = block as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
            if (b.type === 'tool_use' && b.id && b.name) {
              const inputSummary = summarizeToolInput(b.name, b.input ?? {})
              this.transcriptPendingTools.set(b.id, { toolName: b.name, inputSummary, startMs: Date.now() })
              this.fireToolProgress({ phase: 'start', toolId: b.id, toolName: b.name, inputSummary })
            }
          }
        }
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            const b = block as { type?: string; tool_use_id?: string; is_error?: boolean }
            if (b.type === 'tool_result' && b.tool_use_id) {
              const info = this.transcriptPendingTools.get(b.tool_use_id)
              if (info) {
                const durationMs = Date.now() - info.startMs
                this.fireToolProgress({ phase: 'done', toolId: b.tool_use_id, toolName: info.toolName, durationMs, isError: b.is_error === true })
                this.transcriptPendingTools.delete(b.tool_use_id)
              }
            }
          }
        }
      }
      // Context saturation check — after processing all new lines
      this.checkContextWarning()
    }
    this.transcriptWatcherTimer = setInterval(poll, 2_000)
    if (typeof this.transcriptWatcherTimer.unref === 'function') this.transcriptWatcherTimer.unref()
  }

  /**
   * Called by ProjectPool.acceptReply when the master MCP server emits a
   * reply tool call from this chat's session. We bump activity and fan
   * out to local subscribers (the pool's onReply sink already covers
   * Discord delivery — this hook is for additional observers).
   */
  acceptReply(reply: OutboundReply): void {
    const now = Date.now()
    if (this._pendingDeliverAt !== null) {
      const duration = now - this._pendingDeliverAt
      this.turnHistory.push(duration)
      if (this.turnHistory.length > MAX_TURN_HISTORY) this.turnHistory.shift()
    }
    this._lastActivity = now
    this._pendingDeliverAt = null
    for (const h of this.replyHandlers) h(reply)
  }

  adaptiveThresholdMs(baseMs: number): number {
    if (this.turnHistory.length === 0) return baseMs
    const maxTurn = Math.max(...this.turnHistory)
    return Math.min(MAX_ADAPTIVE_THRESHOLD_MS, Math.max(baseMs, Math.ceil(maxTurn * ADAPTIVE_MULTIPLIER)))
  }

  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested' | 'watchdog'): Promise<void> {
    if (!this._alive || !this.tmuxSessionName) return
    const session = this.tmuxSessionName
    this.log(`kill (${reason}) — tmux kill-session -t ${session}`)
    // Best-effort session-id capture before teardown (FR2).
    if (reason === 'watchdog' && !this.sessionIdPersisted && this.projectCwd && this.preSpawnSessionIds.size > 0) {
      const sid = findNewSessionId(this.projectCwd, this.preSpawnSessionIds)
      if (sid) {
        const sessionFile = projectSessionFile(this.slug)
        try {
          if (!existsSync(sessionFile)) {
            writeFileSync(sessionFile, sid, { mode: 0o600 })
            this.log(`session-id captured at kill time: ${sid}`)
            this.sessionIdPersisted = true
            this.observedSessionId = sid
          }
        } catch { /* non-fatal */ }
      }
    }
    const result = spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' })
    if (result.status !== 0) {
      this.log(`kill-session non-zero (${result.status}) — assuming already dead`)
    }
    this.markDead(0, null)

    // Persist watchdog kill event so /watchdog-kills can surface history.
    if (reason === 'watchdog') {
      this.appendWatchdogKill()
    }

    // Fire background distillation if configured (P38). Non-blocking.
    if (this.opts.distillOnStop && this.projectCwd) {
      const cwd = this.projectCwd
      const claudeBin = this.opts.claudeBin ?? 'claude'
      const onComplete = this.opts.onDistillationComplete
      runDistillation({ slug: this.slug, cwd, claudeBin, log: this.log, onComplete }).catch(() => {})
    }
  }

  private appendWatchdogKill(): void {
    try {
      const mcdDir = process.env.MCD_CHANNELS_DIR
      if (!mcdDir) return
      const lastToolCall = (() => {
        // Pick the most recently started tool that hasn't completed
        let latest: { toolName: string; startMs: number } | null = null
        for (const v of this.transcriptPendingTools.values()) {
          if (!latest || v.startMs > latest.startMs) latest = v
        }
        // Fall back to most recently seen tool_use in pending map (startMs-sorted)
        if (!latest && this.transcriptPendingTools.size > 0) {
          latest = [...this.transcriptPendingTools.values()].sort((a, b) => b.startMs - a.startMs)[0]!
        }
        return latest?.toolName ?? null
      })()
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        slug: this.slug,
        runtimeMs: this.spawnedAtMs !== null ? Date.now() - this.spawnedAtMs : null,
        lastToolCall,
        reason: 'watchdog',
      }) + '\n'
      const logPath = join(mcdDir, 'projects', this.slug, 'watchdog-kills.jsonl')
      appendFileSync(logPath, entry)
    } catch {
      // Non-fatal — never let kill log failure block the kill itself
    }
  }

  private notifyCrash(reason: string): void {
    const reply: OutboundReply = {
      kind: 'text',
      chatId: this.chatId,
      text: `⚠️ \`${this.slug}\`: ${reason} — respawning on next message`,
    }
    for (const h of this.replyHandlers) {
      try { h(reply) } catch {}
    }
  }

  private startAliveCheck(): void {
    if (this.aliveCheckTimer) return
    this.aliveCheckTimer = setInterval(() => {
      if (!this._alive || !this.tmuxSessionName) return
      const r = spawnSync('tmux', ['has-session', '-t', this.tmuxSessionName], { stdio: 'ignore' })
      if (r.status !== 0) {
        this.log(`tmux session ${this.tmuxSessionName} gone — marking dead`)
        this.notifyCrash('tmux session disappeared')
        this.markDead(null, null)
        return
      }
      // Detect "pane dead, session still here" via remain-on-exit. Capture
      // the pane scrollback so the operator can see what claude printed
      // before crashing — this is the most useful diagnostic when claude
      // exits during startup (auth dialog, malformed settings, etc.).
      const dead = spawnSync('tmux', ['display-message', '-p', '-t', this.tmuxSessionName, '#{pane_dead}'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (dead.stdout?.toString().trim() === '1') {
        const cap = spawnSync('tmux', ['capture-pane', '-p', '-S', '-200', '-t', this.tmuxSessionName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        const pane = cap.stdout?.toString().trim() ?? '(empty)'
        this.log(`claude pane died — last output:\n${pane}`)
        spawnSync('tmux', ['kill-session', '-t', this.tmuxSessionName], { stdio: 'ignore' })
        this.notifyCrash('claude process exited unexpectedly')
        this.markDead(null, null)
      }
    }, TMUX_POLL_INTERVAL_MS)
    if (typeof this.aliveCheckTimer.unref === 'function') this.aliveCheckTimer.unref()
  }

  private markDead(code: number | null, signal: NodeJS.Signals | null): void {
    if (!this._alive) return
    this._alive = false
    if (this.aliveCheckTimer) {
      clearInterval(this.aliveCheckTimer)
      this.aliveCheckTimer = null
    }
    if (this.transcriptWatcherTimer) {
      clearInterval(this.transcriptWatcherTimer)
      this.transcriptWatcherTimer = null
    }
    if (this.gitCredentialCleanup) {
      try {
        this.gitCredentialCleanup()
      } catch {}
      this.gitCredentialCleanup = null
    }
    void this.master.closeChat(this.chatId)
    for (const h of this.exitHandlers) h({ code, signal })
  }

  private writeMcpConfig(): string {
    const dir = mkdtempSync(join(tmpdir(), `mcd-${this.slug}-`))
    const path = join(dir, 'mcp-config.json')
    // Server name must NOT collide with the auto-loaded upstream
    // claude-plugins-official Discord plugin (which is also "discord").
    // Without this rename Claude can't tell the two `reply` tools apart
    // and consistently picked the upstream one — which then refused with
    // "channel not allowlisted" because its access.json belongs to the
    // OLD bot.
    const config: { mcpServers: Record<string, unknown> } = {
      mcpServers: {
        mcd: {
          type: 'http',
          url: this.master.urlFor(this.chatId),
          headers: { 'x-mcd-token': this.master.tokenFor(this.chatId) },
        },
      },
    }
    // Merge project-level .mcp.json servers so projects that declare their
    // own MCP tools (e.g. a remote API server) still get them even under
    // --strict-mcp-config. Skip any server named "discord" to avoid
    // colliding with the upstream plugin. Guard projectCwd defensively
    // even though start() now sets it before calling writeMcpConfig() —
    // class field type is `string | null` so TS can't narrow it here.
    if (!this.projectCwd) {
      this.log('writeMcpConfig: projectCwd unset, skipping project .mcp.json merge')
    } else {
      const projectMcpPath = join(this.projectCwd, '.mcp.json')
      if (existsSync(projectMcpPath)) {
        try {
          const projectMcp = JSON.parse(readFileSync(projectMcpPath, 'utf8')) as {
            mcpServers?: Record<string, unknown>
          }
          for (const [name, server] of Object.entries(projectMcp.mcpServers ?? {})) {
            if (name === 'discord') continue // reserved — would shadow the upstream plugin
            if (name === 'mcd') continue // reserved — our own server
            config.mcpServers[name] = server
          }
          this.log(`merged ${Object.keys(projectMcp.mcpServers ?? {}).length} server(s) from project .mcp.json`)
        } catch (err) {
          this.log(`failed to parse project .mcp.json: ${(err as Error).message}`)
        }
      }
    }
    writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
    return path
  }

  private extractContextSnapshot(transcriptPath: string, sizeBytes: number): void {
    try {
      const raw = readFileSync(transcriptPath, 'utf8')
      const lines = raw.split('\n').filter(l => l.trim())
      const userMsgs: string[] = []
      const assistantSnippets: string[] = []
      for (let i = lines.length - 1; i >= 0; i--) {
        if (userMsgs.length >= 10 && assistantSnippets.length >= 3) break
        try {
          const d = JSON.parse(lines[i]!)
          const role = d.role ?? d.message?.role
          const content = d.message?.content ?? d.content
          if (role === 'user' && userMsgs.length < 10 && typeof content === 'string') {
            const inner = content.replace(/^<channel[^>]*>/, '').replace(/<\/channel>$/, '').trim()
            if (inner) userMsgs.unshift(inner.slice(0, 150))
          } else if (role === 'assistant' && assistantSnippets.length < 3) {
            const arr = Array.isArray(content) ? content : []
            const text = arr.find((c: {type?: string}) => c?.type === 'text')?.text ?? ''
            if (text) assistantSnippets.unshift(text.slice(0, 200))
          }
        } catch { /* skip malformed line */ }
      }
      if (userMsgs.length === 0 && assistantSnippets.length === 0) return
      const parts = [
        `[auto] Prior session context (rotated at ${Math.round(sizeBytes / 1024)} KB):`,
        '',
        'Recent operator messages:',
        ...userMsgs.map(m => `- ${m}`),
        '',
        'Last assistant replies:',
        ...assistantSnippets.map(s => `- ${s}`),
      ]
      const snapshot = parts.join('\n').slice(0, 2000)
      const snapshotPath = join(projectDir(this.slug), '.session-context.md')
      writeFileSync(snapshotPath, snapshot)
      this.rotatedContextText = snapshot
      this.contextSnapshotPath = snapshotPath
      this.log(`context snapshot written: ${snapshot.length} chars`)
    } catch (err) {
      this.log(`context snapshot extraction failed: ${(err as Error).message}`)
    }
  }

  private readSessionId(): string | undefined {
    const path = projectSessionFile(this.slug)
    if (!existsSync(path)) return undefined
    let id: string
    try {
      id = readFileSync(path, 'utf8').trim()
    } catch {
      return undefined
    }
    if (id.length === 0) return undefined

    // Refuse resumes onto bloated transcripts. The replay is what hangs
    // claude — a 1.7MB jsonl in academy-videos was looping the entire
    // pool through the stuck-watchdog before this gate existed.
    const transcriptPath = join(
      homedir(),
      '.claude',
      'projects',
      encodeProjectCwd(projectDir(this.slug)),
      `${id}.jsonl`,
    )
    let size: number
    try {
      size = statSync(transcriptPath).size
    } catch {
      // Transcript not found — the resume id is stale (e.g. ~/.claude
      // wiped). Honor it anyway; if claude rejects it the spawn falls
      // through to the existing TUI-failure handling.
      return id
    }
    const threshold = this.opts.sessionRotateThresholdBytes ?? RESUME_TRANSCRIPT_MAX_BYTES
    if (size > threshold) {
      this.extractContextSnapshot(transcriptPath, size)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const rotated = `${path}.rotated-${stamp}`
      try {
        renameSync(path, rotated)
        this.log(`resume refused: transcript ${size} bytes > ${threshold}; rotated .session-id → ${rotated}`)
      } catch (err) {
        this.log(`resume refused but rotate failed: ${(err as Error).message}`)
      }
      this.opts.onSessionRotated?.({ slug: this.slug, chatId: this.chatId, transcriptBytes: size })
      return undefined
    }
    return id
  }
}
