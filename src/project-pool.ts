import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { ChannelsConfig, Project } from './channels-config.ts'
import type { InboundEnvelope, OutboundReply, ProjectProcess, ToolProgressEvent, LimitHitEvent } from './project-process.ts'

export type PoolEvent =
  | { kind: 'spawn'; chatId: string; slug: string }
  | { kind: 'evict'; chatId: string; slug: string; reason: 'idle-evict' | 'pool-full' }
  | { kind: 'rejected'; chatId: string; reason: 'unknown-project' | 'pool-full-no-evict-candidate' }
  | { kind: 'crashed'; chatId: string; slug: string; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'stuck'; chatId: string; slug: string; sinceLastReplyMs: number; effectiveThresholdMs: number }
  | { kind: 'progress-skip'; chatId: string; slug: string; sinceLastReplyMs: number; sinceTranscriptMs: number; effectiveThresholdMs: number }
  | { kind: 'tool-progress'; chatId: string; slug: string; event: ToolProgressEvent }
  | { kind: 'limit-hit'; chatId: string; slug: string; event: LimitHitEvent }
  | { kind: 'respawn-scheduled'; chatId: string; slug: string; backoffMs: number; attempt: number }
  | { kind: 'circuit-open'; chatId: string; slug: string; failureCount: number }
  | { kind: 'circuit-reset'; chatId: string; slug: string }
  | { kind: 'budget-exhausted'; chatId: string; slug: string; used: number; budget: number; queuedCount: number }
  | { kind: 'budget-alert'; chatId: string; slug: string; threshold: 50 | 80 | 100; used: number; budget: number }
  | { kind: 'budget-restored'; chatId: string; slug: string; drained: number }

