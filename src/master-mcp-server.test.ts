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

// ─── hermes_run project-channel access (AC2–AC5) ──────────────────────────
// Real launches write run metadata under hermesRunsDir(); point
// MCD_CHANNELS_DIR at a temp dir for the duration of this block.
{
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const hermesTmpDir = mkdtempSync(require('path').join(tmpdir(), 'mcd-hermes-test-'))
  const origChannelsDir = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = hermesTmpDir

  const HPI_MASTER = '990000000000000001'
  const HPI_ON     = '990000000000000002'  // project with hermes.enabled: true
  const HPI_OFF    = '990000000000000003'  // project with hermes.enabled: false
  const HPI_NONE   = '990000000000000004'  // project without a hermes block

  const hpiConfig = {
    version: 1 as const,
    master: { chatId: HPI_MASTER, commandPrefix: '!project' },
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' as const },
      providers: {},
      progressMode: 'off' as const,
      handoff: false,
      contextWarningThresholdPct: 80,
    },
    projects: {
      [HPI_ON]: { slug: 'proj-on', hermes: { enabled: true } },
      [HPI_OFF]: { slug: 'proj-off', hermes: { enabled: false } },
      [HPI_NONE]: { slug: 'proj-none' },
    },
  } as unknown as import('./channels-config.ts').ChannelsConfig

  const hpiReplies: OutboundReply[] = []
  const hpiBridgeOn = new MasterMcpServer({
    onReply: (r) => hpiReplies.push(r),
    getMasterChatId: () => HPI_MASTER,
    getHermesConfig: () => enabledHermesCfg,
    getConfig: () => hpiConfig,
    hermesSpawnFn: mockSpawn as any,
    log: () => {},
  })
  const hpiBridgeOff = new MasterMcpServer({
    onReply: (r) => hpiReplies.push(r),
    getMasterChatId: () => HPI_MASTER,
    getHermesConfig: () => ({ ...enabledHermesCfg, enabled: false }),
    getConfig: () => hpiConfig,
    hermesSpawnFn: mockSpawn as any,
    log: () => {},
  })
  const { host: onH, port: onP } = await hpiBridgeOn.start()
  const { host: offH, port: offP } = await hpiBridgeOff.start()

  async function hpiTools(srv: MasterMcpServer, h: string, p: number, chatId: string): Promise<string[]> {
    const list = await rpc(`http://${h}:${p}/mcp/${chatId}`, srv.tokenFor(chatId), 'tools/list', {})
    return (list.result?.tools ?? []).map((t: { name: string }) => t.name)
  }
  async function hpiCall(srv: MasterMcpServer, h: string, p: number, chatId: string, prompt: string) {
    return rpc(`http://${h}:${p}/mcp/${chatId}`, srv.tokenFor(chatId), 'tools/call', {
      name: 'hermes_run',
      arguments: { prompt },
    })
  }

  // AC2: tool-list matrix
  check('AC2: master + bridge-on → hermes_run listed', (await hpiTools(hpiBridgeOn, onH, onP, HPI_MASTER)).includes('hermes_run'))
  check('AC2: master + bridge-off → hermes_run NOT listed', !(await hpiTools(hpiBridgeOff, offH, offP, HPI_MASTER)).includes('hermes_run'))
  check('AC2: project flag-on + bridge-on → hermes_run listed', (await hpiTools(hpiBridgeOn, onH, onP, HPI_ON)).includes('hermes_run'))
  check('AC2: project flag-on + bridge-off → hermes_run NOT listed', !(await hpiTools(hpiBridgeOff, offH, offP, HPI_ON)).includes('hermes_run'))
  check('AC2: project flag-off + bridge-on → hermes_run NOT listed', !(await hpiTools(hpiBridgeOn, onH, onP, HPI_OFF)).includes('hermes_run'))
  check('AC2: project no hermes block + bridge-on → hermes_run NOT listed', !(await hpiTools(hpiBridgeOn, onH, onP, HPI_NONE)).includes('hermes_run'))

  // AC3 + AC4 + AC5: master + bridge-on → launched, prompt reports to master, no audit notice
  spawnCalls.length = 0
  hpiReplies.length = 0
  const hpiMasterRes = await hpiCall(hpiBridgeOn, onH, onP, HPI_MASTER, 'restart the mcd server')
  const hpiMasterText = hpiMasterRes.result?.content?.[0]?.text ?? ''
  check('AC3: master + bridge-on → launched', !hpiMasterRes.result?.isError && hpiMasterText.includes('launched'), JSON.stringify(hpiMasterRes).slice(0, 200))
  check('AC3: master + bridge-on → spawnFn called', spawnCalls.length === 1, JSON.stringify(spawnCalls.length))
  const masterWrapped = spawnCalls[0]?.args[1] ?? ''
  check('AC4: master run reports to master chat', masterWrapped.includes(`hermes send --to discord:${HPI_MASTER}`), masterWrapped)
  check('AC5: master launch → no audit notice', hpiReplies.length === 0, JSON.stringify(hpiReplies))

  // AC3 + AC4 + AC5: project flag-on + bridge-on → launched, prompt reports to project, one audit notice
  spawnCalls.length = 0
  hpiReplies.length = 0
  const hpiOnRes = await hpiCall(hpiBridgeOn, onH, onP, HPI_ON, 'deploy the docker image')
  const hpiOnText = hpiOnRes.result?.content?.[0]?.text ?? ''
  check('AC3: project flag-on + bridge-on → launched', !hpiOnRes.result?.isError && hpiOnText.includes('launched'), JSON.stringify(hpiOnRes).slice(0, 200))
  check('AC3: project flag-on + bridge-on → spawnFn called', spawnCalls.length === 1, JSON.stringify(spawnCalls.length))
  const projWrapped = spawnCalls[0]?.args[1] ?? ''
  check('AC4: project run reports to project chat', projWrapped.includes(`hermes send --to discord:${HPI_ON}`), projWrapped)
  check('AC4: project run does NOT report to master chat', !projWrapped.includes(HPI_MASTER), projWrapped)
  const hpiRunId = /run (h-\S+) launched/.exec(hpiOnText)?.[1] ?? ''
  check('AC5: project launch → exactly one audit notice to master', hpiReplies.length === 1 && hpiReplies[0]?.chatId === HPI_MASTER, JSON.stringify(hpiReplies))
  const auditText = hpiReplies[0]?.kind === 'text' ? hpiReplies[0].text : ''
  check(
    'AC5: audit notice has runId + slug + prompt preview',
    hpiRunId.startsWith('h-') && auditText.includes(hpiRunId) && auditText.includes('proj-on') && auditText.includes('deploy the docker image'),
    auditText,
  )

  // AC5: prompt longer than 120 chars is truncated to 120 in the notice
  spawnCalls.length = 0
  hpiReplies.length = 0
  const longPrompt = 'x'.repeat(150)
  await hpiCall(hpiBridgeOn, onH, onP, HPI_ON, longPrompt)
  const longAudit = hpiReplies[0]?.kind === 'text' ? hpiReplies[0].text : ''
  check(
    'AC5: audit notice truncates prompt to 120 chars',
    hpiReplies.length === 1 && longAudit.includes(`"${'x'.repeat(120)}"`) && !longAudit.includes('x'.repeat(121)),
    longAudit,
  )

  // AC3: denied cases — error result, spawnFn NOT called
  spawnCalls.length = 0
  hpiReplies.length = 0
  const hpiOffBridgeMaster = await hpiCall(hpiBridgeOff, offH, offP, HPI_MASTER, 'nope')
  check('AC3: master + bridge-off → isError', hpiOffBridgeMaster.result?.isError === true, JSON.stringify(hpiOffBridgeMaster).slice(0, 200))
  const hpiOffBridgeProj = await hpiCall(hpiBridgeOff, offH, offP, HPI_ON, 'nope')
  check('AC3: project flag-on + bridge-off → isError', hpiOffBridgeProj.result?.isError === true, JSON.stringify(hpiOffBridgeProj).slice(0, 200))
  const hpiFlagOff = await hpiCall(hpiBridgeOn, onH, onP, HPI_OFF, 'nope')
  check('AC3: project flag-off + bridge-on → isError', hpiFlagOff.result?.isError === true, JSON.stringify(hpiFlagOff).slice(0, 200))
  const hpiNoBlock = await hpiCall(hpiBridgeOn, onH, onP, HPI_NONE, 'nope')
  check('AC3: project no hermes block + bridge-on → isError', hpiNoBlock.result?.isError === true, JSON.stringify(hpiNoBlock).slice(0, 200))
  check('AC3: denied cases never reach spawnFn', spawnCalls.length === 0, JSON.stringify(spawnCalls.length))
  check('AC3: denied cases emit no audit notice', hpiReplies.length === 0, JSON.stringify(hpiReplies))

  await hpiBridgeOn.stop()
  await hpiBridgeOff.stop()
  process.env.MCD_CHANNELS_DIR = origChannelsDir
  rmSync(hermesTmpDir, { recursive: true, force: true })
}

