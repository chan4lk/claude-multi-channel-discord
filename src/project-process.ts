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

export type ToolProgressEvent =
  | { phase: 'start'; toolId: string; toolName: string; inputSummary: string }
  | { phase: 'done'; toolId: string; toolName: string; durationMs: number; isError: boolean }

export interface ProcessStats {
  /** Resolved claude PID. null if we couldn't find one. */
  pid: number | null
  /** Total CPU time in ms (jiffies × clock-tick). */
  cpuTimeMs?: number
  /** Resident set size, in megabytes (VmRSS). */
  memoryMb?: number
  /** ms since the underlying claude process started. */
  uptimeMs?: number
}

export interface ProjectProcess {
  /** Discord chat id this process is dedicated to. Set at construction. */
  readonly chatId: string
  /** Project slug (working dir name). */
  readonly slug: string
  /** Wall-clock ms of the most recent inbound or outbound activity. */
  lastActivityMs(): number
  /**
   * Wall-clock ms of the oldest delivered message that has NOT yet
   * produced a reply. Returns null when the process is up-to-date
   * (no in-flight turn). Used by the pool's stuck-watchdog: if a
   * deliver sat unanswered for more than STUCK_THRESHOLD_MS, the
   * subprocess is hung and gets torn down. Optional — backends that
   * don't track this are skipped by the watchdog.
   */
  pendingDeliverAtMs?(): number | null
  /**
   * Wall-clock ms of the most recent write to the session transcript .jsonl.
   * Returns null when unknown — session id not yet captured, file missing,
   * stat throws. Used by the pool's stuck-watchdog as a secondary "is the
   * agent doing anything?" signal: a long internal turn (parallel subagents,
   * big bash) still writes to the transcript, so a fresh mtime vetoes the
   * kill even if no `reply` tool fired. Optional — backends that don't
   * implement it leave the watchdog in pendingDeliver-only mode.
   */
  transcriptMtimeMs?(): number | null
  /**
   * Per-process adaptive stuck threshold. Given the pool's base threshold,
   * returns a dynamically extended value derived from observed turn durations —
   * channels that routinely run long agent turns (parallel subagents, big
   * edits) won't be killed by a fixed 5-min window. Optional; pool falls back
   * to the base threshold when not implemented.
   */
  adaptiveThresholdMs?(baseMs: number): number
  /** Whether the process is still alive. False after kill() resolves. */
  isAlive(): boolean
  /**
   * Cheap liveness probe — for the tmux backend, captures the pane and
   * checks for the prompt marker. Stronger guarantee than isAlive(): a
   * blank pane returns false even though the tmux session exists.
   * Optional; defaults to isAlive() when not implemented.
   */
  isResponsive?(): boolean
  /**
   * Best-effort current resource stats. Returns null when not implemented
   * (mock backend) or when the pid couldn't be resolved.
   */
  getStats?(): Promise<ProcessStats | null>
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
  /** Subscribe to tool-call progress events (optional — not all backends emit these). */
  onToolProgress?(handler: (ev: ToolProgressEvent) => void): () => void
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
  private _pendingDeliverAt: number | null = null
  private _transcriptMtime: number | null = null
  private now: () => number
  private hangs: boolean
  private replyHandlers = new Set<(reply: OutboundReply) => void>()
  private exitHandlers = new Set<(info: { code: number | null; signal: NodeJS.Signals | null }) => void>()
  /** Test hook: track every kill() reason. */
  killReasons: string[] = []
  private turnHistory: number[] = []

  constructor(args: { chatId: string; slug: string; now?: () => number; hangs?: boolean }) {
    this.chatId = args.chatId
    this.slug = args.slug
    this.now = args.now ?? (() => Date.now())
    this._lastActivity = this.now()
    this.hangs = !!args.hangs
  }

  lastActivityMs(): number {
    return this._lastActivity
  }

  pendingDeliverAtMs(): number | null {
    return this._pendingDeliverAt
  }

  transcriptMtimeMs(): number | null {
    return this._transcriptMtime
  }

  /** Test-only hook for the stuck-watchdog gate. */
  setTranscriptMtimeMs(ms: number | null): void {
    this._transcriptMtime = ms
  }

  /** Test-only hook: inject pre-built turn durations to exercise adaptive threshold. */
  setTurnHistory(durations: number[]): void {
    this.turnHistory = [...durations]
  }

  adaptiveThresholdMs(baseMs: number): number {
    if (this.turnHistory.length === 0) return baseMs
    const maxTurn = Math.max(...this.turnHistory)
    return Math.min(30 * 60_000, Math.max(baseMs, Math.ceil(maxTurn * 1.5)))
  }

  isAlive(): boolean {
    return this._alive
  }

  async deliver(envelope: InboundEnvelope): Promise<void> {
    if (!this._alive) throw new Error('MockProjectProcess: deliver() after kill')
    const at = this.now()
    this._lastActivity = at
    if (this._pendingDeliverAt === null) this._pendingDeliverAt = at
    if (this.hangs) return
    queueMicrotask(() => {
      if (!this._alive) return
      const replyAt = this.now()
      if (this._pendingDeliverAt !== null) {
        const duration = replyAt - this._pendingDeliverAt
        this.turnHistory.push(duration)
        if (this.turnHistory.length > 5) this.turnHistory.shift()
      }
      this._lastActivity = replyAt
      this._pendingDeliverAt = null
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

  onToolProgress(_handler: (ev: ToolProgressEvent) => void): () => void {
    return () => {}
  }

  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested'): Promise<void> {
    if (!this._alive) return
    this.killReasons.push(reason)
    this._alive = false
    for (const h of this.exitHandlers) h({ code: 0, signal: null })
  }
}
