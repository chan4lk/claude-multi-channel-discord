/**
 * bun src/whatsapp-adapter.test.ts
 *
 * Tests for WhatsAppAdapter._handleUpsert inbound message parsing (T3).
 * No real socket is opened — the adapter is constructed with mock opts and
 * _handleUpsert is exercised directly via a cast to any.
 *
 * AC3: text message from bound jid → onInbound called with correct envelope.
 * AC3: imageMessage from bound jid → attachment summary present.
 * AC4: sender not in allowFrom → onInbound NOT called.
 * Extra: message from unbound jid → onInbound NOT called.
 * Extra: fromMe=true message → onInbound NOT called.
 */

import type { BaileysEventMap } from '@whiskeysockets/baileys'
import type { InboundEnvelope } from './project-process.ts'
import { WhatsAppAdapter } from './whatsapp-adapter.ts'
import type { ChannelsConfig } from './channels-config.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? 'PASS' : 'FAIL'
  console.log(`${status}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOUND_JID = '15551234567@s.whatsapp.net'
const BOUND_CHAT_ID = '111111111111111111'
const BOUND_E164 = '15551234567'

const UNBOUND_JID = '19995559999@s.whatsapp.net'

function makeConfig(): ChannelsConfig {
  return {
    version: 1,
    master: { chatId: '999999999999999999', commandPrefix: '!project' },
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' },
      providers: {},
      progressMode: 'off',
      handoff: false,
      contextWarningThresholdPct: 80,
    },
    projects: {
      [BOUND_CHAT_ID]: {
        slug: 'wa-project',
        platform: 'whatsapp',
        whatsappJid: BOUND_JID,
      },
    },
  }
}

/** Build a minimal WAMessage for testing. */
function makeTextUpsert(opts: {
  remoteJid: string
  id?: string
  fromMe?: boolean
  text?: string
  pushName?: string
  timestampSec?: number
}): BaileysEventMap['messages.upsert'] {
  return {
    type: 'notify',
    messages: [
      {
        key: {
          remoteJid: opts.remoteJid,
          fromMe: opts.fromMe ?? false,
          id: opts.id ?? 'msg-001',
        },
        message: opts.text != null ? { conversation: opts.text } : undefined,
        pushName: opts.pushName ?? 'Test User',
        messageTimestamp: opts.timestampSec ?? 1700000000,
      },
    ],
  }
}

function makeImageUpsert(remoteJid: string): BaileysEventMap['messages.upsert'] {
  return {
    type: 'notify',
    messages: [
      {
        key: { remoteJid, fromMe: false, id: 'img-001' },
        message: {
          imageMessage: {
            mimetype: 'image/jpeg',
            fileLength: 204800,
          },
        },
        pushName: 'Img Sender',
        messageTimestamp: 1700000001,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Helper: build adapter with captured onInbound calls
// ---------------------------------------------------------------------------

function makeAdapter(opts?: {
  isAllowed?: (id: string) => boolean
  configOverride?: ChannelsConfig
}): { adapter: WhatsAppAdapter; calls: Array<{ chatId: string; env: InboundEnvelope }> } {
  const calls: Array<{ chatId: string; env: InboundEnvelope }> = []
  const adapter = new WhatsAppAdapter({
    authDir: '/tmp/wa-test-auth',
    getConfig: () => opts?.configOverride ?? makeConfig(),
    onInbound: (chatId, env) => calls.push({ chatId, env }),
    isAllowed: opts?.isAllowed ?? (() => true),
    onQr: () => {},
    onNotice: () => {},
  })
  return { adapter, calls }
}

// ---------------------------------------------------------------------------
// AC3 — text message from bound jid → onInbound called with correct envelope
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert = makeTextUpsert({
    remoteJid: BOUND_JID,
    id: 'msg-abc',
    text: 'Hello from WhatsApp',
    pushName: 'Alice',
    timestampSec: 1700000100,
  })
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('AC3 text: onInbound called once', calls.length === 1)
  check('AC3 text: chatId matches', calls[0]?.chatId === BOUND_CHAT_ID)
  check('AC3 text: messageId matches', calls[0]?.env.messageId === 'msg-abc')
  check('AC3 text: userId is E.164', calls[0]?.env.userId === BOUND_E164)
  check('AC3 text: username from pushName', calls[0]?.env.username === 'Alice')
  check('AC3 text: content matches', calls[0]?.env.content === 'Hello from WhatsApp')
  check('AC3 text: ts is ISO string from timestamp', calls[0]?.env.ts === new Date(1700000100 * 1000).toISOString())
  check('AC3 text: no attachments', calls[0]?.env.attachments === undefined)
}

// ---------------------------------------------------------------------------
// AC3 — imageMessage → attachment summary present
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert = makeImageUpsert(BOUND_JID)
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('AC3 image: onInbound called once', calls.length === 1)
  check('AC3 image: attachments array present', Array.isArray(calls[0]?.env.attachments))
  check(
    'AC3 image: attachment summary contains type and mime',
    (calls[0]?.env.attachments?.[0] ?? '').startsWith('image (image/jpeg'),
  )
}

// ---------------------------------------------------------------------------
// AC4 — sender not in allowFrom → onInbound NOT called
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter({ isAllowed: () => false })
  const upsert = makeTextUpsert({ remoteJid: BOUND_JID, text: 'blocked' })
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('AC4 blocked sender: onInbound NOT called', calls.length === 0)
}

// ---------------------------------------------------------------------------
// Extra — message from unbound jid → onInbound NOT called
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert = makeTextUpsert({ remoteJid: UNBOUND_JID, text: 'ignored' })
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('unbound jid: onInbound NOT called', calls.length === 0)
}

// ---------------------------------------------------------------------------
// Extra — fromMe=true → onInbound NOT called
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert = makeTextUpsert({ remoteJid: BOUND_JID, fromMe: true, text: 'my own msg' })
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('fromMe: onInbound NOT called', calls.length === 0)
}

// ---------------------------------------------------------------------------
// Extra — type 'append' (history sync) → onInbound NOT called
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert: BaileysEventMap['messages.upsert'] = {
    type: 'append',
    messages: [
      {
        key: { remoteJid: BOUND_JID, fromMe: false, id: 'hist-001' },
        message: { conversation: 'old message' },
        pushName: 'Bob',
        messageTimestamp: 1699000000,
      },
    ],
  }
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check("append type: onInbound NOT called", calls.length === 0)
}

// ---------------------------------------------------------------------------
// Extra — message with no text and no attachments → onInbound NOT called
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert = makeTextUpsert({ remoteJid: BOUND_JID })
  // Override: message has no text content
  upsert.messages[0].message = {}
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('no content: onInbound NOT called', calls.length === 0)
}

// ---------------------------------------------------------------------------
// Extra — extendedTextMessage.text path
// ---------------------------------------------------------------------------

{
  const { adapter, calls } = makeAdapter()
  const upsert: BaileysEventMap['messages.upsert'] = {
    type: 'notify',
    messages: [
      {
        key: { remoteJid: BOUND_JID, fromMe: false, id: 'ext-001' },
        message: {
          extendedTextMessage: { text: 'extended text' },
        },
        pushName: 'Carol',
        messageTimestamp: 1700000200,
      },
    ],
  }
  ;(adapter as unknown as { _handleUpsert: (u: typeof upsert) => void })._handleUpsert(upsert)

  check('extendedTextMessage: onInbound called', calls.length === 1)
  check('extendedTextMessage: content correct', calls[0]?.env.content === 'extended text')
}

// ---------------------------------------------------------------------------
// T4 — outbound postReply / updateActivity tests
// ---------------------------------------------------------------------------

// Helper: build a mock WASocket that records sendMessage calls.
type SendCall = [string, Record<string, unknown>]

function makeMockSock(opts?: {
  /** If provided, the nth call (0-indexed) throws this error instead of returning. */
  throwOnCall?: number
}): { sock: { sendMessage: (...args: unknown[]) => Promise<{ key: { id: string } }> }; calls: SendCall[] } {
  const calls: SendCall[] = []
  const sock = {
    async sendMessage(...args: unknown[]) {
      const idx = calls.length
      calls.push(args as SendCall)
      if (opts?.throwOnCall !== undefined && idx === opts.throwOnCall) {
        throw new Error('mock sendMessage error')
      }
      return { key: { id: `m${calls.length}` } }
    },
  }
  return { sock, calls }
}

// AC5: long text → 3 chunks (9000 chars / 4000 = ceil → 3 sends)
{
  const { adapter } = makeAdapter()
  const { sock, calls } = makeMockSock()
  ;(adapter as unknown as { sock: unknown; chatIdToJid: Map<string, string> }).sock = sock
  ;(adapter as unknown as { chatIdToJid: Map<string, string> }).chatIdToJid.set(BOUND_CHAT_ID, BOUND_JID)

  const longText = 'x'.repeat(9000)
  const result = await (adapter as unknown as { postReply: (chatId: string, text: string) => Promise<string | null> }).postReply(BOUND_CHAT_ID, longText)

  check('AC5 long text: sendMessage called 3 times', calls.length === 3, `got ${calls.length}`)
  check('AC5 long text: returned id is last chunk id', result === 'm3', `got ${result}`)
}

// AC5: short text → exactly 1 send
{
  const { adapter } = makeAdapter()
  const { sock, calls } = makeMockSock()
  ;(adapter as unknown as { sock: unknown; chatIdToJid: Map<string, string> }).sock = sock
  ;(adapter as unknown as { chatIdToJid: Map<string, string> }).chatIdToJid.set(BOUND_CHAT_ID, BOUND_JID)

  const result = await (adapter as unknown as { postReply: (chatId: string, text: string) => Promise<string | null> }).postReply(BOUND_CHAT_ID, 'hello')

  check('AC5 short text: sendMessage called once', calls.length === 1, `got ${calls.length}`)
  check('AC5 short text: returned id m1', result === 'm1', `got ${result}`)
}

// postReply when sock is null → returns null, no throw
{
  const { adapter } = makeAdapter()
  // sock stays null (default)
  ;(adapter as unknown as { chatIdToJid: Map<string, string> }).chatIdToJid.set(BOUND_CHAT_ID, BOUND_JID)

  let threw = false
  let result: string | null = null
  try {
    result = await (adapter as unknown as { postReply: (chatId: string, text: string) => Promise<string | null> }).postReply(BOUND_CHAT_ID, 'hi')
  } catch {
    threw = true
  }

  check('postReply no sock: returns null', result === null)
  check('postReply no sock: does not throw', !threw)
}

// updateActivity happy path → sendMessage called once with edit key whose id matches
{
  const { adapter } = makeAdapter()
  const { sock, calls } = makeMockSock()
  ;(adapter as unknown as { sock: unknown; chatIdToJid: Map<string, string> }).sock = sock
  ;(adapter as unknown as { chatIdToJid: Map<string, string> }).chatIdToJid.set(BOUND_CHAT_ID, BOUND_JID)

  let threw = false
  try {
    await (adapter as unknown as { updateActivity: (chatId: string, key: string, text: string) => Promise<void> }).updateActivity(BOUND_CHAT_ID, 'orig-key-123', 'edited text')
  } catch {
    threw = true
  }

  check('updateActivity happy: no throw', !threw)
  check('updateActivity happy: sendMessage called once', calls.length === 1, `got ${calls.length}`)
  const sentPayload = calls[0]?.[1] as { text?: string; edit?: { id?: string; remoteJid?: string; fromMe?: boolean } }
  check('updateActivity happy: edit.id matches key', sentPayload?.edit?.id === 'orig-key-123', `got ${sentPayload?.edit?.id}`)
  check('updateActivity happy: edit.remoteJid matches jid', sentPayload?.edit?.remoteJid === BOUND_JID)
  check('updateActivity happy: text correct', sentPayload?.text === 'edited text')
}

// updateActivity fallback: first sendMessage throws → falls back to postReply (send), no throw
{
  const { adapter } = makeAdapter()
  const { sock, calls } = makeMockSock({ throwOnCall: 0 })
  ;(adapter as unknown as { sock: unknown; chatIdToJid: Map<string, string> }).sock = sock
  ;(adapter as unknown as { chatIdToJid: Map<string, string> }).chatIdToJid.set(BOUND_CHAT_ID, BOUND_JID)

  let threw = false
  try {
    await (adapter as unknown as { updateActivity: (chatId: string, key: string, text: string) => Promise<void> }).updateActivity(BOUND_CHAT_ID, 'key-xyz', 'fallback text')
  } catch {
    threw = true
  }

  check('updateActivity fallback: no throw escapes', !threw)
  // call[0] throws, call[1] is the fallback postReply send
  check('updateActivity fallback: sendMessage called twice (edit + fallback)', calls.length === 2, `got ${calls.length}`)
  const fallbackPayload = calls[1]?.[1] as { text?: string; edit?: unknown }
  check('updateActivity fallback: fallback has no edit key', fallbackPayload?.edit === undefined)
  check('updateActivity fallback: fallback text correct', fallbackPayload?.text === 'fallback text')
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
