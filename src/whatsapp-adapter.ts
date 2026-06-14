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
  /** Called with a QR code string whenever re-pairing is needed.
   *  server.ts is responsible for rendering it to PNG and posting to master. */
  onQr: (qr: string) => void
  /** Called for important lifecycle notices (e.g. permanent logout). */
  onNotice: (text: string) => void
}

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
  // T3 stub — inbound message parsing
  // -------------------------------------------------------------------------

  /**
   * Handle a messages.upsert event from Baileys.
   * TODO (T3): Parse WAMessage, resolve jid → chatId, build InboundEnvelope,
   * call this.opts.onInbound().
   */
  private _handleUpsert(_upsert: BaileysEventMap['messages.upsert']): void {
    // TODO (T3): implement inbound message parsing
  }

  // -------------------------------------------------------------------------
  // T4 stubs — outbound reply
  // -------------------------------------------------------------------------

  /**
   * Send a text reply to a WhatsApp chat identified by chatId.
   * TODO (T4): Chunk text if needed, call sock.sendMessage(jid, { text }).
   * Returns the Baileys message key of the last sent chunk, or null on error.
   */
  async postReply(
    _chatId: string,
    _text: string,
    _replyTo?: string
  ): Promise<string | null> {
    // TODO (T4): implement outbound send
    return null
  }

  /**
   * Edit a previously sent WhatsApp message identified by (chatId, key).
   * TODO (T4): Use sock.sendMessage with edit key if supported by Baileys v6.
   */
  async updateActivity(
    _chatId: string,
    _key: string,
    _text: string
  ): Promise<void> {
    // TODO (T4): implement message edit
  }
}
