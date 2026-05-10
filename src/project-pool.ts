import type { ChannelsConfig, Project } from './channels-config.ts'
import type { InboundEnvelope, OutboundReply, ProjectProcess } from './project-process.ts'

export type PoolEvent =
  | { kind: 'spawn'; chatId: string; slug: string }
  | { kind: 'evict'; chatId: string; slug: string; reason: 'idle-evict' | 'pool-full' }
  | { kind: 'rejected'; chatId: string; reason: 'unknown-project' | 'pool-full-no-evict-candidate' }
  | { kind: 'crashed'; chatId: string; slug: string; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'stuck'; chatId: string; slug: string; sinceLastReplyMs: number }

export interface ProjectPoolOptions {
  /**
   * Factory invoked on lazy spawn. Production wires this to spawn a real
   * Claude Code subprocess. Tests wire it to MockProjectProcess.
   */
  factory: (args: { chatId: string; project: Project; config: ChannelsConfig }) => ProjectProcess
  /**
   * Read the current channels config. Re-read on every dispatch so pool
   * decisions track config edits without restart.
   */
  getConfig: () => ChannelsConfig
  /** Outbound reply sink. Pool tags origin chatId for the caller. */
  onReply: (reply: OutboundReply) => void
  /** Diagnostics — fire-and-forget. */
  onEvent?: (evt: PoolEvent) => void
  /** Override Date.now for tests. */
  now?: () => number
}

export class ProjectPool {
  private readonly opts: ProjectPoolOptions
  private readonly processes = new Map<string, ProjectProcess>()
  private readonly cleanups = new Map<string, () => void>()
  private idleTimer: ReturnType<typeof setInterval> | null = null
  /**
   * Per-chat dedup cache of recently-delivered Discord message IDs.
   * Discord's gateway can replay events after a reconnect/RESUME — if
   * the same messageCreate fires twice, we'd send-keys twice and claude
   * would process the same prompt twice. 60s TTL is more than enough to
   * dedup a resume burst without leaking memory.
   */
  private readonly recentMessages = new Map<string, Map<string, number>>()
  private static readonly MSG_DEDUP_TTL_MS = 60_000

  /**
   * If a chat has received messages we've delivered (`lastActivityMs`)
   * but produced no reply (`lastReplyMs`) for this long, consider the
   * subprocess hung and tear it down. Next inbound message respawns
   * fresh. 5 min is comfortably longer than a normal long-thinking turn
   * but short enough that operators don't sit on a dead channel.
   */
  static readonly STUCK_THRESHOLD_MS = 5 * 60_000

  constructor(opts: ProjectPoolOptions) {
    this.opts = opts
  }