// ─── ask_project + learnings tests ───────────────────────────────────────────

const PEER_MASTER  = '555555555555555555'
const PEER_A_CHAT  = '666666666666666666'
const PEER_B_CHAT  = '777777777777777777'
const PEER_C_CHAT  = '888888888888888888'  // no peers config

const peerInjected: Array<{ chatId: string; envelope: { userId: string; content: string } }> = []
const peerMirrors:  Array<{ chatId: string; content: string }> = []

// Mock Discord client: captures channel.send calls for mirror verification (AC10)
const mockDiscordClient = {
  channels: {
    fetch: async (id: string) => ({
      isTextBased: () => true,
      type: 0, // GuildText
      send: async (msg: { content: string }) => {
        peerMirrors.push({ chatId: id, content: msg.content })
      },
    }),
  },
} as any

const peerPool = {
  deliver: async (chatId: string, envelope: { userId: string; content: string; messageId: string; username: string; ts: string }) => {
    peerInjected.push({ chatId, envelope })
  },
} as unknown as import('./project-pool.ts').ProjectPool

// Fake clock for cooldown tests (AC5)
let fakeNow = 1_000_000

// channels.json config with peer relationships:
// A ↔ B mutual consent, A → C one-way (C doesn't allow A), maxHops:2 for A
const peerConfig = {
  version: 1 as const,
  master: { chatId: PEER_MASTER, commandPrefix: '!project' },
  defaults: {
    model: 'sonnet',
    idleEvictMinutes: 15,
    maxConcurrent: 8,
    git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
    claude: { permissionMode: 'auto' as const },
    providers: {},
    progressMode: 'off' as const,
    handoff: false,
    contextWarningThresholdPct: 80,
  },
  projects: {
    [PEER_A_CHAT]: {
      slug: 'project-a',
      peers: { allow: ['project-b', 'project-c'], maxHops: 2 },
    },
    [PEER_B_CHAT]: {
      slug: 'project-b',
      peers: { allow: ['project-a'] },
    },
    [PEER_C_CHAT]: {
      slug: 'project-c',
      // no peers.allow — C accepts no peer messages
    },
  },
} as unknown as import('./channels-config.ts').ChannelsConfig

