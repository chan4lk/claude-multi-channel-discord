/**
 * Real-Claude implementation of ProjectProcess. Wraps a `claude` CLI
 * subprocess with --cwd <project> --permission-mode auto and an
 * --mcp-config that points at the master HTTP MCP server.
 *
 * Phase 3b: process lifecycle (spawn / signal / exit) plus deliver() that
 * routes a Discord message into the running subprocess via a
 * server-initiated notification on its MCP session. Replies bubble up via
 * onReply when Claude calls the `reply` tool — that path lives entirely
 * in MasterMcpServer; this class just owns the process.
 *
 * Cross-platform notes:
 * - Subprocess spawn uses node:child_process which transparently handles
 *   Windows .cmd/.exe extension lookup via PATH. We pass the bare
 *   `claude` command and rely on PATH discovery.
 * - Signals: kill() uses default SIGTERM on POSIX; on Windows Node converts
 *   to TerminateProcess. The grace timeout escalates to SIGKILL / forced
 *   termination after 10s.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ClaudeArgs } from './channels-config.ts'
import type { MasterMcpServer } from './master-mcp-server.ts'
import { projectDir, projectSessionFile } from './paths.ts'
import type {
  InboundEnvelope,
  OutboundReply,
  ProjectProcess,
} from './project-process.ts'

const KILL_GRACE_MS = 10_000

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
  private child: ChildProcess | null = null
  private mcpConfigPath: string | null = null
  private _alive = false
  private _lastActivity = Date.now()
  private replyHandlers = new Set<(reply: OutboundReply) => void>()
  private exitHandlers = new Set<(info: { code: number | null; signal: NodeJS.Signals | null }) => void>()
  private replyUnsubscribe: (() => void) | null = null

  constructor(opts: ClaudeProjectProcessOptions) {
    this.opts = opts
    this.chatId = opts.chatId
    this.slug = opts.slug
    this.master = opts.master
    this.log = opts.log ?? ((m) => process.stderr.write(`[claude:${opts.slug}] ${m}\n`))
  }

  /**
   * Synchronously begin spawning. Resolves once the subprocess is launched
   * (not necessarily after Claude has connected to the MCP server). Caller
   * should await this before calling deliver().
   */
  async start(): Promise<void> {
    if (this.child) throw new Error('ClaudeProjectProcess already started')

    const cwd = projectDir(this.slug)
    if (!existsSync(cwd)) {
      throw new Error(`project working dir missing: ${cwd}`)
    }

    this.mcpConfigPath = this.writeMcpConfig()

    const claudeArgs = this.opts.claudeArgs ?? {}
    const args = ['--mcp-config', this.mcpConfigPath]

    args.push('--permission-mode', claudeArgs.permissionMode ?? 'auto')

    if (this.opts.model) {
      args.push('--model', this.opts.model)
    }

    if (claudeArgs.allowedTools && claudeArgs.allowedTools.length > 0) {
      args.push('--allowed-tools', claudeArgs.allowedTools.join(','))
    }
    if (claudeArgs.disallowedTools && claudeArgs.disallowedTools.length > 0) {
      args.push('--disallowed-tools', claudeArgs.disallowedTools.join(','))
    }

    const sessionId = this.readSessionId()
    if (sessionId) {
      args.push('--resume', sessionId)
    }

    // extraArgs ride at the tail so operators can override anything we set.
    if (claudeArgs.extraArgs && claudeArgs.extraArgs.length > 0) {
      args.push(...claudeArgs.extraArgs)
    }

    const bin = this.opts.claudeBin ?? 'claude'
    this.log(`spawn: ${bin} ${args.join(' ')} (cwd=${cwd})`)
    this.child = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this._alive = true
    this._lastActivity = Date.now()

    this.child.stdout?.on('data', (buf) => this.log(`stdout: ${String(buf).trimEnd()}`))
    this.child.stderr?.on('data', (buf) => this.log(`stderr: ${String(buf).trimEnd()}`))

    this.child.once('exit', (code, signal) => {
      this._alive = false
      this.log(`exit code=${code} signal=${signal}`)
      this.replyUnsubscribe?.()
      this.replyUnsubscribe = null
      void this.master.closeChat(this.chatId)
      for (const h of this.exitHandlers) h({ code, signal })
    })
    this.child.once('error', (err) => {
      this.log(`spawn error: ${err}`)
    })
  }

  lastActivityMs(): number {
    return this._lastActivity
  }

  isAlive(): boolean {
    return this._alive
  }

  async deliver(envelope: InboundEnvelope): Promise<void> {
    if (!this._alive) throw new Error(`deliver() called on dead ClaudeProjectProcess ${this.slug}`)
    this._lastActivity = Date.now()
    await this.master.notifyChat(this.chatId, 'notifications/claude/channel', {
      content: envelope.content,
      meta: {
        chat_id: this.chatId,
        message_id: envelope.messageId,
        user: envelope.username,
        user_id: envelope.userId,
        ts: envelope.ts,
        ...(envelope.attachments && envelope.attachments.length > 0
          ? {
              attachment_count: String(envelope.attachments.length),
              attachments: envelope.attachments.join('; '),
            }
          : {}),
      },
    })
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
   * Called by MasterMcpServer (via the pool's onReply wiring) whenever Claude
   * emits a tool reply that targets this chat. Pool is responsible for
   * matching by chatId; this method just bumps activity and fans out.
   */
  acceptReply(reply: OutboundReply): void {
    this._lastActivity = Date.now()
    for (const h of this.replyHandlers) h(reply)
  }

  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested'): Promise<void> {
    if (!this._alive || !this.child) return
    this.log(`kill (${reason}) — sending SIGTERM`)
    const child = this.child
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      child.kill('SIGTERM')
    } catch (err) {
      this.log(`SIGTERM throw: ${err}`)
    }
    const timer = setTimeout(() => {
      if (this._alive) {
        this.log('SIGKILL — grace expired')
        try {
          child.kill('SIGKILL')
        } catch {}
      }
    }, KILL_GRACE_MS)
    if (typeof timer.unref === 'function') timer.unref()
    await exited
    clearTimeout(timer)
  }

  private writeMcpConfig(): string {
    const dir = mkdtempSync(join(tmpdir(), `mcd-${this.slug}-`))
    const path = join(dir, 'mcp-config.json')
    const config = {
      mcpServers: {
        // Name `discord` matches what Claude expects from upstream config —
        // tool-name conflicts are unlikely since this is the only MCP server
        // in the per-project subprocess.
        discord: {
          transport: 'http',
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
