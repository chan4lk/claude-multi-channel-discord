/**
 * bun src/handoff.test.ts
 *
 * Cross-project handoff tool: tools/list gating (opt-in per project,
 * master always) and tools/call round-trips over raw JSON-RPC against a
 * mock pool — no live claude needed. The server is stateless, so each
 * request stands alone and no initialize handshake is required.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate state IO: the handoff tool writes shared/handoffs.json via the
// lazily-resolved MCD_CHANNELS_DIR. Without this, test-fixture handoffs
// (alpha→beta) leak into the live registry and the sweep escalates them
// to the real master channel.
const stateDir = mkdtempSync(join(tmpdir(), 'mcd-handoff-test-'))
process.env.MCD_CHANNELS_DIR = stateDir

import { ChannelsConfigSchema, type ChannelsConfig } from './channels-config.ts'
import { MasterMcpServer } from './master-mcp-server.ts'
import type { InboundEnvelope, OutboundReply } from './project-process.ts'
import type { ProjectPool } from './project-pool.ts'

let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`ok   ${name}`)
  } else {
    failed++
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * POST one JSON-RPC request and return the parsed response. The stateless
 * StreamableHTTPServerTransport answers as an SSE stream (`event: message`
 * + `data: {...}`) even for single requests, so parse both shapes.
 */
let rpcId = 0
async function rpc(targetUrl: string, token: string, method: string, params: Record<string, unknown>) {
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-mcd-token': token,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const text = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) return JSON.parse(line.slice(6))
    }
    throw new Error(`no data frame in SSE response: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text)
}

const MASTER_CHAT = '111111111111111111'
const ALPHA_CHAT = '222222222222222222' // handoff: true
const BETA_CHAT = '333333333333333333' // no opt-in (defaults.handoff false)

const config: ChannelsConfig = ChannelsConfigSchema.parse({
  master: { chatId: MASTER_CHAT },
  projects: {
    [ALPHA_CHAT]: { slug: 'alpha', handoff: true },
    [BETA_CHAT]: { slug: 'beta' },
  },
})

const replies: OutboundReply[] = []
const delivered: Array<{ chatId: string; envelope: InboundEnvelope }> = []
const mockPool = {
  deliver: async (chatId: string, envelope: InboundEnvelope) => {
    delivered.push({ chatId, envelope })
  },
} as unknown as ProjectPool

const server = new MasterMcpServer({
  onReply: (r) => replies.push(r),
  getMasterChatId: () => MASTER_CHAT,
  getPool: () => mockPool,
  getConfig: () => config,
  log: () => {},
})
const { host, port } = await server.start()
const urlFor = (chat: string) => `http://${host}:${port}/mcp/${chat}`

async function listTools(chat: string): Promise<string[]> {
  const res = await rpc(urlFor(chat), server.tokenFor(chat), 'tools/list', {})
  return (res.result?.tools ?? []).map((t: { name: string }) => t.name)
}

// ─── tools/list gating ──────────────────────────────────────────────────

check('tools/list (master): exposes handoff', (await listTools(MASTER_CHAT)).includes('handoff'))
check('tools/list (alpha, opted in): exposes handoff', (await listTools(ALPHA_CHAT)).includes('handoff'))
check('tools/list (beta, not opted in): hides handoff', !(await listTools(BETA_CHAT)).includes('handoff'))

// ─── tools/call round-trips ─────────────────────────────────────────────

// alpha → beta: delivered to beta's chat with source attribution
const ok = await rpc(urlFor(ALPHA_CHAT), server.tokenFor(ALPHA_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: { target_slug: 'beta', message: 'please finish the migration' },
})
check('handoff (alpha→beta): tool call succeeds', ok.result && !ok.result.isError, JSON.stringify(ok).slice(0, 200))
const d = delivered[0]
check(
  'handoff (alpha→beta): envelope delivered to beta chat with source attribution',
  delivered.length === 1 &&
    d?.chatId === BETA_CHAT &&
    d.envelope.userId === 'handoff:alpha' &&
    d.envelope.username === 'handoff:alpha' &&
    d.envelope.content.includes('alpha') &&
    d.envelope.content.includes('please finish the migration') &&
    d.envelope.messageId.startsWith('handoff-'),
  JSON.stringify(delivered),
)
const okBody = JSON.parse(ok.result?.content?.[0]?.text ?? '{}')
check(
  'handoff (alpha→beta): result reports target slug + chat id',
  okBody.ok === true && okBody.target_slug === 'beta' && okBody.target_chat_id === BETA_CHAT,
  JSON.stringify(okBody),
)

// master → alpha: attributed to 'master'
const fromMaster = await rpc(urlFor(MASTER_CHAT), server.tokenFor(MASTER_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: { target_slug: 'alpha', message: 'status check' },
})
check(
  'handoff (master→alpha): delivered with master attribution',
  fromMaster.result && !fromMaster.result.isError &&
    delivered.length === 2 &&
    delivered[1]?.chatId === ALPHA_CHAT &&
    delivered[1].envelope.userId === 'handoff:master',
  JSON.stringify(delivered[1] ?? null),
)

// ─── error paths ────────────────────────────────────────────────────────

// beta (not opted in) → refused, nothing delivered
const denied = await rpc(urlFor(BETA_CHAT), server.tokenFor(BETA_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: { target_slug: 'alpha', message: 'lateral move' },
})
check('handoff (beta, not opted in): refused', denied.result?.isError === true, JSON.stringify(denied).slice(0, 200))

// unknown target slug
const noSlug = await rpc(urlFor(ALPHA_CHAT), server.tokenFor(ALPHA_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: { target_slug: 'ghost', message: 'hello?' },
})
check('handoff: unknown target slug → isError', noSlug.result?.isError === true, JSON.stringify(noSlug).slice(0, 200))

// self-handoff
const selfH = await rpc(urlFor(ALPHA_CHAT), server.tokenFor(ALPHA_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: { target_slug: 'alpha', message: 'talking to myself' },
})
check('handoff: self-handoff → isError', selfH.result?.isError === true, JSON.stringify(selfH).slice(0, 200))

// missing args
const noArgs = await rpc(urlFor(ALPHA_CHAT), server.tokenFor(ALPHA_CHAT), 'tools/call', {
  name: 'handoff',
  arguments: {},
})
check('handoff: missing args → isError', noArgs.result?.isError === true, JSON.stringify(noArgs).slice(0, 200))

check('handoff: error paths deliver nothing', delivered.length === 2, String(delivered.length))

await server.stop()
rmSync(stateDir, { recursive: true, force: true })

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall handoff checks passed')
