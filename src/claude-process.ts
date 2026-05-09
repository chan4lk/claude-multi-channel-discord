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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { ClaudeArgs } from './channels-config.ts'
import type { MasterMcpServer } from './master-mcp-server.ts'
import { projectDir, projectSessionFile } from './paths.ts'
import { buildGitEnv, type GitResult as _GitResultUnused } from './git-ops.ts'
import { getCredential, loadCredentials, type Credential } from './git-credentials.ts'
import type {
  InboundEnvelope,
  OutboundReply,
  ProjectProcess,
} from './project-process.ts'

const TMUX_POLL_INTERVAL_MS = 5_000

/**
 * Shell-escape a single argv entry for use inside a `tmux new-session ... '<cmd>'`
 * string. Single-quote everything; embedded single quotes become `'\''`.
 */
function shellEscape(arg: string): string {
  if (/^[A-Za-z0-9_\-./=:]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

export interface ClaudeProjectProcessOptions {
  chatId: string
  slug: string
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
  /** Override `claude` binary path. Falls back to PATH lookup. */
  claudeBin?: string
  /** Diagnostics. Defaults to stderr with a slug prefix. */
  log?: (msg: string) => void
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
  private gitCredentialCleanup: (() => void) | null = null
  private _alive = false
  private _lastActivity = Date.now()
  private replyHandlers = new Set<(reply: OutboundReply) => void>()
  private exitHandlers = new Set<(info: { code: number | null; signal: NodeJS.Signals | null }) => void>()

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
    argv.push('--permission-mode', claudeArgs.permissionMode ?? 'auto')
    if (this.opts.model) argv.push('--model', this.opts.model)
    if (claudeArgs.allowedTools?.length) argv.push('--allowed-tools', claudeArgs.allowedTools.join(','))
    if (claudeArgs.disallowedTools?.length) argv.push('--disallowed-tools', claudeArgs.disallowedTools.join(','))
    const sessionId = this.readSessionId()
    if (sessionId) argv.push('--resume', sessionId)
    if (claudeArgs.extraArgs?.length) argv.push(...claudeArgs.extraArgs)

    const cmd = argv.map(shellEscape).join(' ')
    const sessionName = `mcd-${this.slug}-${Date.now().toString(36)}`
    this.tmuxSessionName = sessionName

    spawnSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'ignore' })

    // Build the env block tmux gives the new session — and through that,
    // the claude subprocess and any `git`/`gh` calls it makes via Bash.
    let spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    if (this.opts.gitCredential) {
      try {
        const creds = loadCredentials()
        const cred: Credential = getCredential(creds, this.opts.gitCredential)
        const built = buildGitEnv(cred, spawnEnv)
        spawnEnv = built.env
        // We can't easily clean up the askpass tmpfile across the
        // subprocess's lifetime — leave it; it's mode 0700 in tmpdir.
        this.gitCredentialCleanup = built.cleanup
      } catch (err) {
        this.log(`gitCredential resolve failed: ${(err as Error).message}`)
      }
    }

    this.log(`tmux new-session -d -s ${sessionName} '${cmd}' (cwd=${cwd})`)
    const result = spawnSync(
      'tmux',
      [
        'new-session',
        '-d',
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
      { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv },
    )
    if (result.status !== 0) {
      const err = result.stderr.toString().trim() || result.stdout.toString().trim() || `exit ${result.status}`
      throw new Error(`tmux new-session failed: ${err}`)
    }

    this._alive = true
    this._lastActivity = Date.now()
    this.startAliveCheck()
  }

  lastActivityMs(): number {
    return this._lastActivity
  }

  isAlive(): boolean {
    return this._alive
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
    this._lastActivity = Date.now()
    this.log(`deliver msg_id=${envelope.messageId} ts=${envelope.ts}`)

    const session = this.tmuxSessionName

    if (!this.tuiReady) {
      const ok = await this.waitForTuiReady(session)
      if (!ok) {
        this.log('TUI not ready after timeout — dropping message')
        return
      }
      this.tuiReady = true
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

    // Brief settle so Ink re-renders the buffer before we submit.
    await sleep(120)
    const sendEnter = spawnSync('tmux', ['send-keys', '-t', session, 'C-m'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (sendEnter.status !== 0) {
      this.log(`send-keys (C-m) failed: ${sendEnter.stderr.toString().trim()}`)
    }
  }

  private tuiReady = false

  /**
   * Poll the tmux pane for claude's prompt-ready marker (the `❯` cursor
   * line + the auto-mode footer). Returns true once seen, false on
   * timeout. Spawn → TUI ready can take 3-15s depending on plugin warmup.
   */
  private async waitForTuiReady(session: string, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const r = spawnSync('tmux', ['capture-pane', '-p', '-t', session], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const pane = r.stdout?.toString() ?? ''
      // Two strong signals that Ink finished bringing up the input box:
      //  - `❯` prompt cursor at the start of the input line
      //  - auto-mode footer ("auto mode on") rendered below the rule
      if (pane.includes('❯') && pane.includes('auto mode on')) {
        return true
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
  private formatPrompt(envelope: InboundEnvelope): string {
    const meta = [
      `source="discord"`,
      `chat_id="${this.chatId}"`,
      `message_id="${envelope.messageId}"`,
      `user="${envelope.username}"`,
      `user_id="${envelope.userId}"`,
      `ts="${envelope.ts}"`,
    ]
    if (envelope.attachments?.length) {
      meta.push(`attachment_count="${envelope.attachments.length}"`)
      meta.push(`attachments="${envelope.attachments.join('; ').replace(/"/g, '\\"')}"`)
    }
    return `<channel ${meta.join(' ')}>${envelope.content}</channel>`
  }

  onReply(handler: (reply: OutboundReply) => void): () => void {
    this.replyHandlers.add(handler)
    return () => this.replyHandlers.delete(handler)
  }

  onExit(handler: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): () => void {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }

  /**
   * Called by ProjectPool.acceptReply when the master MCP server emits a
   * reply tool call from this chat's session. We bump activity and fan
   * out to local subscribers (the pool's onReply sink already covers
   * Discord delivery — this hook is for additional observers).
   */
  acceptReply(reply: OutboundReply): void {
    this._lastActivity = Date.now()
    for (const h of this.replyHandlers) h(reply)
  }

  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested'): Promise<void> {
    if (!this._alive || !this.tmuxSessionName) return
    const session = this.tmuxSessionName
    this.log(`kill (${reason}) — tmux kill-session -t ${session}`)
    const result = spawnSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore' })
    if (result.status !== 0) {
      this.log(`kill-session non-zero (${result.status}) — assuming already dead`)
    }
    this.markDead(0, null)
  }

  private startAliveCheck(): void {
    if (this.aliveCheckTimer) return
    this.aliveCheckTimer = setInterval(() => {
      if (!this._alive || !this.tmuxSessionName) return
      const r = spawnSync('tmux', ['has-session', '-t', this.tmuxSessionName], { stdio: 'ignore' })
      if (r.status !== 0) {
        this.log(`tmux session ${this.tmuxSessionName} gone — marking dead`)
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
    const config = {
      mcpServers: {
        mcd: {
          type: 'http',
          url: this.master.urlFor(this.chatId),
        },
      },
    }
    writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
    return path
  }

  private readSessionId(): string | undefined {
    const path = projectSessionFile(this.slug)
    if (!existsSync(path)) return undefined
    try {
      const id = readFileSync(path, 'utf8').trim()
      return id.length > 0 ? id : undefined
    } catch {
      return undefined
    }
  }
}
