/**
 * In-process HTTP MCP server. One listener, multiplexed by URL path
 * `/mcp/<chat_id>`. Each chat's URL is the entire session identity —
 * we run STATELESS: new Server + new Transport per HTTP POST, connect,
 * handle, close. This is the canonical SDK pattern for stateless
 * Streamable HTTP MCP and avoids the SSE / session-id loops we hit
 * trying to share transports across requests.
 *
 * Tool surface: just `reply` (named `mcd` server, becomes
 * `mcp__mcd__reply` to claude). Other tools (`react`, `edit_message`,
 * `download_attachment`, `fetch_messages`) come in a later phase.
 *
 * Cross-platform: localhost HTTP works identically on Linux, macOS,
 * Windows. No Unix sockets, no named pipes.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ChannelType, type Attachment, type Client, type Message, type TextBasedChannel } from 'discord.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import type { spawn as SpawnFn } from 'node:child_process'

import { channelsDir } from './paths.ts'
import { effectivePeerLimits, findProjectBySlug, handoffEnabled, resolveCollabTarget, type ChannelsConfig, type HermesConfig } from './channels-config.ts'
import { completeHandoff, createHandoff, loadRegistry, type HandoffTarget } from './handoffs.ts'
import type { InboundEnvelope, OutboundReply } from './project-process.ts'
import type { ProjectPool } from './project-pool.ts'
import { MemoryStore, type MemoryType } from './memory-store.ts'
import { launchHermesRun } from './hermes-bridge.ts'
import { appendLearning, readLearnings } from './shared-learnings.ts'

const ChatIdRoute = /^\/mcp\/([A-Za-z0-9:_\-\.%+@]{3,300})\/?$/

export interface MasterMcpServerOptions {
  host?: string
  port?: number
  /** Replies emitted by Claude tool calls flow here, tagged with chat_id. */
  onReply: (reply: OutboundReply) => void
  /**
   * Discord.js client. Optional — when set, the master MCP server
   * exposes the full upstream tool surface (`react`, `edit_message`,
   * `download_attachment`, `fetch_messages`) which all act on Discord
   * directly. Without a client, only `reply` is exposed (delivered
   * via onReply).
   */
  client?: Client
  /**
   * Live read of the configured master chat id. Used to decide whether
   * a given session may use the privileged `run_master_command` tool.
   * Returns undefined when no master is configured (tool then absent).
   */
  getMasterChatId?: () => string | undefined
  /**
   * Executes a `!project ...` command body and returns the reply text
   * the parser would have produced. Only available to the master session.
   * The string passed in is the verb + flags WITHOUT the leading prefix:
   * e.g. `create --new-channel foo --slug foo --prompt "..."`.
   */
  executeMasterCommand?: (commandLine: string) => Promise<string>
  /**
   * Returns the live ProjectPool. Used by the `inject` tool to deliver a
   * synthetic envelope to an arbitrary project channel. Optional — when
   * absent the `inject` tool is not exposed.
   */
  getPool?: () => ProjectPool | null
  /**
   * Live read of channels.json. Required for the `handoff` tool (slug
   * resolution + per-project opt-in check). Optional — when absent the
   * `handoff` tool is not exposed.
   */
  getConfig?: () => ChannelsConfig | null
  /** Diagnostics. Defaults to stderr. */
  log?: (msg: string) => void
  /**
   * Optional adapter for MS Teams webhook activities. When set, POST
   * requests to `/teams` are forwarded here. When absent, `/teams`
   * returns 503. Declared as a structural (duck-typed) interface to
   * avoid importing TeamsAdapter directly.
   */
  teamsAdapter?: { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> }
  /**
   * Optional memory store. When set, the master channel's Claude session
   * gains four tools: `remember`, `recall`, `forget`, and `memory_stats`.
   */
  memoryStore?: MemoryStore
  /**
   * Returns the platform ('discord' | 'teams' | 'whatsapp') for a given
   * chatId. Used to gate Discord-only tool calls. Defaults to 'discord'.
   */
  getProjectPlatform?: (chatId: string) => string | undefined
  /**
   * Live read of the hermes config from channels.json defaults.hermes.
   * When set and hermes.enabled is true, the master session gains the
   * `hermes_run` tool. Optional — when absent the tool is never listed.
   */
  getHermesConfig?: () => HermesConfig | undefined
  /**
   * Injectable spawn function for hermes_run. Defaults to Node's
   * child_process.spawn. Override in tests to avoid launching real processes.
   */
  hermesSpawnFn?: typeof SpawnFn
  /**
   * Injectable clock for cooldown calculations. Defaults to Date.now().
   * Override in tests to control time without real sleeps.
   */
  now?: () => number
}

