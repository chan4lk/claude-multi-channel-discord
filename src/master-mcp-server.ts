/**
 * In-process HTTP MCP server. One listener, multiplexed by URL path
 * `/mcp/<chat_id>`. Each chat gets its own Server + Transport pair on first
 * connect, and Claude Code subprocesses are pointed at the chat-specific URL
 * via their --mcp-config file.
 *
 * Why HTTP over stdio: we need a backend that works on Linux, macOS, and
 * Windows without OS-specific IPC. Localhost HTTP is identical on all three;
 * Unix sockets and named pipes are not.
 *
 * Phase 3b scope: only the `reply` tool is wired here. `react`,
 * `edit_message`, `download_attachment`, `fetch_messages` come in phase 3c
 * by extracting them from server.ts into a shared module.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { OutboundReply } from './project-process.ts'

const ChatIdRoute = /^\/mcp\/(\d{15,25})\/?$/

interface ChatSession {
  server: Server
  transport: StreamableHTTPServerTransport
  /** Has the client sent its initial connect (so server.notification works)? */
  ready: boolean
}

interface QueuedNotification {
  method: string
  params: Record<string, unknown>
}

export interface MasterMcpServerOptions {
  host?: string
  port?: number
  /** Replies emitted by Claude tool calls flow here, tagged with chat_id. */
  onReply: (reply: OutboundReply) => void
  /** Diagnostics. Defaults to stderr. */
  log?: (msg: string) => void
}

/**
 * Boilerplate-light HTTP listener that hands off each `/mcp/<chat_id>` request
 * to a chat-specific MCP transport. Tools registered on the per-chat Server
 * see the chat_id via closure — no per-request lookup needed.
 */
export class MasterMcpServer {
  private http: HttpServer | null = null
  private readonly sessions = new Map<string, ChatSession>()
  /**
   * Per-chat queue of notifications that arrived before the Claude
   * subprocess connected its MCP transport. Flushed on first ListTools
   * request from that chat. Bounded; oldest dropped when full.
   */
  private readonly pending = new Map<string, QueuedNotification[]>()
  private static readonly MAX_PENDING_PER_CHAT = 32
  private readonly host: string
  private readonly desiredPort: number
  private boundPort = 0
  private readonly onReply: (reply: OutboundReply) => void
  private readonly log: (msg: string) => void

  constructor(opts: MasterMcpServerOptions) {
    this.host = opts.host ?? '127.0.0.1'
    this.desiredPort = opts.port ?? 0
    this.onReply = opts.onReply
    this.log = opts.log ?? ((m) => process.stderr.write(`[mcp-master] ${m}\n`))
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.http) throw new Error('master MCP server already started')

    this.http = createServer((req, res) => {
      this.route(req, res).catch((err) => {
        this.log(`request failed: ${err}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'internal error' }))
        } else {
          res.end()
        }
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.http!.once('error', reject)
      this.http!.listen(this.desiredPort, this.host, () => resolve())
    })

    const addr = this.http.address() as AddressInfo
    this.boundPort = addr.port
    this.log(`listening on http://${this.host}:${this.boundPort}/mcp/<chat_id>`)
    return { host: this.host, port: this.boundPort }
  }

  async stop(): Promise<void> {
    for (const { transport, server } of this.sessions.values()) {
      try {
        await transport.close()
      } catch {}
      try {
        await server.close()
      } catch {}
    }
    this.sessions.clear()
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
   * Push a server-initiated notification to one chat's Claude session.
   * Queues if the chat doesn't have a live MCP transport yet — Claude takes
   * a few seconds to spawn + connect, and the user's first inbound message
   * usually arrives before then. Queued notifications flush on connect.
   */
  async notifyChat(chatId: string, method: string, params: Record<string, unknown>): Promise<void> {
    const session = this.sessions.get(chatId)
    if (!session || !session.ready) {
      this.enqueuePending(chatId, { method, params })
      this.log(`notify queued for ${chatId} (session ${session ? 'not yet ready' : 'absent'})`)
      return
    }
    try {
      await session.server.notification({ method, params })
    } catch (err) {
      this.log(`notification to ${chatId} failed: ${err}`)
    }
  }

  private enqueuePending(chatId: string, n: QueuedNotification): void {
    const q = this.pending.get(chatId) ?? []
    q.push(n)
    while (q.length > MasterMcpServer.MAX_PENDING_PER_CHAT) q.shift()
    this.pending.set(chatId, q)
  }

  private async flushPending(chatId: string): Promise<void> {
    const q = this.pending.get(chatId)
    if (!q || q.length === 0) return
    this.pending.delete(chatId)
    const session = this.sessions.get(chatId)
    if (!session) return
    this.log(`flushing ${q.length} queued notification(s) for ${chatId}`)
    for (const n of q) {
      try {
        await session.server.notification({ method: n.method, params: n.params })
      } catch (err) {
        this.log(`flush to ${chatId} failed: ${err}`)
      }
    }
  }

  /** Tear down a single chat's session — used when the pool kills its process. */
  async closeChat(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId)
    if (!session) return
    this.sessions.delete(chatId)
    try {
      await session.transport.close()
    } catch {}
    try {
      await session.server.close()
    } catch {}
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''
    const match = ChatIdRoute.exec(url)
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: `expected /mcp/<chat_id>, got ${url}` }))
      return
    }
    const chatId = match[1]!

    const session = this.sessions.get(chatId) ?? this.openSession(chatId)
    const body = await readBody(req)
    await session.transport.handleRequest(req, res, body)
  }

