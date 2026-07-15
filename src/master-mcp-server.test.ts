/**
 * bun src/master-mcp-server.test.ts
 *
 * Checks: start/stop lifecycle, URL routing rejects malformed paths, and a
 * full JSON-RPC tool round-trip (tools/list + tools/call) over plain fetch —
 * no live claude needed. The server is stateless (fresh Server + Transport
 * per POST), so each request stands alone and no initialize handshake is
 * required before tools/* calls.
 */
import type { InboundEnvelope, OutboundReply } from './project-process.ts'
import type { ProjectPool } from './project-pool.ts'
import { MasterMcpServer } from './master-mcp-server.ts'

let failed = 0
function check(label: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  -- ${detail ?? ''}`}`)
  if (!cond) failed++
}

const replies: OutboundReply[] = []
const server = new MasterMcpServer({
  onReply: (r) => replies.push(r),
  log: () => {}, // silence in test output
})

const { host, port } = await server.start()
check('server: bound to ephemeral port', port > 0 && host === '127.0.0.1')

const url = server.urlFor('123456789012345678')
check('urlFor: emits chat-scoped URL', url === `http://${host}:${port}/mcp/123456789012345678`)

// Bad URL → 404
const badRes = await fetch(`http://${host}:${port}/notmcp`)
check('GET /notmcp → 404', badRes.status === 404)

// Wrong shape of chat_id → 404 (too short — under 3 chars)
const wrongShape = await fetch(`http://${host}:${port}/mcp/ab`)
check('GET /mcp/ab → 404 (chat_id too short)', wrongShape.status === 404)

// No x-mcd-token → 401 even on a well-formed chat path
const noToken = await fetch(url, { method: 'POST', body: '{}' })
check('POST /mcp/<id> without token → 401', noToken.status === 401)

// Bad token → 401
const badToken = await fetch(url, { method: 'POST', body: '{}', headers: { 'x-mcd-token': 'wrong' } })
check('POST /mcp/<id> with bad token → 401', badToken.status === 401)

// tokenFor mints a stable token per chat
const t1 = server.tokenFor('123456789012345678')
const t2 = server.tokenFor('123456789012345678')
check('tokenFor: stable per chat', t1 === t2 && t1.length >= 32)
check('tokenFor: distinct across chats', server.tokenFor('999999999999999999') !== t1)

// notifyChat with no live session is a no-op (does not throw)
let notifyThrew = false
try {
  await server.notifyChat('123456789012345678', 'notifications/x', { y: 1 })
} catch {
  notifyThrew = true
}
check('notifyChat: tolerates absent session', !notifyThrew)

await server.stop()
check('stop(): completes without throwing', true)

// ─── tool round-trip over raw JSON-RPC (stateless: no initialize needed) ───

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
const PROJECT_CHAT = '222222222222222222'

replies.length = 0
const masterCommands: string[] = []
const injected: Array<{ chatId: string; envelope: InboundEnvelope }> = []
const mockPool = {
  deliver: async (chatId: string, envelope: InboundEnvelope) => {
    injected.push({ chatId, envelope })
  },
} as unknown as ProjectPool

const server2 = new MasterMcpServer({
  onReply: (r) => replies.push(r),
  getMasterChatId: () => MASTER_CHAT,
  executeMasterCommand: async (cmd) => {
    masterCommands.push(cmd)
    return `ran: ${cmd}`
  },
  getPool: () => mockPool,
  log: () => {},
})
const { host: h2, port: p2 } = await server2.start()
const masterUrl = `http://${h2}:${p2}/mcp/${MASTER_CHAT}`
const projectUrl = `http://${h2}:${p2}/mcp/${PROJECT_CHAT}`
const masterToken = server2.tokenFor(MASTER_CHAT)
const projectToken = server2.tokenFor(PROJECT_CHAT)

// tools/list: project channel sees only `reply`
const projList = await rpc(projectUrl, projectToken, 'tools/list', {})
const projTools = (projList.result?.tools ?? []).map((t: { name: string }) => t.name)
check('tools/list (project): exposes reply', projTools.includes('reply'), JSON.stringify(projTools))
check(
  'tools/list (project): hides master-only tools',
  !projTools.includes('run_master_command') && !projTools.includes('inject'),
  JSON.stringify(projTools),
)

// tools/list: master channel additionally sees inject + run_master_command
const masterList = await rpc(masterUrl, masterToken, 'tools/list', {})
const masterTools = (masterList.result?.tools ?? []).map((t: { name: string }) => t.name)
check(
  'tools/list (master): exposes inject + run_master_command',
  masterTools.includes('inject') && masterTools.includes('run_master_command'),
  JSON.stringify(masterTools),
)

