/**
 * Abstraction over "the thing that handles messages for one project channel".
 * In phase 3a this exists as an interface + a MockProjectProcess so the pool's
 * lifecycle (lazy spawn, idle eviction, maxConcurrent) can be tested in
 * isolation. Phase 3b adds the real Claude Code subprocess implementation
 * (ClaudeProjectProcess) that wraps `spawn('claude', ...)` and proxies
 * MCP traffic.
 */

export type InboundEnvelope = {
  /** Discord message id (for reply threading). */
  messageId: string
  /** Author Discord user id. */
  userId: string
  /** Display name. */
  username: string
  /** Plain text body. */
  content: string
  /** ISO timestamp of the original Discord message. */
  ts: string
  /** Optional attachment summaries (name, type, size). */
  attachments?: string[]
}

export type OutboundReply =
  | { kind: 'text'; chatId: string; text: string; replyTo?: string }
  | { kind: 'react'; chatId: string; messageId: string; emoji: string }

export interface ProjectProcess {
  /** Discord chat id this process is dedicated to. Set at construction. */
  readonly chatId: string
  /** Project slug (working dir name). */
  readonly slug: string
  /** Wall-clock ms of the most recent inbound or outbound activity. */
  lastActivityMs(): number
  /** Whether the process is still alive. False after kill() resolves. */
  isAlive(): boolean
  /**
   * Push an inbound Discord message into this process. Resolves once the
   * message has been queued for the underlying agent — does NOT wait for the
   * reply (replies arrive asynchronously via onReply).
   */
  deliver(envelope: InboundEnvelope): Promise<void>
  /** Subscribe to outbound replies. Returns unsubscribe fn. */
  onReply(handler: (reply: OutboundReply) => void): () => void
  /** Subscribe to lifecycle exit (clean exit, crash, or kill). */
  onExit(handler: (info: { code: number | null; signal: NodeJS.Signals | null }) => void): () => void
  /**
   * Tear down the process. Idempotent. Returns once exit handlers have fired.
   */
  kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested'): Promise<void>
}

/**
 * In-process stand-in for tests. Behaves like a real ProjectProcess but
 * keeps everything in memory: deliver() echoes the inbound content back as
 * a text reply, lifecycle hooks fire synchronously.
 *
 * Not used in production code paths.
 */
export class MockProjectProcess implements ProjectProcess {
  readonly chatId: string
  readonly slug: string

  private _alive = true
  private _lastActivity: number
  private now: () => number
  private replyHandlers = new Set<(reply: OutboundReply) => void>()
  private exitHandlers = new Set<(info: { code: number | null; signal: NodeJS.Signals | null }) => void>()
  /** Test hook: track every kill() reason. */
  killReasons: string[] = []

  constructor(args: { chatId: string; slug: string; now?: () => number }) {
    this.chatId = args.chatId
    this.slug = args.slug
    this.now = args.now ?? (() => Date.now())
    this._lastActivity = this.now()
  }

  lastActivityMs(): number {
    return this._lastActivity
  }

  isAlive(): boolean {
    return this._alive
  }

  async deliver(envelope: InboundEnvelope): Promise<void> {
    if (!this._alive) throw new Error('MockProjectProcess: deliver() after kill')
    this._lastActivity = this.now()
    queueMicrotask(() => {
      if (!this._alive) return
      this._lastActivity = this.now()
      const reply: OutboundReply = {
        kind: 'text',
        chatId: this.chatId,
        text: `mock(${this.slug}): ${envelope.content}`,
        replyTo: envelope.messageId,
      }
      for (const h of this.replyHandlers) h(reply)
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

  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested'): Promise<void> {
    if (!this._alive) return
    this.killReasons.push(reason)
    this._alive = false
    for (const h of this.exitHandlers) h({ code: 0, signal: null })
  }
}
