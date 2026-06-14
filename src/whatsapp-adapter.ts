/**
 * WhatsAppAdapter — connection lifecycle and auth persistence for
 * the WhatsApp channel integration. Uses @whiskeysockets/baileys v6.
 *
 * T2: connection lifecycle + auth persistence (this file's skeleton).
 * T3: inbound message parsing (handleUpsert stub below).
 * T4: outbound postReply / updateActivity (stubs below).
 */

import { mkdirSync } from 'node:fs'
import { Boom } from '@hapi/boom'
import type { InboundEnvelope } from './project-process.ts'
import type { ChannelsConfig } from './channels-config.ts'

// Baileys exposes makeWASocket as both a named export and a default export.
// Using named import avoids the .default interop issue under bun/TS bundler mode.
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from '@whiskeysockets/baileys'
import type { WASocket, BaileysEventMap } from '@whiskeysockets/baileys'

// ---------------------------------------------------------------------------
// Minimal no-op logger satisfying Baileys' ILogger contract.
// ILogger is not re-exported from the package root; define a local structural
// match instead. Baileys is very noisy; this silences it without adding pino.
// ---------------------------------------------------------------------------

// Local structural match for Baileys' ILogger (not exported from package root).
interface BaileysLogger {
  level: string
  child(obj: Record<string, unknown>): BaileysLogger
  trace(obj: unknown, msg?: string): void
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

const noopLogger: BaileysLogger = {
  level: 'silent',
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  // ILogger.child must return an ILogger — return the same singleton.
  child: () => noopLogger,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppAdapterOpts {
  /** Directory where Baileys writes auth/creds files. Created at mode 0o700. */
  authDir: string
  /** Returns the current channels config (live, not snapshotted at construction). */
  getConfig: () => ChannelsConfig
  /** Called when a new inbound message is ready for the project pool. */
  onInbound: (chatId: string, env: InboundEnvelope) => void
  /**
   * Returns true if the given sender E.164 number is allowed to send messages.
   * server.ts wires this to `loadAccess().allowFrom.includes(id)`.
   */
  isAllowed: (senderId: string) => boolean
  /** Called with a QR code string whenever re-pairing is needed.
   *  server.ts is responsible for rendering it to PNG and posting to master. */
  onQr: (qr: string) => void
  /** Called for important lifecycle notices (e.g. permanent logout). */
  onNotice: (text: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters per WhatsApp message chunk (mirrors Teams CHUNK_SIZE). */
const WA_CHUNK_SIZE = 4000

// ---------------------------------------------------------------------------
// WhatsAppAdapter
// ---------------------------------------------------------------------------

export class WhatsAppAdapter {
  private sock: WASocket | null = null
  private stopped = false

  /** jid → chatId mapping, populated by T3 (handleUpsert). */
  private jidToChatId = new Map<string, string>()
  /** chatId → jid mapping, populated by T3. */
  private chatIdToJid = new Map<string, string>()

  constructor(private opts: WhatsAppAdapterOpts) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Connect to WhatsApp. Idempotent — calling again while connected is a no-op.
   * Spawns the Baileys socket, wires auth persistence, connection lifecycle
   * events, and inbound message upsert handler.
   */
  async start(): Promise<void> {
    if (this.sock && !this.stopped) return
    this.stopped = false
    await this._spawnSocket(0)
  }

  /**
   * Gracefully stop the adapter. Sets the stopped flag so the reconnect loop
   * exits, then ends the socket without logging out (preserves auth state).
   */
  async stop(): Promise<void> {
    this.stopped = true
    const sock = this.sock
    this.sock = null
    if (sock) {
      try {
        // end() closes the WebSocket without sending a logout IQ — auth is preserved.
        sock.end(undefined)
      } catch (err) {
        console.error('whatsapp: error closing socket on stop:', err)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle (T2 — fully implemented)
  // -------------------------------------------------------------------------

  private async _spawnSocket(retryDelayMs: number): Promise<void> {
    if (this.stopped) return

    // Ensure auth directory exists with tight permissions (NFR3).
    try {
      mkdirSync(this.opts.authDir, { recursive: true, mode: 0o700 })
    } catch (err) {
      console.error('whatsapp: failed to create authDir:', err)
      return
    }

    let saveCreds: () => Promise<void>
    let state: Awaited<ReturnType<typeof useMultiFileAuthState>>['state']

    try {
      const auth = await useMultiFileAuthState(this.opts.authDir)
      state = auth.state
      saveCreds = auth.saveCreds
    } catch (err) {
      console.error('whatsapp: failed to load auth state:', err)
      return
    }

    let sock: WASocket
    try {
      sock = makeWASocket({
        auth: state,
        logger: noopLogger,
        printQRInTerminal: false,
      })
    } catch (err) {
      console.error('whatsapp: failed to create socket:', err)
      this._scheduleReconnect(retryDelayMs)
      return
    }

    this.sock = sock

    // Persist credentials whenever Baileys updates them.
    sock.ev.on('creds.update', () => {
      saveCreds().catch((err) => {
        console.error('whatsapp: creds.update saveCreds error:', err)
      })
    })

    // Main lifecycle handler.
    sock.ev.on('connection.update', (update) => {
      try {
        const { connection, qr, lastDisconnect } = update

        if (qr) {
          // New QR available — forward to server.ts for PNG rendering.
          try {
            this.opts.onQr(qr)
          } catch (err) {
            console.error('whatsapp: onQr callback error:', err)
          }
        }

        if (connection === 'open') {
          console.error('whatsapp: connected')
        }

        if (connection === 'close') {
          this.sock = null
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
          const loggedOut = statusCode === DisconnectReason.loggedOut

          if (loggedOut) {
            console.error('whatsapp: session logged out — re-pair required')
            try {
              this.opts.onNotice(
                'WhatsApp session logged out — re-pair required'
              )
            } catch (err) {
              console.error('whatsapp: onNotice callback error:', err)
            }
            // Do NOT reconnect after a logout — credentials are invalidated.
            return
          }

          // Reconnect with exponential backoff (cap at 30 s) unless stopped.
          this._scheduleReconnect(retryDelayMs)
        }
      } catch (err) {
        console.error('whatsapp: connection.update handler error:', err)
      }
    })

    // Inbound messages — wired here, parsed in T3.
    sock.ev.on('messages.upsert', (upsert) => {
      try {
        this._handleUpsert(upsert)
      } catch (err) {
        console.error('whatsapp: messages.upsert handler error:', err)
      }
    })
  }

  /**
   * Schedule a reconnect after an exponential backoff delay.
   * Caps at 30 000 ms; doubles on each call.
   */
  private _scheduleReconnect(currentDelayMs: number): void {
    if (this.stopped) return
    const delay = currentDelayMs === 0 ? 1000 : Math.min(currentDelayMs * 2, 30_000)
    setTimeout(() => {
      if (this.stopped) return
      console.error(`whatsapp: reconnecting (delay was ${delay} ms)`)
      this._spawnSocket(delay).catch((err) => {
        console.error('whatsapp: _spawnSocket error:', err)
      })
    }, delay)
  }

  // -------------------------------------------------------------------------
  // T3 — inbound message parsing
  // -------------------------------------------------------------------------

  /**
   * Rebuild the jid↔chatId routing maps from the current config.
   * Called lazily at the start of _handleUpsert so config edits are picked
   * up without a restart.
   */
  private _refreshRouting(): void {
    this.jidToChatId.clear()
    this.chatIdToJid.clear()
    const config = this.opts.getConfig()
    for (const [chatId, project] of Object.entries(config.projects)) {
      if (project.platform === 'whatsapp' && project.whatsappJid) {
        this.jidToChatId.set(project.whatsappJid, chatId)
        this.chatIdToJid.set(chatId, project.whatsappJid)
      }
    }
  }

  /**
   * Handle a messages.upsert event from Baileys.
   * Parses WAMessage, resolves jid → chatId, builds InboundEnvelope,
   * calls this.opts.onInbound().
   */
  private _handleUpsert(upsert: BaileysEventMap['messages.upsert']): void {
    // Only process real-time notifications (not history sync).
    if (upsert.type !== 'notify') return

    // Rebuild routing maps on every upsert so config edits are picked up.
    this._refreshRouting()

    for (const msg of upsert.messages) {
      try {
        // Skip messages we sent ourselves.
        if (msg.key.fromMe) continue

        const remoteJid = msg.key.remoteJid
        if (!remoteJid) continue

        // Resolve jid → chatId.
        const chatId = this.jidToChatId.get(remoteJid)
        if (!chatId) {
          console.error(`whatsapp: drop — no project for jid ${remoteJid}`)
          continue
        }

        // Derive sender E.164 from remoteJid (format: <digits>@s.whatsapp.net).
        const e164 = remoteJid.split('@')[0]

        // Access-control check.
        if (!this.opts.isAllowed(e164)) {
          console.error(`whatsapp: drop — sender ${e164} not in allowFrom`)
          continue
        }

        // Extract text content.
        const text =
          msg.message?.conversation ??
          msg.message?.extendedTextMessage?.text ??
          ''

        // Extract attachment summaries (FR7) — no media bytes downloaded.
        const attachments: string[] = []

        if (msg.message?.imageMessage) {
          const m = msg.message.imageMessage
          const size = m.fileLength != null ? ` ${Number(m.fileLength)} bytes` : ''
          attachments.push(`image (${m.mimetype ?? 'image'}${size})`)
        }
        if (msg.message?.videoMessage) {
          const m = msg.message.videoMessage
          const size = m.fileLength != null ? ` ${Number(m.fileLength)} bytes` : ''
          attachments.push(`video (${m.mimetype ?? 'video'}${size})`)
        }
        if (msg.message?.audioMessage) {
          const m = msg.message.audioMessage
          const size = m.fileLength != null ? ` ${Number(m.fileLength)} bytes` : ''
          attachments.push(`audio (${m.mimetype ?? 'audio'}${size})`)
        }
        if (msg.message?.documentMessage) {
          const m = msg.message.documentMessage
          const size = m.fileLength != null ? ` ${Number(m.fileLength)} bytes` : ''
          const name = m.fileName ? ` "${m.fileName}"` : ''
          attachments.push(`document${name} (${m.mimetype ?? 'application/octet-stream'}${size})`)
        }
        if (msg.message?.stickerMessage) {
          const m = msg.message.stickerMessage
          attachments.push(`sticker (${m.mimetype ?? 'image/webp'})`)
        }

        // Skip if nothing to deliver.
        if (!text && attachments.length === 0) continue

        // Convert messageTimestamp (seconds) to ISO string.
        const tsSeconds = msg.messageTimestamp
        const tsMs =
          tsSeconds != null
            ? Number(tsSeconds) * 1000
            : Date.now()
        const ts = new Date(tsMs).toISOString()

        const env: InboundEnvelope = {
          messageId: msg.key.id ?? '',
          userId: e164,
          username: msg.pushName ?? e164,
          content: text,
          ts,
          ...(attachments.length > 0 ? { attachments } : {}),
        }

        this.opts.onInbound(chatId, env)
      } catch (err) {
        console.error('whatsapp: inbound parse error:', err)
      }
    }
  }

  // -------------------------------------------------------------------------
  // T4 stubs — outbound reply
  // -------------------------------------------------------------------------

  /**
   * Send a text reply to a WhatsApp chat identified by chatId.
   * Chunks text into <= WA_CHUNK_SIZE pieces and sends each in order.
   * Returns the Baileys message key id of the last sent chunk, or null on error.
   */
  async postReply(
    chatId: string,
    text: string,
    replyTo?: string  // unused — quoting not implemented (WhatsApp quoting requires the original WAMessage, which we do not retain)
  ): Promise<string | null> {
    this._refreshRouting()
    const jid = this.chatIdToJid.get(chatId)
    if (!jid) {
      console.error(`whatsapp: postReply — no jid for chatId ${chatId}`)
      return null
    }
    if (!this.sock) {
      console.error('whatsapp: postReply — socket not connected')
      return null
    }

    // Chunk text into <= WA_CHUNK_SIZE slices.
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += WA_CHUNK_SIZE) {
      chunks.push(text.slice(i, i + WA_CHUNK_SIZE))
    }
    if (chunks.length === 0) chunks.push('')

    let lastId: string | null = null
    try {
      for (const chunk of chunks) {
        const result = await this.sock.sendMessage(jid, { text: chunk })
        if (result?.key?.id) lastId = result.key.id
      }
    } catch (err) {
      console.error('whatsapp: postReply failed:', err)
      return null
    }
    return lastId
  }

  /**
   * Edit a previously sent WhatsApp message identified by (chatId, key).
   * Reconstructs the Baileys edit key from the stored message id and calls
   * sock.sendMessage with the edit field. Falls back to postReply on error.
   */
  async updateActivity(
    chatId: string,
    key: string,
    text: string
  ): Promise<void> {
    this._refreshRouting()
    const jid = this.chatIdToJid.get(chatId)
    if (!jid) {
      console.error(`whatsapp: updateActivity — no jid for chatId ${chatId}`)
      return
    }
    if (!this.sock) {
      console.error('whatsapp: updateActivity — socket not connected')
      return
    }

    const editKey = { remoteJid: jid, id: key, fromMe: true }
    try {
      await this.sock.sendMessage(jid, { text, edit: editKey })
    } catch (err) {
      console.error('whatsapp: updateActivity failed, falling back to send:', err)
      await this.postReply(chatId, text)
    }
  }
}