export class MasterMcpServer {
  private http: HttpServer | null = null
  private readonly host: string
  private readonly desiredPort: number
  private boundPort = 0
  private readonly onReply: (reply: OutboundReply) => void
  private readonly client: Client | null
  private readonly getMasterChatId: () => string | undefined
  private readonly executeMasterCommand: ((cmd: string) => Promise<string>) | null
  private readonly log: (msg: string) => void
  private readonly teamsAdapter: { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined
  private readonly getPool: (() => ProjectPool | null) | undefined
  private readonly getConfig: (() => ChannelsConfig | null) | undefined
  private readonly memoryStore: MemoryStore | null
  private readonly getProjectPlatform: ((chatId: string) => string | undefined) | null
  private readonly getHermesConfig: (() => HermesConfig | undefined) | null
  private readonly hermesSpawnFn: typeof SpawnFn | undefined
  private readonly now: () => number
  /**
   * Per-thread hop counts (thread_id → deliveries so far).
   * Pruned FIFO at 500 entries. Process-lifetime only.
   */
  private readonly threadHops = new Map<string, number>()
  /**
   * Per-directed-pair last delivery timestamp (ms).
   * Key: "<srcSlug>→<dstSlug>".
   */
  private readonly pairLastSentMs = new Map<string, number>()
  /**
   * Per-chat bearer tokens. The endpoint is localhost-only but any local
   * process could otherwise POST /mcp/<chat_id> and reply as any channel —
   * or reach `run_master_command` by guessing the master chat id. A token
   * is minted per chat at spawn time, embedded in that project's
   * --mcp-config headers, and required on every request.
   */
  private readonly chatTokens = new Map<string, string>()

  constructor(opts: MasterMcpServerOptions) {
    this.host = opts.host ?? '127.0.0.1'
    this.desiredPort = opts.port ?? 0
    this.onReply = opts.onReply
    this.client = opts.client ?? null
    this.getMasterChatId = opts.getMasterChatId ?? (() => undefined)
    this.executeMasterCommand = opts.executeMasterCommand ?? null
    this.log = opts.log ?? ((m) => process.stderr.write(`[mcp-master] ${m}\n`))
    this.teamsAdapter = opts.teamsAdapter
    this.getPool = opts.getPool
    this.getConfig = opts.getConfig
    this.memoryStore = opts.memoryStore ?? null
    this.getProjectPlatform = opts.getProjectPlatform ?? null
    this.getHermesConfig = opts.getHermesConfig ?? null
    this.hermesSpawnFn = opts.hermesSpawnFn
    this.now = opts.now ?? (() => Date.now())
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.http) throw new Error('master MCP server already started')
    this.http = createServer((req, res) => {
      this.route(req, res).catch((err) => {
        this.log(`route() crashed: ${err}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'internal' } }))
        } else {
          res.end()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.http!.once('error', reject)
      this.http!.listen(this.desiredPort, this.host, () => resolve())
    })
    this.boundPort = (this.http!.address() as AddressInfo).port
    this.log(`listening on http://${this.host}:${this.boundPort}/mcp/<chat_id>`)
    return { host: this.host, port: this.boundPort }
  }

  async stop(): Promise<void> {
    if (this.http) {
      await new Promise<void>((resolve) => this.http!.close(() => resolve()))
      this.http = null
    }
    this.boundPort = 0
  }

  /** URL Claude should embed in its --mcp-config for this chat. */
  urlFor(chatId: string): string {
    if (!this.boundPort) throw new Error('master MCP server not started yet')
    return `http://${this.host}:${this.boundPort}/mcp/${chatId}`
  }

  /**
   * Bearer token for this chat, minted on first request. Embed as the
   * `x-mcd-token` header in the chat's --mcp-config alongside urlFor().
   */
  tokenFor(chatId: string): string {
    let token = this.chatTokens.get(chatId)
    if (!token) {
      token = randomBytes(24).toString('hex')
      this.chatTokens.set(chatId, token)
    }
    return token
  }

  private tokenValid(chatId: string, presented: string | string[] | undefined): boolean {
    const expected = this.chatTokens.get(chatId)
    if (!expected || typeof presented !== 'string') return false
    const a = Buffer.from(presented)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  // Stateless transport: no persistent server-side state per chat. The
  // pool used to call isChatReady / waitForChatReady / closeChat /
  // notifyChat against this server; with stateless HTTP MCP all of those
  // are meaningless. Kept here as a one-liner for any caller that hasn't
  // been migrated yet. New code should not call these.
  isChatReady(_chatId: string): boolean { return true }
  async waitForChatReady(_chatId: string): Promise<void> { /* no-op */ }
  async closeChat(_chatId: string): Promise<void> { /* no-op */ }
  async notifyChat(_chatId: string, _method: string, _params: Record<string, unknown>): Promise<void> { /* no-op */ }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''

    if (url === '/teams' && req.method === 'POST') {
      if (this.teamsAdapter) {
        await this.teamsAdapter.handleRequest(req, res)
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('Teams adapter not configured')
      }
      return
    }

    const match = ChatIdRoute.exec(url)
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32601, message: `expected /mcp/<chat_id>, got ${url}` } }))
      return
    }
    const chatId = match[1]!

    if (!this.tokenValid(chatId, req.headers['x-mcd-token'])) {
      this.log(`rejected /mcp/${chatId}: missing or bad x-mcd-token`)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'unauthorized' } }))
      return
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      // Stateless mode rejects these per the SDK example. Claude only POSTs.
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'method not allowed' } }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end()
      return
    }

    const body = await readBody(req)

    // Per-request server + transport (stateless pattern from SDK example).
    const server = this.buildServer(chatId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    transport.onerror = (err) => this.log(`transport error on ${chatId}: ${err.message}`)

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
      res.on('close', () => {
        void transport.close().catch(() => {})
        void server.close().catch(() => {})
      })
    } catch (err) {
      this.log(`handleRequest crashed for ${chatId}: ${err}`)
      try {
        await transport.close()
      } catch {}
      try {
        await server.close()
      } catch {}
      throw err
    }
  }

  private buildServer(chatId: string): Server {
    const server = new Server(
      { name: 'multi-channel-discord-master', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions: [
          `Per-channel project session for the multi-channel-discord bot. Discord channel id: ${chatId}.`,
          'Discord messages arrive in your prompt as <channel source="discord" ...>BODY</channel>. To respond, call the `mcp__mcd__reply` tool — that\'s how this fork delivers to Discord.',
          'Do NOT call `mcp__discord__reply` (the auto-loaded upstream plugin). Its access list belongs to a different bot and will refuse this channel.',
          'mcp__mcd__reply takes { text: string, reply_to?: string }. Omit reply_to for ordinary replies.',
        ].join('\n'),
      },
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
        {
          name: 'reply',
          description: 'Send a text reply to the Discord channel for this project session. Optional reply_to threads under an inbound message_id.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string', description: 'Reply body. Up to ~2000 chars per chunk.' },
              reply_to: { type: 'string', description: 'Inbound message_id to thread under.' },
            },
            required: ['text'],
          },
        },
      ]
      // Master-only privileged tool: lets the master channel's claude
      // execute the same `!project ...` commands the operator would type.
      // This is how natural-language requests in the master channel get
      // turned into actions ("create a project for keyflow at <url>"
      // → claude calls run_master_command("clone --new-channel ...")).
      if (this.getPool && this.getMasterChatId() === chatId) {
        tools.push({
          name: 'inject',
          description: 'Inject a synthetic message into a project channel as if it arrived from the heartbeat user. Only available in the master channel. Use to trigger a scheduled nudge or heartbeat in another channel.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              chatId: { type: 'string', description: 'The target project channel id.' },
              text: { type: 'string', description: 'The message text to inject.' },
            },
            required: ['chatId', 'text'],
          },
        })
      }
      // Cross-project handoff: exposed to the master session always, and to
      // project sessions the operator has opted in (project.handoff or
      // defaults.handoff). Off by default — handoff grants lateral reach
      // across project boundaries.
      if (this.handoffSource(chatId) !== null) {
        const roleNames = Object.keys(this.getConfig?.()?.projects[chatId]?.collab?.roles ?? {})
        const rolesHint = roleNames.length > 0 ? ` Configured roles: ${roleNames.join(', ')}.` : ''
        tools.push({
          name: 'handoff',
          description: `Hand a task off to another project's Claude session (by slug) or an allowlisted external bot peer (by role name or bot id). Use when the operator asks to delegate work (e.g. "@backend please finish this"). Pass exactly one of target_slug or role — role names come from this project's collab.roles.${rolesHint} Every handoff is tracked with a #h-<id> tag until the receiver (or master) calls handoff_complete. Internal targets get the message in their own session; their reply goes to their own channel, not here.`,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              target_slug: { type: 'string', description: 'Slug of the target project (as shown by `list`), or a literal bot-peer id from botPeers.allow. Mutually exclusive with role.' },
              role: { type: 'string', description: 'Role name from this project\'s collab.roles (e.g. "reviewer"). Mutually exclusive with target_slug.' },
              message: { type: 'string', description: 'The task or request to deliver to the target.' },
            },
            required: ['message'],
          },
        })
      }
      if (this.handoffCompleteAccess(chatId) !== null) {
        tools.push({
          name: 'handoff_complete',
          description: 'Mark a tracked handoff as done. Call this when you finish a task that arrived tagged #h-<id> (pass the id, with or without the leading #). Only the handoff\'s target session — or master — may close it. Idempotent: closing an already-done/expired id is an ok no-op.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', description: 'Handoff id, e.g. "h-abc123-4f2a" (a leading # is tolerated).' },
              outcome: { type: 'string', description: 'Optional short note on how the task was resolved.' },
            },
            required: ['id'],
          },
        })
      }
      if (this.executeMasterCommand && this.getMasterChatId() === chatId) {
        tools.push({
          name: 'run_master_command',
          description: 'Execute a multi-channel-discord master command (e.g. `list`, `create --new-channel foo --slug foo --prompt "..."`, `clone --new-channel x --slug y --repo URL`). Pass everything AFTER `!project` as `command`. ONLY available in the master channel — other channels can\'t see this tool. Use this to translate natural-language requests from the operator into actual project mutations.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              command: { type: 'string', description: 'Verb + flags, e.g. `create --new-channel keyflow --slug keyflow --prompt "..."`' },
            },
            required: ['command'],
          },
        })
      }
      if (this.hermesAccess(chatId) !== null) {
        tools.push({
          name: 'hermes_run',
          description: 'Launch a detached hermes-agent ops run on the host. The run survives MCD restarts. Hermes reports its result back to this channel via `hermes send` when finished. Available in the master channel and in project channels the operator has opted in (project hermes.enabled) when the hermes bridge is enabled.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt: { type: 'string', description: 'The ops task for Hermes to execute.' },
              model: { type: 'string', description: 'Optional model override (maps to hermes -m <model>).' },
            },
            required: ['prompt'],
          },
        })
      }
      // ask_project: cross-project peer dialogue. Only for non-master project sessions
      // with peers.allow non-empty.
      const peerSrc = this.peerSource(chatId)
      if (peerSrc !== null) {
        const config = this.getConfig?.() ?? null
        const srcProject = config?.projects[chatId]
        const limits = config && srcProject ? effectivePeerLimits(config, srcProject) : { maxHops: 6, cooldownSeconds: 15 }
        tools.push({
          name: 'ask_project',
          description: `Send a message to another project's Claude session by slug. Requires mutual consent (both sides must have each other in peers.allow). Budget: ${limits.maxHops} hops per thread; ${limits.cooldownSeconds}s cooldown per directed pair. Args: target_slug, text, thread_id (optional — omit to start a new thread).`,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              target_slug: { type: 'string', description: 'Slug of the target project.' },
              text: { type: 'string', description: 'Message to deliver.' },
              thread_id: { type: 'string', description: 'Continue an existing thread. Omit to start a new one.' },
            },
            required: ['target_slug', 'text'],
          },
        })
      }
      // share_learning / read_learnings: exposed to any project with peers.allow non-empty,
      // and to the master channel.
      const hasPeerAccess = peerSrc !== null || this.getMasterChatId() === chatId
      if (hasPeerAccess && this.getConfig) {
        tools.push(
          {
            name: 'share_learning',
            description: 'Append a slug-attributed, timestamped learning to the shared board (<MCD_CHANNELS_DIR>/shared/learnings.md). Entry cap: 2 KB. File cap: 64 KB (oldest dropped on overflow).',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string', description: 'The learning to record.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (e.g. ["tmux", "claude-cli"]).' },
              },
              required: ['text'],
            },
          },
          {
            name: 'read_learnings',
            description: 'Read entries from the shared learnings board, newest-first. Optional tag filter (AND semantics) and limit.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (AND semantics).' },
                limit: { type: 'number', description: 'Max entries to return (default 20).' },
              },
              required: [],
            },
          },
        )
      }
      if (this.client) {
        tools.push(
          {
            name: 'react',
            description: 'Add an emoji reaction to a Discord message. Unicode emoji work directly; custom emoji need the <:name:id> form.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                message_id: { type: 'string' },
                emoji: { type: 'string' },
                chat_id: { type: 'string', description: 'Defaults to this session\'s channel.' },
              },
              required: ['message_id', 'emoji'],
            },
          },
          {
            name: 'edit_message',
            description: "Edit a message the bot previously sent in this channel. Useful for interim progress updates. Edits don't trigger push notifications — send a new reply when a long task completes so the user's device pings.",
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                message_id: { type: 'string' },
                text: { type: 'string' },
                chat_id: { type: 'string', description: 'Defaults to this session\'s channel.' },
              },
              required: ['message_id', 'text'],
            },
          },
          {
            name: 'download_attachment',
            description: 'Download attachments from a specific Discord message to ~/.claude/channels/discord-multi/inbox/. Returns local paths ready to Read.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                message_id: { type: 'string' },
                chat_id: { type: 'string', description: 'Defaults to this session\'s channel.' },
              },
              required: ['message_id'],
            },
          },
          {
            name: 'fetch_messages',
            description: "Fetch recent messages from a Discord channel. Returns oldest-first with message IDs. Discord's search API isn't exposed to bots, so this is the only way to look back.",
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                limit: { type: 'number', description: 'Max messages (default 20, Discord caps at 100).' },
                channel: { type: 'string', description: 'Defaults to this session\'s channel.' },
              },
              required: [],
            },
          },
        )
      }
      if (this.memoryStore && chatId === this.getMasterChatId()) {
        tools.push(
          {
            name: 'remember',
            description: 'Save a memory about a channel or coordination decision. Only available in the master channel.',
            inputSchema: {
              type: 'object',
              properties: {
                slug: { type: 'string', description: 'Channel slug this memory is about. Omit for global memories.' },
                type: { type: 'string', enum: ['channel_summary', 'decision', 'pattern', 'coordination', 'general'], description: 'Memory type.' },
                content: { type: 'string', description: 'The memory content to store.' },
              },
              required: ['type', 'content'],
            },
          },
          {
            name: 'recall',
            description: 'Retrieve relevant memories by keyword or semantic query. Only available in the master channel.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query.' },
                slug: { type: 'string', description: 'Filter by channel slug.' },
                type: { type: 'string', enum: ['channel_summary', 'decision', 'pattern', 'coordination', 'general'], description: 'Filter by memory type.' },
                limit: { type: 'number', description: 'Max results (default 10, max 50).' },
              },
              required: ['query'],
            },
          },
          {
            name: 'forget',
            description: 'Delete a memory by id. Only available in the master channel.',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string', description: 'Memory id to delete.' } },
              required: ['id'],
            },
          },
          {
            name: 'memory_stats',
            description: 'Show memory counts by type and channel slug. Only available in the master channel.',
            inputSchema: { type: 'object', properties: {} },
          },
        )
      }
      return { tools }
    })

    const ReplyArgsSchema = z.object({
      text: z.string().min(1),
      reply_to: z.string().optional(),
    })

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name
      const args = (req.params.arguments ?? {}) as Record<string, unknown>
      try {
        switch (name) {
          case 'reply': {
            const parsed = ReplyArgsSchema.safeParse(args)
            if (!parsed.success) return errorResult(`invalid reply args: ${parsed.error.toString()}`)
            this.log(`reply tool called for ${chatId}: text=${JSON.stringify(parsed.data.text).slice(0, 60)} reply_to=${parsed.data.reply_to ?? '-'}`)
            this.onReply({ kind: 'text', chatId, text: parsed.data.text, replyTo: parsed.data.reply_to })
            return okResult('ok')
          }
          case 'inject': {
            if (!this.getPool) return errorResult('inject not configured')
            if (this.getMasterChatId() !== chatId) {
              return errorResult('mcp__mcd__inject can only be called from the master channel')
            }
            const targetChatId = String(args.chatId ?? '').trim()
            const text = String(args.text ?? '').trim()
            if (!targetChatId) return errorResult('chatId is required')
            if (!text) return errorResult('text is required')
            const pool = this.getPool()
            if (!pool) return errorResult('pool not available')
            const envelope: InboundEnvelope = {
              messageId: `heartbeat-${Date.now()}`,
              userId: 'heartbeat',
              username: 'heartbeat',
              content: text,
              ts: new Date().toISOString(),
            }
            this.log(`inject tool: delivering to ${targetChatId}: ${JSON.stringify(text).slice(0, 60)}`)
            await pool.deliver(targetChatId, envelope)
            // Post the injected prompt to the target channel so the operator
            // can see what was injected without reading tmux logs.
            if (this.client) {
              try {
                const ch = await this.fetchTextChannel(targetChatId)
                await (ch as any).send({ content: `🤖 **Heartbeat injected:**\n> ${text.replace(/\n/g, '\n> ')}` })
              } catch (err) {
                this.log(`inject tool: failed to post visibility message: ${(err as Error).message}`)
              }
            }
            return okResult(JSON.stringify({ ok: true }))
          }
          case 'handoff': {
            const sourceSlug = this.handoffSource(chatId)
            if (sourceSlug === null) {
              return errorResult('handoff is not enabled for this project (set `handoff: true` on the project or defaults in channels.json)')
            }
            const targetSlug = String(args.target_slug ?? '').trim()
            const role = String(args.role ?? '').trim()
            const message = String(args.message ?? '').trim()
            if (targetSlug && role) return errorResult('pass exactly one of target_slug or role, not both')
            if (!targetSlug && !role) return errorResult('target_slug is required (or pass role)')
            if (!message) return errorResult('message is required')
            const config = this.getConfig!()
            if (!config) return errorResult('config not available')

            // Resolve the target. `role` always goes through resolveCollabTarget
            // (roles map to a slug or a bot-peer id). A bare `target_slug` keeps
            // the legacy slug-first resolution — same error strings as before —
            // and only falls through to resolveCollabTarget for literal bot-peer
            // ids from botPeers.allow.
            let target: HandoffTarget
            if (role) {
              const resolved = resolveCollabTarget(config, chatId, role)
              if ('error' in resolved) return errorResult(resolved.error)
              target = resolved
            } else {
              const hit = findProjectBySlug(config, targetSlug)
              if (hit) {
                if (hit.chatId === chatId) return errorResult('cannot hand off to the same project')
                target = { kind: 'project', slug: hit.project.slug, chatId: hit.chatId }
              } else {
                const resolved = resolveCollabTarget(config, chatId, targetSlug)
                if ('error' in resolved || resolved.kind !== 'botPeer') {
                  return errorResult(`no project with slug "${targetSlug}"`)
                }
                target = resolved
              }
            }

            if (target.kind === 'project') {
              // Refuse a disabled target BEFORE creating any registry record —
              // same wording as ask_project.
              if (config.projects[target.chatId]?.disabled) return errorResult('target project is disabled')
              const pool = this.getPool!()
              if (!pool) return errorResult('pool not available')
              const record = createHandoff({ from: sourceSlug, to: target, task: message }, this.now())
              const envelope: InboundEnvelope = {
                messageId: `handoff-${Date.now()}-${randomBytes(4).toString('hex')}`,
                userId: `handoff:${sourceSlug}`,
                username: `handoff:${sourceSlug}`,
                content: `[Cross-project handoff from "${sourceSlug}"] ${message} #${record.id}`,
                ts: new Date().toISOString(),
              }
              this.log(`handoff tool: ${sourceSlug} → ${target.slug} (${target.chatId}) #${record.id}: ${JSON.stringify(message).slice(0, 60)}`)
              await pool.deliver(target.chatId, envelope)
              // Post the handoff to the target channel so its operator sees
              // what arrived without reading tmux logs (same as inject).
              if (this.client) {
                try {
                  const ch = await this.fetchTextChannel(target.chatId)
                  await (ch as any).send({ content: `🔀 **Handoff from \`${sourceSlug}\`** (#${record.id}):\n> ${message.replace(/\n/g, '\n> ')}` })
                } catch (err) {
                  this.log(`handoff tool: failed to post visibility message: ${(err as Error).message}`)
                }
              }
              return okResult(JSON.stringify({ ok: true, id: record.id, target_slug: target.slug, target_chat_id: target.chatId }))
            }

            // External bot-peer target: bot peers share the source project's
            // channel (finaudit model) — no pool.deliver; post the mention to
            // the SOURCE channel so the peer bot picks it up there.
            const record = createHandoff({ from: sourceSlug, to: target, task: message }, this.now())
            this.log(`handoff tool: ${sourceSlug} → bot-peer ${target.botId} #${record.id}: ${JSON.stringify(message).slice(0, 60)}`)
            this.onReply({
              kind: 'text',
              chatId,
              text: `<@${target.botId}> [handoff #${record.id} from ${sourceSlug}] ${message}`,
            })
            return okResult(JSON.stringify({ ok: true, id: record.id, bot_id: target.botId }))
          }
          case 'handoff_complete': {
            const access = this.handoffCompleteAccess(chatId)
            if (access === null) return errorResult('handoff_complete is not available for this session')
            const id = String(args.id ?? '').trim().replace(/^#/, '')
            if (!id) return errorResult('id is required')
            const outcomeRaw = typeof args.outcome === 'string' ? args.outcome.trim() : ''
            const outcome = outcomeRaw || undefined
            const record = loadRegistry().find((r) => r.id === id)
            if (!record) return errorResult(`no handoff with id "${id}"`)
            // Strict record-level check (the listing gate is intentionally
            // broader — see handoffCompleteAccess): only the session the
            // handoff is addressed to, or master, may close it.
            if (access !== 'master' && record.to.chatId !== chatId) {
              return errorResult(`handoff ${id} is not addressed to this session`)
            }
            if (record.state !== 'pending') {
              // Idempotent: closing an already-closed handoff is an ok no-op.
              return okResult(JSON.stringify({ ok: true, id, state: record.state, note: `already ${record.state}` }))
            }
            const closed = completeHandoff(id, outcome, this.now())!
            this.log(`handoff_complete: ${id} closed by ${access === 'master' ? 'master' : chatId}`)
            return okResult(JSON.stringify({ ok: true, id, state: closed.state }))
          }
          case 'ask_project': {
            const srcSlug = this.peerSource(chatId)
            if (srcSlug === null) {
              return errorResult('ask_project is not available for this session (set peers.allow on the project in channels.json)')
            }
            const config = this.getConfig!()
            if (!config) return errorResult('config not available')
            const pool = this.getPool!()
            if (!pool) return errorResult('pool not available')

            const targetSlug = String(args.target_slug ?? '').trim()
            const text = String(args.text ?? '').trim()
            if (!targetSlug) return errorResult('target_slug is required')
            if (!text) return errorResult('text is required')

            // FR7: master is never a valid target
            if (config.master?.chatId && findProjectBySlug(config, targetSlug)?.chatId === config.master.chatId) {
              return errorResult('master project is not a valid ask_project target')
            }

            // FR6 self-reference guard
            if (targetSlug === srcSlug) return errorResult('cannot ask_project to the same project')

            const target = findProjectBySlug(config, targetSlug)
            if (!target) return errorResult(`no project with slug "${targetSlug}"`)

            // Refuse delivery to disabled projects
            if (target.project.disabled) return errorResult('target project is disabled')

            // FR2: mutual consent — target must also allow source
            const srcProject = config.projects[chatId]!
            const srcAllows = srcProject.peers?.allow ?? []
            if (!srcAllows.includes(targetSlug)) {
              return errorResult(`mutual consent required: source project does not allow "${targetSlug}" in its peers.allow`)
            }
            const tgtAllows = target.project.peers?.allow ?? []
            if (!tgtAllows.includes(srcSlug)) {
              return errorResult(`mutual consent required: target project "${targetSlug}" does not allow "${srcSlug}" in its peers.allow`)
            }

            // FR3: hop ledger
            const threadId = String(args.thread_id ?? '').trim() || `t-${Date.now()}-${randomBytes(4).toString('hex')}`
            const srcLimits = effectivePeerLimits(config, srcProject)
            const currentHops = this.threadHops.get(threadId) ?? 0
            if (currentHops >= srcLimits.maxHops) {
              return errorResult(`thread hop budget exhausted (${currentHops}/${srcLimits.maxHops}); start a new thread or wait for operator to reset`)
            }

            // FR4: per-pair cooldown
            const pairKey = `${srcSlug}→${targetSlug}`
            const lastSent = this.pairLastSentMs.get(pairKey) ?? 0
            const nowMs = this.now()
            const cooldownMs = srcLimits.cooldownSeconds * 1000
            const elapsed = nowMs - lastSent
            if (elapsed < cooldownMs) {
              const waitSec = Math.ceil((cooldownMs - elapsed) / 1000)
              return errorResult(`cooldown active: wait ${waitSec}s before sending to "${targetSlug}" again`)
            }

            // FR5: build envelope
            const hop = currentHops + 1
            const envelope: InboundEnvelope = {
              messageId: `peer-${Date.now()}-${randomBytes(4).toString('hex')}`,
              userId: `peer:${srcSlug}`,
              username: `peer:${srcSlug}`,
              content: `[Peer message from "${srcSlug}" thread=${threadId} hop=${hop}/${srcLimits.maxHops}] ${text}`,
              ts: new Date().toISOString(),
            }

            this.log(`ask_project: ${srcSlug} → ${targetSlug} (thread=${threadId} hop=${hop}/${srcLimits.maxHops})`)
            await pool.deliver(target.chatId, envelope)

            // Update state after successful delivery
            this.threadHops.set(threadId, hop)
            this.pruneThreadHops()
            this.pairLastSentMs.set(pairKey, nowMs)

            // FR6: mirror posts to both channels (best-effort)
            const preview = text.slice(0, 200)
            if (this.client) {
              // Mirror to source channel
              try {
                const srcCh = await this.fetchTextChannel(chatId)
                await (srcCh as any).send({ content: `🔁 → ${targetSlug}: ${preview}` })
              } catch (err) {
                this.log(`ask_project: failed to mirror to source channel ${chatId}: ${(err as Error).message}`)
              }
              // Mirror to target channel
              try {
                const tgtCh = await this.fetchTextChannel(target.chatId)
                await (tgtCh as any).send({ content: `🔁 from ${srcSlug}: ${preview}` })
              } catch (err) {
                this.log(`ask_project: failed to mirror to target channel ${target.chatId}: ${(err as Error).message}`)
              }
            }

            return okResult(JSON.stringify({ ok: true, thread_id: threadId, hop, max_hops: srcLimits.maxHops }))
          }
          case 'share_learning': {
            const hasPeerAccess = this.peerSource(chatId) !== null || this.getMasterChatId() === chatId
            if (!hasPeerAccess || !this.getConfig) {
              return errorResult('share_learning is not available for this session')
            }
            const config = this.getConfig()
            if (!config) return errorResult('config not available')
            const text = String(args.text ?? '').trim()
            if (!text) return errorResult('text is required')
            const rawTags = Array.isArray(args.tags) ? args.tags.map((t: unknown) => String(t)) : []

            // Determine slug for attribution
            const isMaster = this.getMasterChatId() === chatId
            const project = config.projects[chatId]
            const slug = isMaster ? 'master' : (project?.slug ?? chatId)

            try {
              appendLearning({ slug, text, tags: rawTags })
              return okResult(JSON.stringify({ ok: true }))
            } catch (err) {
              return errorResult((err as Error).message)
            }
          }
          case 'read_learnings': {
            const hasPeerAccess = this.peerSource(chatId) !== null || this.getMasterChatId() === chatId
            if (!hasPeerAccess || !this.getConfig) {
              return errorResult('read_learnings is not available for this session')
            }
            const rawTags = Array.isArray(args.tags) ? args.tags.map((t: unknown) => String(t)) : undefined
            const limitRaw = typeof args.limit === 'number' ? args.limit : 20
            const limit = Math.max(1, Math.min(limitRaw, 200))
            const entries = readLearnings({ tags: rawTags, limit })
            return okResult(JSON.stringify({ entries }))
          }
          case 'run_master_command': {
            if (!this.executeMasterCommand) return errorResult('run_master_command not configured')
            if (this.getMasterChatId() !== chatId) {
              return errorResult('run_master_command is only available in the master channel session')
            }
            const cmd = String(args.command ?? '').trim()
            if (!cmd) return errorResult('command is required')
            this.log(`run_master_command for ${chatId}: ${cmd.slice(0, 200)}`)
            const reply = await this.executeMasterCommand(cmd)
            return okResult(reply)
          }
          case 'hermes_run': {
            if (!this.getHermesConfig) return errorResult('hermes bridge not configured')
            const hermesCfg = this.getHermesConfig()
            if (!hermesCfg?.enabled) return errorResult('hermes bridge disabled')
            const access = this.hermesAccess(chatId)
            if (access === null) {
              return errorResult('hermes_run is not enabled for this project (set hermes.enabled on the project in channels.json or use !project set <slug> --hermes on --yes)')
            }
            const HermesRunArgsSchema = z.object({
              prompt: z.string().min(1, 'prompt must not be empty'),
              model: z.string().optional(),
            })
            const parsed = HermesRunArgsSchema.safeParse(args)
            if (!parsed.success) return errorResult(`invalid hermes_run args: ${parsed.error.toString()}`)
            this.log(`hermes_run for ${chatId}: prompt=${JSON.stringify(parsed.data.prompt).slice(0, 80)}`)
            try {
              const masterChatId = this.getMasterChatId()!
              const { runId, logPath } = launchHermesRun({
                prompt: parsed.data.prompt,
                cfg: hermesCfg,
                masterChatId,
                reportChatId: access === 'project' ? chatId : undefined,
                model: parsed.data.model,
                spawnFn: this.hermesSpawnFn,
              })
              if (access === 'project') {
                // FR5: master audit notice on every project-initiated launch.
                const slug = this.getConfig?.()?.projects[chatId]?.slug ?? chatId
                this.onReply({
                  kind: 'text',
                  chatId: masterChatId,
                  text: `🛰 hermes run ${runId} launched by ${slug}: "${parsed.data.prompt.slice(0, 120)}"`,
                })
              }
              return okResult(`run ${runId} launched; log: ${logPath}`)
            } catch (err) {
              return errorResult((err as Error).message)
            }
          }
          case 'react':
            return await this.callReact(chatId, args)
          case 'edit_message':
            return await this.callEditMessage(chatId, args)
          case 'download_attachment':
            return await this.callDownloadAttachment(chatId, args)
          case 'fetch_messages':
            return await this.callFetchMessages(chatId, args)
          case 'remember': {
            if (!this.memoryStore) return errorResult('memory store not configured')
            if (this.getMasterChatId() !== chatId) return errorResult('remember is only available in the master channel')
            const slug = typeof args.slug === 'string' ? args.slug : null
            const type = String(args.type ?? '') as MemoryType
            const content = String(args.content ?? '').trim()
            if (!content) return errorResult('content is required')
            const id = await this.memoryStore.remember(slug, type, content)
            return okResult(JSON.stringify({ ok: true, id }))
          }
          case 'recall': {
            if (!this.memoryStore) return errorResult('memory store not configured')
            if (this.getMasterChatId() !== chatId) return errorResult('recall is only available in the master channel')
            const query = String(args.query ?? '').trim()
            if (!query) return errorResult('query is required')
            const limit = typeof args.limit === 'number' ? Math.min(args.limit, 50) : 10
            const results = await this.memoryStore.recall(query, {
              slug: typeof args.slug === 'string' ? args.slug : undefined,
              type: typeof args.type === 'string' ? args.type as MemoryType : undefined,
              limit,
            })
            return okResult(JSON.stringify(results))
          }
          case 'forget': {
            if (!this.memoryStore) return errorResult('memory store not configured')
            if (this.getMasterChatId() !== chatId) return errorResult('forget is only available in the master channel')
            const id = String(args.id ?? '').trim()
            if (!id) return errorResult('id is required')
            this.memoryStore.forget(id)
            return okResult(JSON.stringify({ ok: true }))
          }
          case 'memory_stats': {
            if (!this.memoryStore) return errorResult('memory store not configured')
            if (this.getMasterChatId() !== chatId) return errorResult('memory_stats is only available in the master channel')
            const stats = this.memoryStore.stats()
            return okResult(JSON.stringify(stats))
          }
          default:
            return errorResult(`unknown tool: ${name}`)
        }
      } catch (err) {
        return errorResult(`${name} failed: ${(err as Error).message}`)
      }
    })

    return server
  }

  /**
   * Whether the session for `chatId` may initiate a cross-project handoff.
   * Returns the source slug to attribute the handoff to ('master' for the
   * master channel, the project slug otherwise), or null when handoff is
   * unavailable (not wired, unknown project, or not opted in).
   */
  private handoffSource(chatId: string): string | null {
    if (!this.getPool || !this.getConfig) return null
    const config = this.getConfig()
    if (!config) return null
    if (this.getMasterChatId() === chatId) return 'master'
    const project = config.projects[chatId]
    if (!project) return null
    return handoffEnabled(config, project) ? project.slug : null
  }

  /**
   * Whether the session for `chatId` may see/call `handoff_complete`.
   * Returns 'master' for the master channel, 'project' for any configured
   * project session, null otherwise.
   *
   * Listing-gate choice: the tool is listed for master and for EVERY
   * configured project session, not just sessions with a pending record —
   * the MCP tool list is fetched once at session start, so a registry-lookup
   * gate would go stale the moment a handoff arrives mid-session (which is
   * exactly when the target needs the tool). Listing broadly is safe because
   * handoff_complete grants no lateral reach: the call handler additionally
   * enforces the strict record-level check (caller must be the record's
   * to.chatId, or master) — defense in depth, same predicate in listing and
   * handler as with hermesAccess.
   */
  private handoffCompleteAccess(chatId: string): 'master' | 'project' | null {
    if (!this.getConfig) return null
    const config = this.getConfig()
    if (!config) return null
    if (this.getMasterChatId() === chatId) return 'master'
    if (config.projects[chatId]) return 'project'
    return null
  }

  /**
   * Whether the session for `chatId` may use `ask_project`.
   * Returns the source slug if: the session belongs to a non-master project
   * that has `peers.allow` non-empty, pool and config are wired.
   * Returns null otherwise (including master — master uses handoff instead).
   */
  private peerSource(chatId: string): string | null {
    if (!this.getPool || !this.getConfig) return null
    const config = this.getConfig()
    if (!config) return null
    // Master is explicitly excluded from ask_project (FR7)
    if (this.getMasterChatId() === chatId) return null
    const project = config.projects[chatId]
    if (!project) return null
    if (!project.peers?.allow?.length) return null
    return project.slug
  }

  /**
   * Whether the session for `chatId` may use `hermes_run`.
   * Returns 'master' for the master channel, 'project' for a project the
   * operator has opted in (project hermes.enabled), or null when the
   * bridge is not wired/enabled or the project is not opted in. Both the
   * tool listing and the call handler check this (defense in depth).
   */
  private hermesAccess(chatId: string): 'master' | 'project' | null {
    if (this.getHermesConfig?.()?.enabled !== true) return null
    if (this.getMasterChatId() === chatId) return 'master'
    if (this.getConfig?.()?.projects[chatId]?.hermes?.enabled === true) return 'project'
    return null
  }

  /** Prune threadHops to at most 500 entries (FIFO). */
  private pruneThreadHops(): void {
    if (this.threadHops.size > 500) {
      const toDelete = this.threadHops.size - 500
      let i = 0
      for (const key of this.threadHops.keys()) {
        if (i++ >= toDelete) break
        this.threadHops.delete(key)
      }
    }
  }

  // ─── upstream-parity tools (require this.client) ────────────────────────

  private async callReact(defaultChatId: string, args: Record<string, unknown>) {
    if (!this.client) return errorResult('react requires a discord client')
    const chatId = (args.chat_id as string | undefined) ?? defaultChatId
    const messageId = String(args.message_id ?? '')
    const emoji = String(args.emoji ?? '')
    if (!messageId || !emoji) return errorResult('react requires message_id + emoji')
    const channel = await this.fetchTextChannel(chatId)
    const msg = await (channel as TextBasedChannel & { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId)
    await msg.react(emoji)
    return okResult('reacted')
  }

  private async callEditMessage(defaultChatId: string, args: Record<string, unknown>) {
    if (!this.client) return errorResult('edit_message requires a discord client')
    const chatId = (args.chat_id as string | undefined) ?? defaultChatId
    const messageId = String(args.message_id ?? '')
    const text = String(args.text ?? '')
    if (!messageId || !text) return errorResult('edit_message requires message_id + text')
    const channel = await this.fetchTextChannel(chatId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages = (channel as any).messages
    const msg = (await messages.fetch(messageId)) as Message
    if (msg.author.id !== this.client.user?.id) return errorResult('can only edit messages this bot sent')
    // If newer messages exist the channel has moved on — send new instead of editing buried history
    const newer = await messages.fetch({ after: messageId, limit: 1 })
    if (newer.size > 0) {
      const sent = await (channel as any).send({ content: text }) as Message
      return okResult(`sent new (id: ${sent.id})`)
    }
    await msg.edit(text)
    return okResult('edited')
  }

  private async callDownloadAttachment(defaultChatId: string, args: Record<string, unknown>) {
    if (!this.client) return errorResult('download_attachment requires a discord client')
    const chatId = (args.chat_id as string | undefined) ?? defaultChatId
    const platform = this.getProjectPlatform?.(chatId) ?? 'discord'
    if (platform === 'teams') {
      return okResult(
        'Teams attachments are downloaded at message ingest. ' +
        'Their local paths appear in the `attachments` attribute of the `<channel>` tag — use the Read tool on those paths directly.'
      )
    }
    const messageId = String(args.message_id ?? '')
    if (!messageId) return errorResult('download_attachment requires message_id')
    const channel = await this.fetchTextChannel(chatId)
    const msg = await (channel as TextBasedChannel & { messages: { fetch: (id: string) => Promise<Message> } }).messages.fetch(messageId)
    if (msg.attachments.size === 0) return okResult('(no attachments on that message)')

    const inbox = join(channelsDir(), 'inbox')
    mkdirSync(inbox, { recursive: true, mode: 0o700 })

    const out: string[] = []
    for (const att of msg.attachments.values() as IterableIterator<Attachment>) {
      if (att.size > 25 * 1024 * 1024) {
        out.push(`(skipped ${att.name}: ${(att.size / 1024 / 1024).toFixed(1)}MB exceeds 25MB cap)`)
        continue
      }
      const res = await fetch(att.url)
      const buf = Buffer.from(await res.arrayBuffer())
      const safeName = (att.name ?? att.id).replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = join(inbox, `${messageId}-${att.id}-${safeName}`)
      writeFileSync(path, buf, { mode: 0o600 })
      out.push(path)
    }
    return okResult(out.join('\n'))
  }

  private async callFetchMessages(defaultChatId: string, args: Record<string, unknown>) {
    if (!this.client) return errorResult('fetch_messages requires a discord client')
    const chatId = (args.channel as string | undefined) ?? defaultChatId
    const limitRaw = args.limit
    const limit = Math.max(1, Math.min(typeof limitRaw === 'number' ? limitRaw : 20, 100))
    const channel = await this.fetchTextChannel(chatId)
    const fetched = await (channel as TextBasedChannel & {
      messages: { fetch: (opts: { limit: number }) => Promise<Map<string, Message>> }
    }).messages.fetch({ limit })

    // Discord returns newest-first; flip to oldest-first.
    const ordered = Array.from(fetched.values()).reverse()
    const lines = ordered.map((m) => {
      const atts = m.attachments.size > 0 ? ` +${m.attachments.size}att` : ''
      const body = (m.content || '(no content)').replace(/\n/g, ' ').slice(0, 240)
      return `[${m.id}] ${m.author.username}: ${body}${atts}`
    })
    return okResult(lines.join('\n') || '(no messages)')
  }

  private async fetchTextChannel(chatId: string): Promise<TextBasedChannel> {
    if (!this.client) throw new Error('no discord client')
    const ch = await this.client.channels.fetch(chatId)
    if (!ch || !ch.isTextBased()) throw new Error(`channel ${chatId} not found or not text-based`)
    if (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.DM) {
      // also allow threads which inherit text
      // (best-effort, narrowed for the common cases)
    }
    return ch as TextBasedChannel
  }
}

function okResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method !== 'POST') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`request body is not valid JSON: ${(err as Error).message}`)
  }
}