  /** Start background idle eviction. Idempotent. */
  start(checkIntervalMs = 30_000): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      try {
        this.evictIdle()
      } catch (err) {
        process.stderr.write(`pool: idle sweep failed: ${err}\n`)
      }
    }, checkIntervalMs)
    // Don't keep the event loop alive just for the sweeper.
    if (typeof this.idleTimer.unref === 'function') this.idleTimer.unref()
  }

  /** Push a Discord message to the right project process. */
  async deliver(chatId: string, envelope: InboundEnvelope): Promise<void> {
    const config = this.opts.getConfig()
    const project = config.projects[chatId]
    if (!project) {
      this.fireEvent({ kind: 'rejected', chatId, reason: 'unknown-project' })
      return
    }

    if (this.isDuplicate(chatId, envelope.messageId)) {
      process.stderr.write(`pool: drop duplicate msg=${envelope.messageId} chat=${chatId}\n`)
      return
    }

    const existing = this.processes.get(chatId)
    let proc: ProjectProcess
    if (existing && existing.isAlive()) {
      proc = existing
    } else {
      const spawned = await this.spawn(chatId, project, config)
      if (!spawned) return // pool was full and no eviction candidate
      proc = spawned
    }

    await proc.deliver(envelope)
  }

  /**
   * Returns true if we've delivered this messageId for this chat within
   * the last MSG_DEDUP_TTL_MS. Marks it as seen on first call.
   */
  private isDuplicate(chatId: string, messageId: string): boolean {
    const now = this.now()
    const cutoff = now - ProjectPool.MSG_DEDUP_TTL_MS

    let bucket = this.recentMessages.get(chatId)
    if (!bucket) {
      bucket = new Map()
      this.recentMessages.set(chatId, bucket)
    }

    // Drop expired entries from this bucket so memory stays bounded.
    for (const [id, ts] of bucket) {
      if (ts < cutoff) bucket.delete(id)
    }

    if (bucket.has(messageId)) return true
    bucket.set(messageId, now)
    return false
  }

  /**
   * Route an outbound reply (emitted by the master MCP server when a
   * subprocess calls a tool) to the matching process so its lastActivity
   * bumps and its onReply subscribers fire.
   *
   * The fan-out to opts.onReply happens via spawn()'s proc.onReply
   * subscription — calling opts.onReply here too produced duplicate
   * Discord posts. Single path now.
   */
  acceptReply(reply: OutboundReply): void {
    const proc = this.processes.get(reply.chatId)
    if (!proc || !proc.isAlive()) {
      process.stderr.write(`pool: orphan reply from ${reply.chatId}, dropped\n`)
      return
    }
    if (typeof (proc as { acceptReply?: (r: OutboundReply) => void }).acceptReply === 'function') {
      ;(proc as unknown as { acceptReply: (r: OutboundReply) => void }).acceptReply(reply)
    }
  }

  /**
   * Kill the running process for a single chat (if any). Used by mutation
   * verbs (`set --prompt`, `rename`, `rm`) so the next inbound message
   * lazy-spawns a fresh subprocess that picks up the new CLAUDE.md / slug
   * directory. Idempotent — no-op if the chat has no live process.
   */
  async killChat(chatId: string, reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested' = 'requested'): Promise<void> {
    const proc = this.processes.get(chatId)
    if (!proc) return
    await proc.kill(reason)
    // exit handler set in spawn() will remove from this.processes once the
    // child actually exits — we don't need to delete here.
  }

  /** Force an idle sweep. Public for tests. */
  evictIdle(): void {
    const config = this.opts.getConfig()
    const idleMs = config.defaults.idleEvictMinutes * 60_000
    const now = this.now()
    const idleCutoff = now - idleMs
    for (const [chatId, proc] of this.processes) {
      if (!proc.isAlive()) {
        this.processes.delete(chatId)
        this.cleanups.get(chatId)?.()
        this.cleanups.delete(chatId)
        continue
      }

      // Stuck-watchdog: a deliver landed but no reply came back for
      // STUCK_THRESHOLD_MS. The subprocess is hung (TUI crashed mid-life,
      // infinite-loop bash, upstream API gateway timeout, …). Kill it
      // so the next inbound message respawns clean. Skip when the
      // backend doesn't expose pendingDeliverAtMs — the watchdog is
      // best-effort.
      const pendingAt = typeof proc.pendingDeliverAtMs === 'function' ? proc.pendingDeliverAtMs() : null
      if (pendingAt !== null) {
        const sincePending = now - pendingAt
        if (sincePending > ProjectPool.STUCK_THRESHOLD_MS) {
          this.fireEvent({ kind: 'stuck', chatId, slug: proc.slug, sinceLastReplyMs: sincePending })
          void proc.kill('requested')
          continue
        }
      }

      if (proc.lastActivityMs() < idleCutoff) {
        this.fireEvent({ kind: 'evict', chatId, slug: proc.slug, reason: 'idle-evict' })
        void proc.kill('idle-evict')
      }
    }
  }

  /** Tear down the pool. Resolves once every process has exited. */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    const tasks: Promise<void>[] = []
    for (const proc of this.processes.values()) tasks.push(proc.kill('shutdown'))
    await Promise.allSettled(tasks)
    this.processes.clear()
    for (const fn of this.cleanups.values()) fn()
    this.cleanups.clear()
  }

  /** Test/debug accessor. */
  size(): number {
    return Array.from(this.processes.values()).filter((p) => p.isAlive()).length
  }

  /** Test/debug accessor. */
  has(chatId: string): boolean {
    const p = this.processes.get(chatId)
    return !!p && p.isAlive()
  }

  /**
   * Snapshot of every tracked process (alive AND recently-exited that
   * hasn't been GC'd yet). Used by `!project usage` to show resource
   * stats. Calls each process's getStats() if implemented.
   */
  async snapshot(): Promise<Array<{
    chatId: string
    slug: string
    alive: boolean
    pid: number | null
    cpuTimeMs?: number
    memoryMb?: number
    uptimeMs?: number
    lastActivityMs: number
  }>> {
    const out: Array<{
      chatId: string
      slug: string
      alive: boolean
      pid: number | null
      cpuTimeMs?: number
      memoryMb?: number
      uptimeMs?: number
      lastActivityMs: number
    }> = []
    for (const [chatId, proc] of this.processes) {
      const alive = proc.isAlive()
      const stats = alive && typeof proc.getStats === 'function' ? await proc.getStats().catch(() => null) : null
      out.push({
        chatId,
        slug: proc.slug,
        alive,
        pid: stats?.pid ?? null,
        cpuTimeMs: stats?.cpuTimeMs,
        memoryMb: stats?.memoryMb,
        uptimeMs: stats?.uptimeMs,
        lastActivityMs: proc.lastActivityMs(),
      })
    }
    return out
  }

  private async spawn(chatId: string, project: Project, config: ChannelsConfig): Promise<ProjectProcess | null> {
    if (this.size() >= config.defaults.maxConcurrent) {
      const evicted = this.evictLeastRecentlyUsed()
      if (!evicted) {
        this.fireEvent({ kind: 'rejected', chatId, reason: 'pool-full-no-evict-candidate' })
        return null
      }
    }

    const proc = this.opts.factory({ chatId, project, config })
    this.processes.set(chatId, proc)

    const offReply = proc.onReply((reply) => {
      try {
        this.opts.onReply(reply)
      } catch (err) {
        process.stderr.write(`pool: onReply handler threw: ${err}\n`)
      }
    })
    const offExit = proc.onExit(({ code, signal }) => {
      this.processes.delete(chatId)
      if (code !== 0 && code !== null) {
        this.fireEvent({ kind: 'crashed', chatId, slug: project.slug, code, signal })
      }
      this.cleanups.get(chatId)?.()
      this.cleanups.delete(chatId)
    })
    this.cleanups.set(chatId, () => {
      offReply()
      offExit()
    })

    this.fireEvent({ kind: 'spawn', chatId, slug: project.slug })
    return proc
  }

  /**
   * Find the alive process with the oldest lastActivity and kill it. Returns
   * its chat_id, or null if no alive candidates were found (e.g., everything
   * is currently mid-spawn). Fires 'pool-full' eviction events.
   */
  private evictLeastRecentlyUsed(): string | null {
    let oldest: { chatId: string; proc: ProjectProcess; ts: number } | null = null
    for (const [chatId, proc] of this.processes) {
      if (!proc.isAlive()) continue
      const ts = proc.lastActivityMs()
      if (!oldest || ts < oldest.ts) oldest = { chatId, proc, ts }
    }
    if (!oldest) return null
    this.fireEvent({ kind: 'evict', chatId: oldest.chatId, slug: oldest.proc.slug, reason: 'pool-full' })
    void oldest.proc.kill('pool-full')
    return oldest.chatId
  }

  private fireEvent(evt: PoolEvent): void {
    if (!this.opts.onEvent) return
    try {
      this.opts.onEvent(evt)
    } catch (err) {
      process.stderr.write(`pool: onEvent handler threw: ${err}\n`)
    }
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now()
  }
}
