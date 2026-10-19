import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import { getCredential, loadCredentials, resolvePrApiEnv } from './git-credentials.ts'
import { buildGitEnv } from './git-ops.ts'
import { projectClaudeMd, projectCodexThreadFile, projectDir } from './paths.ts'
import type { InboundEnvelope, OutboundReply, ProcessStats, ProjectProcess, ToolProgressEvent } from './project-process.ts'

type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess
type ExitInfo = { code: number | null; signal: NodeJS.Signals | null }
type JsonObject = Record<string, unknown>
type PendingRequest = { method: string; resolve: (value: JsonObject) => void; reject: (error: Error) => void }
type ActiveTurn = {
  envelope: InboundEnvelope
  receivedAt: number
  id: string | null
  replied: boolean
  finalText: string
  finish: () => void
  tools: Map<string, { name: string; startedAt: number }>
}

export interface CodexProjectProcessOptions {
  chatId: string
  slug: string
  master: { urlFor(chatId: string): string; tokenFor(chatId: string): string }
  model?: string
  platform?: 'discord' | 'teams' | 'whatsapp'
  gitCredential?: string
  codex?: {
    binPath?: string
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
    approvalPolicy?: 'never'
    apiKeyEnv?: string
  }
  spawnFn?: SpawnFn
  log?: (message: string) => void
}

/** One app-server child and one durable Codex thread per project channel. */
export class CodexProjectProcess implements ProjectProcess {
  readonly chatId: string
  readonly slug: string
  private readonly opts: CodexProjectProcessOptions
  private child: ChildProcess | null = null
  private starting: Promise<void> | null = null
  private alive = false
  private stopped = false
  private lastActivity = Date.now()
  private spawnedAt = 0
  private gitCredentialCleanup: (() => void) | null = null
  private threadId: string | null = null
  private stdoutBuffer = ''
  private nextId = 1
  private requests = new Map<number, PendingRequest>()
  private queue: Array<{ envelope: InboundEnvelope; receivedAt: number }> = []
  private active: ActiveTurn | null = null
  private pumping = false
  private readonly replyHandlers = new Set<(reply: OutboundReply) => void>()
  private readonly exitHandlers = new Set<(info: ExitInfo) => void>()
  private readonly toolHandlers = new Set<(event: ToolProgressEvent) => void>()

  constructor(opts: CodexProjectProcessOptions) {
    this.opts = opts
    this.chatId = opts.chatId
    this.slug = opts.slug
  }

  start(): Promise<void> {
    if (this.starting) return this.starting
    this.alive = true
    this.spawnedAt = Date.now()
    // The pool subscribes to exit immediately after its factory returns.
    this.starting = Promise.resolve().then(() => this.startInner()).catch((error) => {
      this.stop(1, null)
      throw error
    })
    return this.starting
  }

  private async startInner(): Promise<void> {
    if (this.stopped) throw new Error('Codex app-server was stopped before startup')
    const cwd = realpathSync(projectDir(this.slug))
    const keyEnv = this.opts.codex?.apiKeyEnv
    if (keyEnv && !process.env[keyEnv]) throw new Error(`Codex API key environment variable ${keyEnv} is missing`)
    const token = this.opts.master.tokenFor(this.chatId)
    let env: NodeJS.ProcessEnv = { ...process.env, MCD_MCP_TOKEN: token }
    if (keyEnv) env.OPENAI_API_KEY = process.env[keyEnv]
    if (this.opts.gitCredential) {
      try {
        const credential = getCredential(loadCredentials(), this.opts.gitCredential)
        const built = buildGitEnv(credential, env)
        this.gitCredentialCleanup = built.cleanup
        env = { ...built.env, ...resolvePrApiEnv(credential) }
      } catch {
        this.gitCredentialCleanup?.()
        this.gitCredentialCleanup = null
        this.opts.log?.(`Codex git credential ${this.opts.gitCredential} could not be loaded; check the alias and host environment`)
      }
    }
    const command = this.opts.codex?.binPath ?? 'codex'
    try {
      this.child = (this.opts.spawnFn ?? spawn)(command, ['app-server', '--listen', 'stdio://'], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      throw new Error(`Codex CLI could not start (${basename(command)}); check defaults.codex.binPath`)
    }
    const child = this.child
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: Buffer | string) => this.readOutput(String(chunk)))
    // Stderr can contain app-server diagnostics, including credentials. Never log it.
    child.stderr?.resume()
    child.on('error', () => this.stop(1, null,
      new Error(`Codex CLI could not start (${basename(command)}); check defaults.codex.binPath`)))
    // A child exiting on its own, even with code 0, lost the live channel.
    child.on('exit', (code, signal) => this.stop(code === 0 ? 1 : code, signal))