const serverPeer = new MasterMcpServer({
  onReply: () => {},
  getMasterChatId: () => PEER_MASTER,
  getPool: () => peerPool,
  getConfig: () => peerConfig,
  client: mockDiscordClient,
  now: () => fakeNow,
  log: () => {},
})
const { host: ph, port: pp } = await serverPeer.start()

function peerUrl(chatId: string) { return `http://${ph}:${pp}/mcp/${chatId}` }
function peerToken(chatId: string) { return serverPeer.tokenFor(chatId) }

// AC1: tools/list for project without peers config omits ask_project / learnings tools
const cList = await rpc(peerUrl(PEER_C_CHAT), peerToken(PEER_C_CHAT), 'tools/list', {})
const cTools = (cList.result?.tools ?? []).map((t: { name: string }) => t.name)
check('AC1: project without peers: ask_project absent', !cTools.includes('ask_project'), JSON.stringify(cTools))
check('AC1: project without peers: share_learning absent', !cTools.includes('share_learning'), JSON.stringify(cTools))
check('AC1: project without peers: read_learnings absent', !cTools.includes('read_learnings'), JSON.stringify(cTools))

// AC1: project with peers.allow non-empty sees all three tools
const aList = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/list', {})
const aTools = (aList.result?.tools ?? []).map((t: { name: string }) => t.name)
check('AC1: project with peers: ask_project listed', aTools.includes('ask_project'), JSON.stringify(aTools))
check('AC1: project with peers: share_learning listed', aTools.includes('share_learning'), JSON.stringify(aTools))
check('AC1: project with peers: read_learnings listed', aTools.includes('read_learnings'), JSON.stringify(aTools))

// AC1: master has learnings tools but NOT ask_project
const mList = await rpc(peerUrl(PEER_MASTER), peerToken(PEER_MASTER), 'tools/list', {})
const mTools = (mList.result?.tools ?? []).map((t: { name: string }) => t.name)
check('AC1: master: ask_project absent', !mTools.includes('ask_project'), JSON.stringify(mTools))
check('AC1: master: share_learning listed', mTools.includes('share_learning'), JSON.stringify(mTools))
check('AC1: master: read_learnings listed', mTools.includes('read_learnings'), JSON.stringify(mTools))