interface FailureLedger {
  count: number
  windowStart: number
  backoffMs: number
  circuitOpen: boolean
  circuitOpenAt?: number
}

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
  private readonly failureLedger = new Map<string, FailureLedger>()
  /** Messages queued while a project's budget is exhausted. Drained on month reset. */
  private readonly budgetQueue = new Map<string, InboundEnvelope[]>()
  /** Tracks which budget thresholds (50/80/100) have fired per chat per month. */
  private readonly budgetAlertFired = new Map<string, Set<50 | 80 | 100>>()
  /** Last UTC year-month string seen, for detecting month rollovers. */
  private lastYearMonth = ProjectPool.currentYearMonth()
  private static readonly MSG_DEDUP_TTL_MS = 60_000

  private static currentYearMonth(): string {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  }

  /**
   * If a chat has received messages we've delivered (`lastActivityMs`)
   * but produced no reply (`lastReplyMs`) for this long, consider the
   * subprocess hung and tear it down. Next inbound message respawns
   * fresh. 5 min is comfortably longer than a normal long-thinking turn
   * but short enough that operators don't sit on a dead channel.
   */
  static readonly STUCK_THRESHOLD_MS = 5 * 60_000

  static readonly FAILURE_WINDOW_MS = 30 * 60_000   // 30 min
  static readonly MAX_FAILURES_BEFORE_CIRCUIT = 5
  static readonly CIRCUIT_RESET_MS = 10 * 60_000     // 10 min
  static readonly BACKOFF_SEQUENCE_MS = [5_000, 10_000, 30_000, 120_000, 300_000]

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
    // Check for month rollover — drain queues and reset alert state on month boundary.
    this.checkMonthRollover()

    const config = this.opts.getConfig()
    const project = config.projects[chatId]
    if (!project) {
      this.fireEvent({ kind: 'rejected', chatId, reason: 'unknown-project' })
      return
    }

    const ledger = this.failureLedger.get(chatId)
    if (ledger?.circuitOpen) {
      const sinceOpen = this.now() - (ledger.circuitOpenAt ?? 0)
      if (sinceOpen < ProjectPool.CIRCUIT_RESET_MS) {
        process.stderr.write(`pool: circuit open for ${project.slug}, dropping message\n`)
        return
      }
      // Auto-reset
      ledger.circuitOpen = false
      ledger.count = 0
      this.fireEvent({ kind: 'circuit-reset', chatId, slug: project.slug })
    }

    // Budget enforcement before dedup: check thresholds and queue at exhaustion.
    // Dedup is intentionally skipped for queued messages so they can be re-delivered
    // on month rollover without being dropped as duplicates.
    if (project.monthlyTokenBudget != null) {
      const used = this.computeMonthlyTokensUsed(project.slug, config)
      const budget = project.monthlyTokenBudget
      this.checkBudgetThresholds(chatId, project.slug, used, budget)
      if (used >= budget) {
        const queue = this.budgetQueue.get(chatId) ?? []
        queue.push(envelope)
        this.budgetQueue.set(chatId, queue)
        this.writeBudgetQueueState()
        process.stderr.write(`pool: budget exhausted for ${project.slug}, queued msg (queue=${queue.length})\n`)
        this.fireEvent({ kind: 'budget-exhausted', chatId, slug: project.slug, used, budget, queuedCount: queue.length })
        return
      }
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

  /** Check budget thresholds (50/80/100%) and fire events on first crossing per month. */
  private checkBudgetThresholds(chatId: string, slug: string, used: number, budget: number): void {
    const pct = (used / budget) * 100
    let fired = this.budgetAlertFired.get(chatId)
    if (!fired) { fired = new Set(); this.budgetAlertFired.set(chatId, fired) }
    for (const threshold of [50, 80, 100] as const) {
      if (pct >= threshold && !fired.has(threshold)) {
        fired.add(threshold)
        this.fireEvent({ kind: 'budget-alert', chatId, slug, threshold, used, budget })
      }
    }
  }

  /** Detect UTC month rollover; on rollover, drain queued messages and reset alert state. */
  private checkMonthRollover(): void {
    const currentYM = ProjectPool.currentYearMonth()
    if (currentYM === this.lastYearMonth) return
    this.lastYearMonth = currentYM
    // Reset alert fired state — new month, new thresholds.
    this.budgetAlertFired.clear()
    // Drain all queued messages from the previous month.
    void this.drainBudgetQueues()
  }

  /** Drain all budget queues (called on month rollover). */
  async drainBudgetQueues(): Promise<void> {
    for (const [chatId, queue] of this.budgetQueue) {
      if (queue.length === 0) continue
      const config = this.opts.getConfig()
      const project = config.projects[chatId]
      if (!project) { this.budgetQueue.delete(chatId); continue }
      const drained = queue.length
      this.budgetQueue.delete(chatId)
      this.writeBudgetQueueState()
      this.fireEvent({ kind: 'budget-restored', chatId, slug: project.slug, drained })
      for (const envelope of queue) {
        await this.deliver(chatId, envelope)
      }
    }
  }

  /** Return queued message count for a chat (for dashboard display). */
  getBudgetQueuedCount(chatId: string): number {
    return this.budgetQueue.get(chatId)?.length ?? 0
  }

  private computeMonthlyTokensUsed(slug: string, _config: ChannelsConfig): number {
    const mcdDir = process.env.MCD_CHANNELS_DIR
    if (!mcdDir) return 0
    const now = new Date()
    const currentYearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const projectPath = path.join(mcdDir, 'projects', slug)
    let realPath = projectPath
    try { realPath = fs.realpathSync(projectPath) } catch { return 0 }
    const encoded = realPath.replace(/[^a-zA-Z0-9]/g, '-')
    const transcriptDir = path.join(os.homedir(), '.claude', 'projects', encoded)
    let files: string[] = []
    try {
      files = fs.readdirSync(transcriptDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => path.join(transcriptDir, f))
    } catch { return 0 }
    let total = 0
    for (const file of files) {
      let raw = ''
      try { raw = fs.readFileSync(file, 'utf-8') } catch { continue }
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        let rec: Record<string, unknown>
        try { rec = JSON.parse(line) } catch { continue }
        if (rec.type !== 'assistant') continue
        const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null
        if (!ts) continue
        const recYearMonth = ts.slice(0, 7)
        if (recYearMonth !== currentYearMonth) continue
        const usage = (rec as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } }).message?.usage
        total += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
      }
    }
    return total
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
      //
      // Two-signal AND-gate (subagent-aware): even when no reply tool
      // fired, the agent may be doing long internal work — parallel
      // subagents, big bash, multi-file edits — that still appends to
      // the session transcript every few hundred ms. If transcriptMtimeMs()
      // is fresh, veto the kill so we don't false-positive a healthy
      // long turn. Transcript-stale OR method-absent ⇒ kill as before.
      const pendingAt = typeof proc.pendingDeliverAtMs === 'function' ? proc.pendingDeliverAtMs() : null
      if (pendingAt !== null) {
        const sincePending = now - pendingAt
        const projectCfg = this.opts.getConfig().projects[chatId]
        const baseThresholdMs = projectCfg?.stuckThresholdMinutes
          ? projectCfg.stuckThresholdMinutes * 60_000
          : ProjectPool.STUCK_THRESHOLD_MS
        const effectiveThreshold = proc.adaptiveThresholdMs
          ? proc.adaptiveThresholdMs(baseThresholdMs)
          : baseThresholdMs
        if (sincePending > effectiveThreshold) {
          let transcriptMtime: number | null = null
          try {
            transcriptMtime = typeof proc.transcriptMtimeMs === 'function' ? proc.transcriptMtimeMs() : null
          } catch {
            transcriptMtime = null
          }
          if (transcriptMtime !== null && now - transcriptMtime < effectiveThreshold) {
            this.fireEvent({
              kind: 'progress-skip',
              chatId,
              slug: proc.slug,
              sinceLastReplyMs: sincePending,
              sinceTranscriptMs: now - transcriptMtime,
              effectiveThresholdMs: effectiveThreshold,
            })
            continue
          }
          this.fireEvent({ kind: 'stuck', chatId, slug: proc.slug, sinceLastReplyMs: sincePending, effectiveThresholdMs: effectiveThreshold })
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

  /** Returns circuit-breaker state for each chat. */
  getCircuitStates(): Map<string, { circuitOpen: boolean; backoffUntil?: number }> {
    const out = new Map<string, { circuitOpen: boolean; backoffUntil?: number }>()
    for (const [chatId, ledger] of this.failureLedger) {
      out.set(chatId, { circuitOpen: ledger.circuitOpen, backoffUntil: ledger.backoffMs > 0 ? ledger.windowStart + ledger.backoffMs : undefined })
    }
    return out
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
      this.cleanups.get(chatId)?.()
      this.cleanups.delete(chatId)

      const isCrash = code !== 0 && code !== null
      if (isCrash) {
        this.fireEvent({ kind: 'crashed', chatId, slug: project.slug, code, signal })
        this.recordFailureAndMaybeRespawn(chatId, project, config)
      }
    })
    const offToolProgress = proc.onToolProgress?.((ev) => {
      this.fireEvent({ kind: 'tool-progress', chatId, slug: project.slug, event: ev })
    })
    const offLimitHit = proc.onLimitHit?.((ev) => {
      this.fireEvent({ kind: 'limit-hit', chatId, slug: project.slug, event: ev })
    })
    this.cleanups.set(chatId, () => {
      offReply()
      offExit()
      offToolProgress?.()
      offLimitHit?.()
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

  private recordFailureAndMaybeRespawn(
    chatId: string,
    project: import('./channels-config.ts').Project,
    config: import('./channels-config.ts').ChannelsConfig,
  ): void {
    const now = this.now()
    let ledger = this.failureLedger.get(chatId)
    if (!ledger) {
      ledger = { count: 0, windowStart: now, backoffMs: 0, circuitOpen: false }
      this.failureLedger.set(chatId, ledger)
    }

    // Reset window if it expired
    if (now - ledger.windowStart > ProjectPool.FAILURE_WINDOW_MS) {
      ledger.count = 0
      ledger.windowStart = now
    }

    ledger.count++
    const attempt = Math.min(ledger.count - 1, ProjectPool.BACKOFF_SEQUENCE_MS.length - 1)
    const backoffMs = ProjectPool.BACKOFF_SEQUENCE_MS[attempt]
    ledger.backoffMs = backoffMs

    if (ledger.count >= ProjectPool.MAX_FAILURES_BEFORE_CIRCUIT) {
      ledger.circuitOpen = true
      ledger.circuitOpenAt = now
      this.fireEvent({ kind: 'circuit-open', chatId, slug: project.slug, failureCount: ledger.count })
      return
    }

    this.fireEvent({ kind: 'respawn-scheduled', chatId, slug: project.slug, backoffMs, attempt: ledger.count })
    setTimeout(() => {
      if (this.failureLedger.get(chatId)?.circuitOpen) return
      const currentConfig = this.opts.getConfig()
      const currentProject = currentConfig.projects[chatId]
      if (!currentProject) return
      void this.spawn(chatId, currentProject, currentConfig).catch((err) => {
        process.stderr.write(`pool: respawn failed for ${project.slug}: ${err}\n`)
      })
    }, backoffMs)
  }

  private writeBudgetQueueState(): void {
    const mcdDir = process.env.MCD_CHANNELS_DIR
    if (!mcdDir) return
    const config = this.opts.getConfig()
    const state: Record<string, { slug: string; count: number; updatedAt: string }> = {}
    for (const [chatId, queue] of this.budgetQueue) {
      const slug = config.projects[chatId]?.slug ?? chatId
      state[chatId] = { slug, count: queue.length, updatedAt: new Date().toISOString() }
    }
    const filePath = path.join(mcdDir, 'budget-queue-state.json')
    const tmpPath = filePath + '.tmp'
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
      fs.renameSync(tmpPath, filePath)
    } catch { /* non-critical */ }
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