  private openSession(chatId: string): ChatSession {
    const server = new Server(
      { name: 'multi-channel-discord-master', version: '0.1.0' },
      {
        capabilities: {
          tools: {},
          experimental: {
            'claude/channel': {},
          },
        },
        instructions: [
          `You are running in a per-channel project session. The Discord channel id for this session is ${chatId}.`,
          'When a user message arrives via notifications/claude/channel, respond by calling the `reply` tool. Do not output transcript text — Discord users only see what reply emits.',
          'reply takes { text: string, reply_to?: string } where reply_to is the inbound message_id you want to thread under (omit for ordinary replies).',
        ].join('\n'),
      },
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      // First ListTools = Claude has connected and is asking for our tool
      // catalog. Mark the session ready and flush any notifications that
      // arrived during the spawn window.
      const s = this.sessions.get(chatId)
      if (s && !s.ready) {
        s.ready = true
        void this.flushPending(chatId)
      }
      return {
        tools: [
          {
            name: 'reply',
            description: 'Send a text reply to the Discord channel. Optionally thread under an inbound message_id.',
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
        ],
      }
    })

    const ReplyArgsSchema = z.object({
      text: z.string().min(1),
      reply_to: z.string().optional(),
    })

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      if (req.params.name !== 'reply') {
        return {
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
      }
      const args = ReplyArgsSchema.safeParse(req.params.arguments)
      if (!args.success) {
        return {
          content: [{ type: 'text', text: `invalid reply args: ${args.error.toString()}` }],
          isError: true,
        }
      }
      try {
        this.onReply({
          kind: 'text',
          chatId,
          text: args.data.text,
          replyTo: args.data.reply_to,
        })
        return { content: [{ type: 'text', text: 'ok' }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `reply dispatch failed: ${(err as Error).message}` }],
          isError: true,
        }
      }
    })

    const transport = new StreamableHTTPServerTransport({
      // Stateless mode — the URL path already identifies the chat. The
      // tmux+send-keys flow doesn't use server-initiated notifications, so
      // no SSE channel needs to stay open between requests. Avoids
      // "Conflict: Only one SSE stream is allowed per session" / "Server
      // already initialized" loops we hit with stateful sessionIds.
      sessionIdGenerator: undefined,
    })
    transport.onclose = () => {
      this.sessions.delete(chatId)
      this.log(`mcp transport closed for ${chatId}`)
    }
    transport.onerror = (err) => {
      this.log(`mcp transport error on ${chatId}: ${err.message}`)
    }

    void server.connect(transport).catch((err) => {
      this.log(`server.connect failed for ${chatId}: ${err}`)
    })

    const session: ChatSession = { server, transport, ready: false }
    this.sessions.set(chatId, session)
    return session
  }
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
