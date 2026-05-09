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
import { z } from 'zod'

import type { OutboundReply } from './project-process.ts'

const ChatIdRoute = /^\/mcp\/(\d{15,25})\/?$/

export interface MasterMcpServerOptions {
  host?: string
  port?: number
  /** Replies emitted by Claude tool calls flow here, tagged with chat_id. */
  onReply: (reply: OutboundReply) => void
  /** Diagnostics. Defaults to stderr. */
  log?: (msg: string) => void
}

export class MasterMcpServer {
  private http: HttpServer | null = null
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
   * Stateless transport gives us no persistent connection to track. The
   * pool's earlier "wait for ready" was tied to that. Without it, we just
   * lean on the tmux TUI gate — claude eagerly connects MCP servers at
   * startup, so by the time the prompt is up the handshake has happened.
   * Keep the method as a no-op for callers that still expect it.
   */
  isChatReady(_chatId: string): boolean {
    return true
  }

  async waitForChatReady(_chatId: string): Promise<void> {
    // Stateless mode: no persistent session to wait on. Caller already
    // gated on the TUI prompt; that's our readiness signal.
  }

  /** No-op in stateless mode — kept for API compatibility with callers. */
  async closeChat(_chatId: string): Promise<void> {
    return
  }

  /**
   * Stateless mode has no persistent server-initiated notification path.
   * Send-keys delivers inbound messages to the per-channel claude
   * directly via its TTY; this method is intentionally a no-op.
   */
  async notifyChat(_chatId: string, _method: string, _params: Record<string, unknown>): Promise<void> {
    return
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''
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

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
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
      ],
    }))

    const ReplyArgsSchema = z.object({
      text: z.string().min(1),
      reply_to: z.string().optional(),
    })

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      if (req.params.name !== 'reply') {
        return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
      }
      const args = ReplyArgsSchema.safeParse(req.params.arguments)
      if (!args.success) {
        return { content: [{ type: 'text', text: `invalid reply args: ${args.error.toString()}` }], isError: true }
      }
      try {
        this.onReply({ kind: 'text', chatId, text: args.data.text, replyTo: args.data.reply_to })
        return { content: [{ type: 'text', text: 'ok' }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `reply dispatch failed: ${(err as Error).message}` }], isError: true }
      }
    })

    return server
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