// AC2: A → B mutual consent — delivery succeeds
peerInjected.length = 0
peerMirrors.length = 0
fakeNow = 2_000_000
const askRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'hello from A' },
})
check(
  'AC2: ask_project A→B: tool ok result',
  askRes.result && !askRes.result.isError,
  JSON.stringify(askRes).slice(0, 300),
)
const askParsed = JSON.parse(askRes.result?.content?.[0]?.text ?? '{}')
check('AC2: result has thread_id', typeof askParsed.thread_id === 'string' && askParsed.thread_id.startsWith('t-'), JSON.stringify(askParsed))
check('AC2: result has hop=1', askParsed.hop === 1, JSON.stringify(askParsed))
check('AC2: pool received envelope', peerInjected.length === 1 && peerInjected[0]!.chatId === PEER_B_CHAT, JSON.stringify(peerInjected))
check(
  'AC2: envelope userId=peer:project-a',
  peerInjected[0]!.envelope.userId === 'peer:project-a',
  JSON.stringify(peerInjected[0]?.envelope),
)
check(
  'AC2: envelope content matches FR5',
  peerInjected[0]!.envelope.content.includes('[Peer message from "project-a"') &&
    peerInjected[0]!.envelope.content.includes('hello from A'),
  peerInjected[0]?.envelope.content,
)

// AC10: mirror posts to both channels
check('AC10: two mirror posts', peerMirrors.length === 2, JSON.stringify(peerMirrors))
check(
  'AC10: source mirror → target preview',
  peerMirrors.some(m => m.chatId === PEER_A_CHAT && m.content.includes('→ project-b')),
  JSON.stringify(peerMirrors),
)
check(
  'AC10: target mirror from source preview',
  peerMirrors.some(m => m.chatId === PEER_B_CHAT && m.content.includes('from project-a')),
  JSON.stringify(peerMirrors),
)

// AC3: one-way allow — A allows C but C does not allow A → error
peerInjected.length = 0
fakeNow = 3_000_000
const oneWayRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-c', text: 'hello' },
})
check('AC3: one-way allow → isError', oneWayRes.result?.isError === true, JSON.stringify(oneWayRes).slice(0, 200))
check('AC3: nothing delivered', peerInjected.length === 0)

// AC4: hop budget — A has maxHops:2; third delivery on same thread refused
const threadForHopTest = `t-${Date.now()}-hoptest`
fakeNow = 4_000_000
const hop1 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'hop1', thread_id: threadForHopTest },
})
fakeNow += 60_000  // advance past cooldown
const hop2 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'hop2', thread_id: threadForHopTest },
})
fakeNow += 60_000
const hop3 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'hop3 should fail', thread_id: threadForHopTest },
})
check('AC4: hop1 succeeds', hop1.result && !hop1.result.isError, JSON.stringify(hop1).slice(0, 200))
check('AC4: hop2 succeeds', hop2.result && !hop2.result.isError, JSON.stringify(hop2).slice(0, 200))
check('AC4: hop3 refused (budget exhausted)', hop3.result?.isError === true, JSON.stringify(hop3).slice(0, 200))

// AC4: fresh thread delivers again after budget exhausted on previous thread
fakeNow += 60_000
const freshThread = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'fresh thread' },
})
check('AC4: fresh thread after budget exhausted succeeds', freshThread.result && !freshThread.result.isError, JSON.stringify(freshThread).slice(0, 200))

// AC5: cooldown — two deliveries on same pair within cooldownSeconds → second refused
const cooldownThread = `t-${Date.now()}-cooltest`
fakeNow = 10_000_000
const cd1 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'cd1', thread_id: cooldownThread },
})
// Immediately attempt second delivery (within cooldown window)
const cd2 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'cd2', thread_id: cooldownThread },
})
check('AC5: cd1 succeeds', cd1.result && !cd1.result.isError, JSON.stringify(cd1).slice(0, 200))
check('AC5: cd2 refused (cooldown)', cd2.result?.isError === true, JSON.stringify(cd2).slice(0, 200))

// Advance past cooldown (default 15s, A has no cooldownSeconds override)
fakeNow += 20_000
const cd3 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-b', text: 'cd3', thread_id: cooldownThread },
})
check('AC5: cd3 succeeds after cooldown window', cd3.result && !cd3.result.isError, JSON.stringify(cd3).slice(0, 200))