// tools/call reply → OutboundReply lands in the sink tagged with chat_id
const replyRes = await rpc(projectUrl, projectToken, 'tools/call', {
  name: 'reply',
  arguments: { text: 'hello from test', reply_to: 'msg-42' },
})
check('reply: tool call succeeds', replyRes.result && !replyRes.result.isError, JSON.stringify(replyRes).slice(0, 200))
const sunk = replies[0]
check(
  'reply: sink received OutboundReply with chatId/text/replyTo',
  replies.length === 1 &&
    sunk?.kind === 'text' &&
    sunk.chatId === PROJECT_CHAT &&
    sunk.text === 'hello from test' &&
    sunk.replyTo === 'msg-42',
  JSON.stringify(replies),
)

// tools/call reply with bad args → isError, nothing hits the sink
const badReply = await rpc(projectUrl, projectToken, 'tools/call', { name: 'reply', arguments: {} })
check('reply: missing text → isError', badReply.result?.isError === true, JSON.stringify(badReply).slice(0, 200))
check('reply: bad args do not reach sink', replies.length === 1)

// tools/call run_master_command from master → executes and returns output
const cmdRes = await rpc(masterUrl, masterToken, 'tools/call', {
  name: 'run_master_command',
  arguments: { command: 'list' },
})
check(
  'run_master_command (master): executes command',
  masterCommands.length === 1 && masterCommands[0] === 'list' && cmdRes.result?.content?.[0]?.text === 'ran: list',
  JSON.stringify(cmdRes).slice(0, 200),
)

// tools/call run_master_command from a project channel → refused
const cmdDenied = await rpc(projectUrl, projectToken, 'tools/call', {
  name: 'run_master_command',
  arguments: { command: 'list' },
})
check(
  'run_master_command (project): refused with isError',
  cmdDenied.result?.isError === true && masterCommands.length === 1,
  JSON.stringify(cmdDenied).slice(0, 200),
)

// tools/call inject from master → envelope delivered through the pool
const injectRes = await rpc(masterUrl, masterToken, 'tools/call', {
  name: 'inject',
  arguments: { chatId: PROJECT_CHAT, text: 'nudge' },
})
check(
  'inject (master): delivers envelope to pool',
  injectRes.result &&
    !injectRes.result.isError &&
    injected.length === 1 &&
    injected[0]!.chatId === PROJECT_CHAT &&
    injected[0]!.envelope.content === 'nudge',
  JSON.stringify({ injectRes, injected }).slice(0, 300),
)

// tools/call inject from project channel → refused
const injectDenied = await rpc(projectUrl, projectToken, 'tools/call', {
  name: 'inject',
  arguments: { chatId: MASTER_CHAT, text: 'nope' },
})
check(
  'inject (project): refused with isError',
  injectDenied.result?.isError === true && injected.length === 1,
  JSON.stringify(injectDenied).slice(0, 200),
)

// unknown tool → isError result, not a transport crash
const unknownRes = await rpc(projectUrl, projectToken, 'tools/call', { name: 'nope', arguments: {} })
check('unknown tool: isError result', unknownRes.result?.isError === true, JSON.stringify(unknownRes).slice(0, 200))

await server2.stop()

// After stop, urlFor should error out cleanly.
let urlAfterStopThrew = false
try {
  server.urlFor('111111111111111111')
} catch {
  urlAfterStopThrew = true
}
check('urlFor after stop throws', urlAfterStopThrew)

// ─── hermes_run tool tests ────────────────────────────────────────────────

const HERMES_MASTER = '333333333333333333'
const HERMES_PROJECT = '444444444444444444'

type SpawnArgs = { file: string; args: string[]; options: Record<string, unknown> }
const spawnCalls: SpawnArgs[] = []

// Mock spawn: returns a minimal child process object (detached + unref pattern)
function mockSpawn(file: string, args: string[], options: Record<string, unknown>) {
  spawnCalls.push({ file, args, options })
  const child: any = {
    pid: 99999,
    unref() {},
    on(_ev: string, _cb: unknown) {},
  }
  return child
}

const enabledHermesCfg = {
  enabled: true,
  binPath: '/usr/local/bin/hermes',
  yolo: true,
  extraArgs: [] as string[],
}