    try {
      await this.request('initialize', { clientInfo: { name: 'mcd', title: 'MCD', version: '1' }, capabilities: null })
      this.write({ method: 'initialized' })
      const threadFile = projectCodexThreadFile(this.slug)
      const hasSavedId = existsSync(threadFile)
      const savedId = hasSavedId ? readFileSync(threadFile, 'utf8').trim() : ''
      if (hasSavedId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(savedId)) {
        throw new Error('Saved Codex thread ID is invalid; remove .codex-thread-id to start a fresh thread')
      }
      const instructions = existsSync(projectClaudeMd(this.slug))
        ? readFileSync(projectClaudeMd(this.slug), 'utf8')
        : ''
      const params: JsonObject = {
        cwd,
        sandbox: this.opts.codex?.sandbox ?? 'workspace-write',
        approvalPolicy: this.opts.codex?.approvalPolicy ?? 'never',
        developerInstructions: instructions,
        config: {
          mcp_servers: {
            mcd: {
              url: this.opts.master.urlFor(this.chatId),
              env_http_headers: { 'x-mcd-token': 'MCD_MCP_TOKEN' },
              // The app-server has no interactive approval client. MCD already
              // authenticates this endpoint with a token scoped to one chat.
              default_tools_approval_mode: 'approve',
            },
          },
        },
      }
      if (this.opts.model) params.model = this.opts.model
      const method = savedId ? 'thread/resume' : 'thread/start'
      if (savedId) params.threadId = savedId
      let response: JsonObject
      try {
        response = await this.request(method, params)
      } catch {
        if (savedId) throw new Error('Codex thread resume failed; check auth or remove .codex-thread-id to start a fresh thread')
        throw new Error('Codex thread start failed; check CLI login, API key, and MCP configuration')
      }
      const thread = response.thread as JsonObject | undefined
      if (typeof thread?.id !== 'string' || !thread.id) throw new Error('Codex thread response has no ID')
      this.threadId = thread.id
      if (!savedId) {
        const temp = `${threadFile}.${process.pid}.tmp`
        try {
          writeFileSync(temp, thread.id, { mode: 0o600 })
          renameSync(temp, threadFile)
        } finally {
          try { unlinkSync(temp) } catch { /* renamed */ }
        }
      }
      if (this.queue.length) void this.pump()
    } catch (error) {
      this.stop(1, null)
      try { child.kill('SIGTERM') } catch { /* already exited */ }
      throw error
    }
  }

  private write(message: JsonObject): void {
    if (!this.alive || !this.child?.stdin?.writable) throw new Error('Codex app-server is not running')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private request(method: string, params: JsonObject): Promise<JsonObject> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.requests.set(id, { method, resolve, reject })
      try { this.write({ id, method, params }) }
      catch { this.requests.delete(id); reject(new Error(`Codex ${method} could not be sent`)) }
    })
  }

  private readOutput(chunk: string): void {
    if (!this.alive) return
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      try { this.handle(JSON.parse(line) as JsonObject) } catch { /* malformed output is not a protocol event */ }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handle(message: JsonObject): void {
    this.lastActivity = Date.now()
    if (typeof message.id === 'number') {
      const pending = this.requests.get(message.id)
      if (!pending) return
      this.requests.delete(message.id)
      if (message.error) pending.reject(new Error(`Codex ${pending.method} failed`))
      else pending.resolve((message.result ?? {}) as JsonObject)
      return
    }
    const method = message.method
    const params = message.params as JsonObject | undefined
    if (typeof method !== 'string' || !params) return
    if (method === 'mcpServer/startupStatus/updated' && params.name === 'mcd' && params.status === 'failed' &&
        (params.threadId === this.threadId || this.threadId === null)) {
      this.opts.log?.('Codex MCD MCP connection failed; check endpoint and authentication')
      this.stop(1, null)
      try { this.child?.kill('SIGTERM') } catch { /* already exited */ }
      return
    }
    if (params.threadId !== this.threadId || !this.active) return
    const turn = this.active
    if (method === 'turn/started') {
      const started = params.turn as JsonObject | undefined
      if (turn.id === null && typeof started?.id === 'string') turn.id = started.id
      return
    }
    if (method === 'turn/completed') {
      const completed = params.turn as JsonObject | undefined
      if (turn.id === null && typeof completed?.id === 'string') turn.id = completed.id
      if (!completed || completed.id !== turn.id) return
      if (completed.status === 'completed' && !turn.replied) {
        const items = Array.isArray(completed.items) ? completed.items as JsonObject[] : []
        const final = items.filter((item) => item.type === 'agentMessage' && item.phase !== 'commentary').at(-1)
        const text = (typeof final?.text === 'string' ? final.text : turn.finalText).trim()
        this.emitReply({ kind: 'text', chatId: this.chatId, replyTo: turn.envelope.messageId,
          text: text || 'Codex finished without sending a reply. Please resend your message.' })
      } else if (completed.status !== 'completed' && !turn.replied) {
        this.emitReply({ kind: 'text', chatId: this.chatId, replyTo: turn.envelope.messageId,
          text: 'Codex could not finish this message. Please resend it.' })
      }
      this.active = null
      turn.finish()
      if (completed.status !== 'completed') {
        this.opts.log?.(`Codex turn ${completed.status}; check CLI login and MCP authentication`)
        const child = this.child
        this.stop(1, null)
        try { child?.kill('SIGTERM') } catch { /* already exited */ }
      }
      return
    }
    if (params.turnId !== turn.id) return
    if (method === 'item/completed') {
      const item = params.item as JsonObject | undefined
      if (item?.type === 'agentMessage' && item.phase !== 'commentary' && typeof item.text === 'string') turn.finalText = item.text
      if (typeof item?.id === 'string') {
        const tool = turn.tools.get(item.id)
        if (tool) {
          turn.tools.delete(item.id)
          this.emitTool({ phase: 'done', toolId: item.id, toolName: tool.name,
            durationMs: Date.now() - tool.startedAt, isError: item.status === 'failed' || item.error != null })
        }
      }
    } else if (method === 'item/started') {
      const item = params.item as JsonObject | undefined
      if (!item || typeof item.id !== 'string') return
      const name = item.type === 'mcpToolCall' ? `${item.server}.${item.tool}` :
        item.type === 'commandExecution' ? 'commandExecution' :
        item.type === 'fileChange' ? 'fileChange' : null
      if (name) {
        turn.tools.set(item.id, { name, startedAt: Date.now() })
        this.emitTool({ phase: 'start', toolId: item.id, toolName: name, inputSummary: '' })
      }
    }
  }

  async deliver(envelope: InboundEnvelope): Promise<void> {
    if (this.stopped) throw new Error('Codex app-server is not running')
    this.queue.push({ envelope, receivedAt: Date.now() })
    this.lastActivity = Date.now()
    if (this.threadId) void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.alive || !this.threadId) return
    this.pumping = true
    try {
      while (this.alive && this.threadId && this.queue.length) {
        const queued = this.queue.shift()!
        let finish!: () => void
        const completed = new Promise<void>((resolve) => { finish = resolve })
        const turn: ActiveTurn = { ...queued, id: null, replied: false, finalText: '', finish, tools: new Map() }
        this.active = turn
        try {
          const response = await this.request('turn/start', {
            threadId: this.threadId,
            input: [{ type: 'text', text: this.formatEnvelope(queued.envelope), text_elements: [] }],
          })
          const started = response.turn as JsonObject | undefined
          if (typeof started?.id !== 'string') throw new Error('Codex turn response has no ID')
          if (turn.id && turn.id !== started.id) throw new Error('Codex turn ID changed during start')
          turn.id = started.id
          await completed
        } catch {
          this.opts.log?.('Codex turn failed; check CLI login, API key, and MCP authentication')
          this.stop(1, null)
          try { this.child?.kill('SIGTERM') } catch { /* already exited */ }
        }
      }
    } finally { this.pumping = false }
  }

  private formatEnvelope(envelope: InboundEnvelope): string {
    // Match Claude's channel envelope so existing project prompts work for either runner.
    const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/[\r\n]/g, ' ')
    const fields = [
      `source="${this.opts.platform ?? 'discord'}"`,
      `chat_id="${attr(this.chatId)}"`,
      `message_id="${attr(envelope.messageId)}"`,
      `user="${attr(envelope.username)}"`,
      `user_id="${attr(envelope.userId)}"`,
      `ts="${attr(envelope.ts)}"`,
    ]
    if (envelope.attachments?.length) {
      fields.push(`attachment_count="${envelope.attachments.length}"`)
      fields.push(`attachments="${attr(envelope.attachments.join('; '))}"`)
    }
    if (envelope.authorType === 'bot') fields.push('author_type="bot"')
    const body = envelope.content.replace(/<(\/?)channel\b/gi, '&lt;$1channel')
    return `<channel ${fields.join(' ')}>${body}</channel>`
  }

  acceptReply(reply: OutboundReply): void {
    if (!this.alive || reply.chatId !== this.chatId) return
    if (reply.kind === 'text' && this.active) {
      this.active.replied = true
      this.emitReply({ ...reply, replyTo: reply.replyTo ?? this.active.envelope.messageId })
      return
    }
    this.emitReply(reply)
  }

  private emitReply(reply: OutboundReply): void {
    if (!this.alive) return
    this.lastActivity = Date.now()
    for (const handler of this.replyHandlers) handler(reply)
  }

  private emitTool(event: ToolProgressEvent): void {
    for (const handler of this.toolHandlers) handler(event)
  }

  lastActivityMs(): number { return this.lastActivity }
  pendingDeliverAtMs(): number | null {
    if (this.active && !this.active.replied) return this.active.receivedAt
    return this.queue[0]?.receivedAt ?? null
  }
  inFlightToolSinceMs(): number | null {
    if (!this.active?.tools.size) return null
    return Math.min(...[...this.active.tools.values()].map((tool) => tool.startedAt))
  }
  isAlive(): boolean { return this.alive }
  isResponsive(): boolean { return this.alive }
  async getStats(): Promise<ProcessStats | null> {
    if (!this.alive) return null
    return { pid: this.child?.pid ?? null, uptimeMs: Date.now() - this.spawnedAt }
  }
  onReply(handler: (reply: OutboundReply) => void): () => void {
    this.replyHandlers.add(handler)
    return () => this.replyHandlers.delete(handler)
  }
  onExit(handler: (info: ExitInfo) => void): () => void {
    this.exitHandlers.add(handler)
    return () => this.exitHandlers.delete(handler)
  }
  onToolProgress(handler: (event: ToolProgressEvent) => void): () => void {
    this.toolHandlers.add(handler)
    return () => this.toolHandlers.delete(handler)
  }
  async kill(reason: 'idle-evict' | 'pool-full' | 'shutdown' | 'requested' | 'watchdog'): Promise<void> {
    if (this.stopped) return
    const child = this.child
    this.stop(0, 'SIGTERM', undefined, reason !== 'shutdown')
    try { child?.kill('SIGTERM') } catch { /* already exited */ }
  }

  private stop(code: number | null, signal: NodeJS.Signals | null, error?: Error, notifyPending = true): void {
    if (this.stopped) return
    if (notifyPending) {
      const pending = [
        ...(this.active && !this.active.replied ? [this.active.envelope] : []),
        ...this.queue.map((entry) => entry.envelope),
      ]
      for (const envelope of pending) {
        this.emitReply({ kind: 'text', chatId: this.chatId, replyTo: envelope.messageId,
          text: 'Codex stopped before answering this message. Please resend it.' })
      }
    }
    this.stopped = true
    this.alive = false
    this.queue = []
    this.active?.finish()
    this.active = null
    for (const pending of this.requests.values()) pending.reject(error ?? new Error(`Codex ${pending.method} stopped`))
    this.requests.clear()
    this.child?.stdin?.end()
    this.child?.stdout?.removeAllListeners('data')
    this.child?.stderr?.removeAllListeners('data')
    this.gitCredentialCleanup?.()
    this.gitCredentialCleanup = null
    for (const handler of this.exitHandlers) {
      try { handler({ code, signal }) } catch { /* one subscriber must not block teardown */ }
    }
  }
}