// AC6: ask_project targeting master slug → error
// (master chat is PEER_MASTER; its slug in projects map doesn't exist — no project entry for it)
// We test self-reference and unknown slug directly
const selfRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-a', text: 'self' },
})
check('AC6: self-target → isError', selfRes.result?.isError === true, JSON.stringify(selfRes).slice(0, 200))

const unknownRes2 = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'nonexistent-slug', text: 'hi' },
})
check('AC6: unknown slug → isError', unknownRes2.result?.isError === true, JSON.stringify(unknownRes2).slice(0, 200))

// AC6: project-C (no peers) calling ask_project → isError (not available)
const noPeerCallRes = await rpc(peerUrl(PEER_C_CHAT), peerToken(PEER_C_CHAT), 'tools/call', {
  name: 'ask_project',
  arguments: { target_slug: 'project-a', text: 'hi' },
})
check('AC6: project without peers.allow: ask_project → isError', noPeerCallRes.result?.isError === true, JSON.stringify(noPeerCallRes).slice(0, 200))

// AC6-disabled: ask_project to a disabled target → isError, nothing delivered
{
  // Build a fresh server with project-b marked disabled
  const DISABLED_MASTER = '111111111111111120'
  const DISABLED_A      = '111111111111111121'
  const DISABLED_B      = '111111111111111122'  // target; disabled

  const disabledPeerConfig = {
    version: 1 as const,
    master: { chatId: DISABLED_MASTER, commandPrefix: '!project' },
    defaults: {
      model: 'sonnet',
      idleEvictMinutes: 15,
      maxConcurrent: 8,
      git: { userName: 'bot', userEmail: 'bot@local', branchPrefix: 'claude/' },
      claude: { permissionMode: 'auto' as const },
      providers: {},
      progressMode: 'off' as const,
      handoff: false,
      contextWarningThresholdPct: 80,
    },
    projects: {
      [DISABLED_A]: { slug: 'da-src', peers: { allow: ['da-tgt'] } },
      [DISABLED_B]: { slug: 'da-tgt', peers: { allow: ['da-src'] }, disabled: true },
    },
  } as unknown as import('./channels-config.ts').ChannelsConfig

  const disabledInjected: Array<{ chatId: string }> = []
  const disabledPool = {
    deliver: async (chatId: string) => { disabledInjected.push({ chatId }) },
  } as unknown as import('./project-pool.ts').ProjectPool

  const serverDisabled = new MasterMcpServer({
    onReply: () => {},
    getMasterChatId: () => DISABLED_MASTER,
    getPool: () => disabledPool,
    getConfig: () => disabledPeerConfig,
    log: () => {},
  })
  const { host: dh, port: dp } = await serverDisabled.start()

  const disabledRes = await rpc(`http://${dh}:${dp}/mcp/${DISABLED_A}`, serverDisabled.tokenFor(DISABLED_A), 'tools/call', {
    name: 'ask_project',
    arguments: { target_slug: 'da-tgt', text: 'hello to disabled' },
  })
  check('AC6-disabled: ask_project to disabled target → isError', disabledRes.result?.isError === true, JSON.stringify(disabledRes).slice(0, 200))
  check('AC6-disabled: disabled target → nothing delivered', disabledInjected.length === 0)

  await serverDisabled.stop()
}