// Server with hermes enabled
const serverHermesEnabled = new MasterMcpServer({
  onReply: () => {},
  getMasterChatId: () => HERMES_MASTER,
  getHermesConfig: () => enabledHermesCfg,
  hermesSpawnFn: mockSpawn as any,
  log: () => {},
})
const { host: hh, port: hp } = await serverHermesEnabled.start()
const hermesEnabledMasterUrl = `http://${hh}:${hp}/mcp/${HERMES_MASTER}`
const hermesEnabledProjectUrl = `http://${hh}:${hp}/mcp/${HERMES_PROJECT}`
const hermesEnabledMasterToken = serverHermesEnabled.tokenFor(HERMES_MASTER)
const hermesEnabledProjectToken = serverHermesEnabled.tokenFor(HERMES_PROJECT)

// tools/list: master chat with hermes enabled → includes hermes_run
const hermesEnabledMasterList = await rpc(hermesEnabledMasterUrl, hermesEnabledMasterToken, 'tools/list', {})
const hermesEnabledMasterTools = (hermesEnabledMasterList.result?.tools ?? []).map((t: { name: string }) => t.name)
check(
  'hermes_run (master, enabled): listed in tools',
  hermesEnabledMasterTools.includes('hermes_run'),
  JSON.stringify(hermesEnabledMasterTools),
)

// tools/list: non-master chat (hermes enabled) → excludes hermes_run
const hermesEnabledProjectList = await rpc(hermesEnabledProjectUrl, hermesEnabledProjectToken, 'tools/list', {})
const hermesEnabledProjectTools = (hermesEnabledProjectList.result?.tools ?? []).map((t: { name: string }) => t.name)
check(
  'hermes_run (project, enabled): NOT listed for non-master chat',
  !hermesEnabledProjectTools.includes('hermes_run'),
  JSON.stringify(hermesEnabledProjectTools),
)

// tools/call hermes_run with mock spawnFn → ok result contains run id
spawnCalls.length = 0
const hermesRunRes = await rpc(hermesEnabledMasterUrl, hermesEnabledMasterToken, 'tools/call', {
  name: 'hermes_run',
  arguments: { prompt: 'echo hello from hermes test' },
})
check(
  'hermes_run (master): ok result contains run id and log path',
  hermesRunRes.result && !hermesRunRes.result.isError &&
    (hermesRunRes.result.content?.[0]?.text ?? '').startsWith('run h-') &&
    (hermesRunRes.result.content?.[0]?.text ?? '').includes('log:'),
  JSON.stringify(hermesRunRes).slice(0, 300),
)
check(
  'hermes_run (master): spawn was called with correct binary',
  spawnCalls.length === 1 && spawnCalls[0]!.file === enabledHermesCfg.binPath,
  JSON.stringify(spawnCalls),
)

// tools/call hermes_run with empty prompt → isError
const hermesEmptyPromptRes = await rpc(hermesEnabledMasterUrl, hermesEnabledMasterToken, 'tools/call', {
  name: 'hermes_run',
  arguments: { prompt: '' },
})
check(
  'hermes_run (master): empty prompt → isError',
  hermesEmptyPromptRes.result?.isError === true,
  JSON.stringify(hermesEmptyPromptRes).slice(0, 200),
)

await serverHermesEnabled.stop()

// Server with hermes disabled (enabled: false) — tool must not appear
const serverHermesDisabled = new MasterMcpServer({
  onReply: () => {},
  getMasterChatId: () => HERMES_MASTER,
  getHermesConfig: () => ({ ...enabledHermesCfg, enabled: false }),
  log: () => {},
})
const { host: hdh, port: hdp } = await serverHermesDisabled.start()
const hermesDisabledMasterUrl = `http://${hdh}:${hdp}/mcp/${HERMES_MASTER}`
const hermesDisabledMasterToken = serverHermesDisabled.tokenFor(HERMES_MASTER)

const hermesDisabledList = await rpc(hermesDisabledMasterUrl, hermesDisabledMasterToken, 'tools/list', {})
const hermesDisabledTools = (hermesDisabledList.result?.tools ?? []).map((t: { name: string }) => t.name)
check(
  'hermes_run (master, disabled): NOT listed when hermes.enabled=false',
  !hermesDisabledTools.includes('hermes_run'),
  JSON.stringify(hermesDisabledTools),
)

// tools/call hermes_run when disabled → isError even if tool somehow called
const hermesDisabledCallRes = await rpc(hermesDisabledMasterUrl, hermesDisabledMasterToken, 'tools/call', {
  name: 'hermes_run',
  arguments: { prompt: 'should fail' },
})
check(
  'hermes_run (master, disabled): call returns isError',
  hermesDisabledCallRes.result?.isError === true,
  JSON.stringify(hermesDisabledCallRes).slice(0, 200),
)

await serverHermesDisabled.stop()

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
