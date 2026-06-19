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
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ChannelType, type Attachment, type Client, type Message, type TextBasedChannel } from 'discord.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

import { channelsDir } from './paths.ts'
import type { InboundEnvelope, OutboundReply } from './project-process.ts'
import type { ProjectPool } from './project-pool.ts'

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
  /** Diagnostics. Defaults to stderr. */
  log?: (msg: string) => void
  /**
   * Optional adapter for MS Teams webhook activities. When set, POST
   * requests to `/teams` are forwarded here. When absent, `/teams`
   * returns 503. Declared as a structural (duck-typed) interface to
   * avoid importing TeamsAdapter directly.
   */
  teamsAdapter?: { handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> }
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
            return okResult(JSON.stringify({ ok: true }))
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
          case 'react':
            return await this.callReact(chatId, args)
          case 'edit_message':
            return await this.callEditMessage(chatId, args)
          case 'download_attachment':
            return await this.callDownloadAttachment(chatId, args)
          case 'fetch_messages':
            return await this.callFetchMessages(chatId, args)
          default:
            return errorResult(`unknown tool: ${name}`)
        }
      } catch (err) {
        return errorResult(`${name} failed: ${(err as Error).message}`)
      }
    })

    return server
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