// ─── AC7: share_learning + read_learnings tool-level tests ───────────────────
// Use a temp dir so we don't write to the real MCD_CHANNELS_DIR.
{
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const learningsTmpDir = mkdtempSync(require('path').join(tmpdir(), 'mcd-ac7-test-'))
  const origChannelsDir = process.env.MCD_CHANNELS_DIR
  process.env.MCD_CHANNELS_DIR = learningsTmpDir

  // share_learning: happy path from a project with peers.allow
  const slRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'share_learning',
    arguments: { text: 'tool-level learning from project-a', tags: ['tool', 'test'] },
  })
  check('AC7: share_learning (project with peers): ok result', slRes.result && !slRes.result.isError, JSON.stringify(slRes).slice(0, 200))

  // read_learnings: returns the entry just appended
  const rlRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'read_learnings',
    arguments: {},
  })
  check('AC7: read_learnings returns ok', rlRes.result && !rlRes.result.isError, JSON.stringify(rlRes).slice(0, 200))
  const rlParsed = JSON.parse(rlRes.result?.content?.[0]?.text ?? '{}')
  check('AC7: read_learnings returns entries array', Array.isArray(rlParsed.entries), JSON.stringify(rlParsed))
  check('AC7: read_learnings entry count ≥ 1', rlParsed.entries.length >= 1, JSON.stringify(rlParsed))
  check('AC7: entry slug is project-a', rlParsed.entries[0]?.slug === 'project-a', JSON.stringify(rlParsed.entries[0]))
  check('AC7: entry text matches', rlParsed.entries[0]?.text === 'tool-level learning from project-a', JSON.stringify(rlParsed.entries[0]))
  check('AC7: entry tags include "tool"', rlParsed.entries[0]?.tags?.includes('tool'), JSON.stringify(rlParsed.entries[0]))
  check('AC7: entry has ts (ISO string)', typeof rlParsed.entries[0]?.ts === 'string' && rlParsed.entries[0].ts.includes('T'), JSON.stringify(rlParsed.entries[0]))

  // share_learning: second entry for tag filter / limit / newest-first tests
  await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'share_learning',
    arguments: { text: 'second entry no tags' },
  })

  // read_learnings: tag filter excludes non-matching entries (AND semantics)
  const tagFilterRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'read_learnings',
    arguments: { tags: ['tool'] },
  })
  const tagFilterParsed = JSON.parse(tagFilterRes.result?.content?.[0]?.text ?? '{}')
  check('AC7: tag filter returns only matching entries', tagFilterParsed.entries?.length === 1, JSON.stringify(tagFilterParsed))
  check('AC7: tag filter entry text matches', tagFilterParsed.entries?.[0]?.text === 'tool-level learning from project-a', JSON.stringify(tagFilterParsed.entries?.[0]))

  // read_learnings: limit=1 returns newest first
  const limitRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'read_learnings',
    arguments: { limit: 1 },
  })
  const limitParsed = JSON.parse(limitRes.result?.content?.[0]?.text ?? '{}')
  check('AC7: limit=1 returns exactly 1 entry', limitParsed.entries?.length === 1, JSON.stringify(limitParsed))
  check('AC7: limit=1 returns newest entry first', limitParsed.entries?.[0]?.text === 'second entry no tags', JSON.stringify(limitParsed.entries?.[0]))

  // share_learning: master channel attribution ('master' slug)
  const masterSlRes = await rpc(peerUrl(PEER_MASTER), peerToken(PEER_MASTER), 'tools/call', {
    name: 'share_learning',
    arguments: { text: 'master channel learning', tags: ['master'] },
  })
  check('AC7: share_learning from master: ok', masterSlRes.result && !masterSlRes.result.isError, JSON.stringify(masterSlRes).slice(0, 200))
  const masterRlRes = await rpc(peerUrl(PEER_MASTER), peerToken(PEER_MASTER), 'tools/call', {
    name: 'read_learnings',
    arguments: { tags: ['master'] },
  })
  const masterRlParsed = JSON.parse(masterRlRes.result?.content?.[0]?.text ?? '{}')
  check('AC7: master learning slug is "master"', masterRlParsed.entries?.[0]?.slug === 'master', JSON.stringify(masterRlParsed.entries?.[0]))

  // Error paths: empty text → isError
  const emptyTextRes = await rpc(peerUrl(PEER_A_CHAT), peerToken(PEER_A_CHAT), 'tools/call', {
    name: 'share_learning',
    arguments: { text: '' },
  })
  check('AC7: share_learning empty text → isError', emptyTextRes.result?.isError === true, JSON.stringify(emptyTextRes).slice(0, 200))

  // Gating: project without peers.allow cannot use share_learning or read_learnings
  const cShareRes = await rpc(peerUrl(PEER_C_CHAT), peerToken(PEER_C_CHAT), 'tools/call', {
    name: 'share_learning',
    arguments: { text: 'should fail' },
  })
  check('AC7: share_learning gating: no peers → isError', cShareRes.result?.isError === true, JSON.stringify(cShareRes).slice(0, 200))

  const cReadRes = await rpc(peerUrl(PEER_C_CHAT), peerToken(PEER_C_CHAT), 'tools/call', {
    name: 'read_learnings',
    arguments: {},
  })
  check('AC7: read_learnings gating: no peers → isError', cReadRes.result?.isError === true, JSON.stringify(cReadRes).slice(0, 200))

  process.env.MCD_CHANNELS_DIR = origChannelsDir
  rmSync(learningsTmpDir, { recursive: true, force: true })
}

await serverPeer.stop()

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
