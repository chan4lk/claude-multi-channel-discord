import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

import { CodexProjectProcess, type CodexProjectProcessOptions } from './codex-process.ts'
import { saveCredentials } from './git-credentials.ts'
import { projectCodexThreadFile, projectDir, projectSessionFile } from './paths.ts'
import type { InboundEnvelope, OutboundReply } from './project-process.ts'

const root = mkdtempSync(join(tmpdir(), 'mcd-codex-test-'))
process.env.MCD_CHANNELS_DIR = root

function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL ${message}`)
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('Timed out waiting for fake app-server event')
}

function envelope(id: string): InboundEnvelope {
  return { messageId: id, userId: 'user', username: 'Alice', content: `hello ${id}`, ts: new Date().toISOString() }
}

class FakeAppServer extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 1234
  commands: Array<{ id?: number; method: string; params?: Record<string, any> }> = []
  options: SpawnOptions | null = null
  threadId: string
  nextTurn = 1
  autoComplete = false
  completeBeforeTurnResponse = false

  constructor(threadId: string) {
    super()
    this.threadId = threadId
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const command = JSON.parse(line)
        this.commands.push(command)
        if (command.method === 'initialized') continue
        const result = command.method === 'initialize' ? { protocolVersion: '2025-01-01' } :
          command.method === 'thread/start' || command.method === 'thread/resume' ? { thread: { id: this.threadId } } :
          command.method === 'turn/start' ? { turn: { id: `turn-${this.nextTurn++}` } } : {}
        if (command.method === 'turn/start' && this.completeBeforeTurnResponse) {
          const turnId = (result as { turn: { id: string } }).turn.id
          this.emitMessage({ method: 'turn/started', params: { threadId: this.threadId, turn: { id: turnId, status: 'inProgress' } } })
          this.complete(turnId, 'completed', 'early final')
        }
        this.emitMessage({ id: command.id, result })
        if (command.method === 'turn/start' && this.autoComplete) {
          const turnId = (result as { turn: { id: string } }).turn.id
          queueMicrotask(() => this.complete(turnId, 'completed', 'done'))
        }
      }
    })
  }

  emitMessage(value: Record<string, unknown>): void { this.stdout.write(`${JSON.stringify(value)}\n`) }
  complete(turnId: string, status: string, text: string): void {
    this.emitMessage({ method: 'turn/completed', params: {
      threadId: this.threadId,
      turn: { id: turnId, status, items: [{ type: 'agentMessage', id: `item-${turnId}`, phase: 'final_answer', text }] },
    } })
  }
  kill(): boolean { this.emit('exit', 0, 'SIGTERM'); return true }
}

function setup(slug: string, threadId: string, extra: Partial<CodexProjectProcessOptions> = {}) {
  mkdirSync(projectDir(slug), { recursive: true })
  writeFileSync(join(projectDir(slug), 'CLAUDE.md'), `Instructions for ${slug}`)
  const fake = new FakeAppServer(threadId)
  const tokens = new Map<string, string>()
  const master = {
    urlFor: (chatId: string) => `http://127.0.0.1:4321/mcp/${chatId}`,
    tokenFor: (chatId: string) => {
      if (!tokens.has(chatId)) tokens.set(chatId, `secret-${chatId}`)
      return tokens.get(chatId)!
    },
  }
  const proc = new CodexProjectProcess({
    chatId: slug, slug, master, model: 'gpt-5-codex',
    spawnFn: (_command, _args, options) => { fake.options = options; return fake as unknown as ChildProcess },
    ...extra,
  })
  return { fake, proc }
}

async function testSetupAndIsolation(): Promise<void> {
  const a = setup('channel-a', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
  const b = setup('channel-b', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')
  writeFileSync(projectSessionFile('channel-a'), 'claude-session')
  await Promise.all([a.proc.start(), b.proc.start()])
  const aStart = a.fake.commands.find((c) => c.method === 'thread/start')!
  const bStart = b.fake.commands.find((c) => c.method === 'thread/start')!
  check(a.fake.commands[0]?.method === 'initialize', 'initialize first')
  check(a.fake.commands[0]?.params?.clientInfo?.title === 'MCD', 'initialize client title')
  check(aStart.params?.cwd === realpathSync(projectDir('channel-a')), 'project cwd')
  check(aStart.params?.model === 'gpt-5-codex', 'selected model')
  check(aStart.params?.sandbox === 'workspace-write' && aStart.params?.approvalPolicy === 'never', 'sandbox and approval')
  check(aStart.params?.developerInstructions === 'Instructions for channel-a', 'project instructions')
  check(aStart.params?.config?.mcp_servers?.mcd?.url.endsWith('/mcp/channel-a'), 'chat-specific MCP URL')
  check(aStart.params?.config?.mcp_servers?.mcd?.env_http_headers?.['x-mcd-token'] === 'MCD_MCP_TOKEN', 'MCP header environment mapping')
  check(JSON.stringify(aStart).indexOf('secret-channel-a') === -1, 'token absent from protocol')
  check((a.fake.options?.env as NodeJS.ProcessEnv).MCD_MCP_TOKEN === 'secret-channel-a', 'token in child environment')
  check((b.fake.options?.env as NodeJS.ProcessEnv).MCD_MCP_TOKEN === 'secret-channel-b', 'second chat token distinct')
  check(bStart.params?.config?.mcp_servers?.mcd?.url.endsWith('/mcp/channel-b'), 'second chat URL distinct')
  check(readFileSync(projectCodexThreadFile('channel-a'), 'utf8') === a.fake.threadId, 'thread ID persisted')
  check(readFileSync(projectSessionFile('channel-a'), 'utf8') === 'claude-session', 'Claude session untouched')
  await Promise.all([a.proc.kill('shutdown'), b.proc.kill('shutdown')])
  console.log('PASS AC-3 thread setup and chat isolation')
}

async function testQueueAndResume(): Promise<void> {
  const id = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
  const first = setup('queue', id)
  const starting = first.proc.start()
  check(first.proc.isAlive(), 'starting process remains pool-visible')
  await Promise.all([first.proc.deliver(envelope('m1')), first.proc.deliver(envelope('m2'))])
  await starting
  await until(() => first.fake.commands.filter((c) => c.method === 'turn/start').length === 1)
  const firstTurn = first.fake.commands.find((c) => c.method === 'turn/start')!
  check(firstTurn.params?.input?.[0]?.text.includes('<channel source="discord" chat_id="queue" message_id="m1"'), 'existing channel prompt envelope used')
  first.fake.complete('turn-1', 'completed', 'one')
  await until(() => first.fake.commands.filter((c) => c.method === 'turn/start').length === 2)
  first.fake.complete('turn-2', 'completed', 'two')
  await until(() => first.proc.pendingDeliverAtMs() === null)
  await first.proc.kill('idle-evict')
  const resumed = setup('queue', id)
  await resumed.proc.start()
  check(resumed.fake.commands.some((c) => c.method === 'thread/resume' && c.params?.threadId === id), 'stored ID resumed')
  check(!resumed.fake.commands.some((c) => c.method === 'thread/start'), 'no replacement thread')
  await resumed.proc.kill('shutdown')
  const early = setup('early-events', '88888888-8888-4888-8888-888888888888')
  const earlyReplies: OutboundReply[] = []
  early.fake.completeBeforeTurnResponse = true
  early.proc.onReply((reply) => earlyReplies.push(reply))
  await early.proc.start()
  await early.proc.deliver(envelope('early-message'))
  await until(() => earlyReplies.length === 1 && early.proc.pendingDeliverAtMs() === null)
  check(earlyReplies[0].kind === 'text' && earlyReplies[0].text === 'early final', 'early terminal notification completes turn')
  await early.proc.kill('shutdown')
  console.log('PASS AC-4 serial turns and persisted resume')
}

async function testReplies(): Promise<void> {
  const { fake, proc } = setup('replies', 'dddddddd-dddd-4ddd-dddd-dddddddddddd')
  const replies: OutboundReply[] = []
  proc.onReply((reply) => replies.push(reply))
  await proc.start()
  await proc.deliver(envelope('explicit'))
  await until(() => fake.commands.some((c) => c.method === 'turn/start'))
  proc.acceptReply({ kind: 'text', chatId: 'replies', text: 'tool answer' })
  fake.complete('turn-1', 'completed', 'fallback should not post')
  await until(() => proc.pendingDeliverAtMs() === null)
  check(replies.length === 1 && replies[0].kind === 'text' && replies[0].text === 'tool answer', 'explicit reply once')
  await proc.deliver(envelope('fallback'))
  await until(() => fake.commands.filter((c) => c.method === 'turn/start').length === 2)
  fake.complete('turn-2', 'completed', 'final answer')
  await until(() => replies.length === 2)
  check(replies[1].kind === 'text' && replies[1].text === 'final answer' && replies[1].replyTo === 'fallback', 'final fallback once and threaded')
  await proc.deliver(envelope('failed'))
  await until(() => fake.commands.filter((c) => c.method === 'turn/start').length === 3)
  fake.complete('turn-3', 'failed', 'should not post')
  await until(() => proc.pendingDeliverAtMs() === null)
  check(replies.length === 2, 'failed turn has no success fallback')
  check(!proc.isAlive(), 'failed turn exits for pool recovery')
  fake.complete('turn-3', 'completed', 'late reply')
  check(replies.length === 2, 'late completion cannot post after exit')
  await proc.kill('shutdown')
  console.log('PASS AC-5 explicit reply, fallback, and failed turn')
}

async function testFailures(): Promise<void> {
  const missingKey = setup('missing-key', 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', { codex: { apiKeyEnv: 'MCD_TEST_ABSENT_API_KEY' } })
  delete process.env.MCD_TEST_ABSENT_API_KEY
  await missingKey.proc.start().then(() => { throw new Error('key unexpectedly accepted') }, (err) => check(String(err).includes('MCD_TEST_ABSENT_API_KEY'), 'missing key named safely'))

  const noCli = setup('missing-cli', 'ffffffff-ffff-4fff-ffff-ffffffffffff', {
    spawnFn: () => { throw new Error('raw secret secret-missing-cli') },
  })
  await noCli.proc.start().then(() => { throw new Error('CLI unexpectedly started') }, (err) => {
    check(String(err).includes('could not start'), 'missing CLI surfaced')
    check(!String(err).includes('secret-missing-cli'), 'spawn error redacted')
  })

  const asyncCli = setup('missing-cli-event', '99999999-9999-4999-8999-999999999999', {
    spawnFn: () => {
      const child = new FakeAppServer('99999999-9999-4999-8999-999999999999')
      child.stdin.removeAllListeners('data')
      queueMicrotask(() => child.emit('error', new Error('secret async CLI error')))
      return child as unknown as ChildProcess
    },
  })
  await asyncCli.proc.start().then(() => { throw new Error('CLI error unexpectedly accepted') }, (err) => {
    check(String(err).includes('could not start'), 'asynchronous missing CLI surfaced')
    check(!String(err).includes('secret async CLI error'), 'asynchronous spawn error redacted')
  })

  const invalid = setup('invalid-id', '11111111-1111-4111-8111-111111111111')
  writeFileSync(projectCodexThreadFile('invalid-id'), 'not-a-thread')
  await invalid.proc.start().then(() => { throw new Error('invalid ID accepted') }, (err) => check(String(err).includes('fresh thread'), 'invalid ID recovery'))
  check(readFileSync(projectCodexThreadFile('invalid-id'), 'utf8') === 'not-a-thread', 'invalid ID not overwritten')

  const mcp = setup('mcp-failure', '22222222-2222-4222-8222-222222222222')
  const logs: string[] = []
  const withLog = setup('mcp-failure-logged', '33333333-3333-4333-8333-333333333333', { log: (line) => logs.push(line) })
  await mcp.proc.start()
  await withLog.proc.start()
  withLog.fake.emitMessage({ method: 'mcpServer/startupStatus/updated', params: {
    threadId: withLog.fake.threadId, name: 'mcd', status: 'failed', error: 'secret-mcp-failure-logged', failureReason: null,
  } })
  check(!withLog.proc.isAlive() && logs.some((line) => line.includes('MCP connection failed')), 'MCP failure surfaced')
  check(!logs.join('').includes('secret-mcp-failure-logged'), 'MCP failure secret redacted')
  const cleanExit = setup('unexpected-exit', '44444444-4444-4444-8444-444444444444')
  let exitCode: number | null = null
  cleanExit.proc.onExit((info) => { exitCode = info.code })
  await cleanExit.proc.start()
  cleanExit.fake.emit('exit', 0, null)
  check(exitCode === 1, 'unexpected clean child exit reaches pool as crash')
  await mcp.proc.kill('shutdown')
  console.log('PASS AC-7 missing CLI/key, invalid thread, and MCP failure')
}

async function testGitCredential(): Promise<void> {
  process.env.MCD_TEST_CODEX_GIT_PAT = 'test-only-token'
  saveCredentials({ codexGit: { type: 'github-pat', envVar: 'MCD_TEST_CODEX_GIT_PAT' } })
  const { fake, proc } = setup('git-credential', '55555555-5555-4555-8555-555555555555', {
    gitCredential: 'codexGit',
  })
  await proc.start()
  const env = fake.options?.env as NodeJS.ProcessEnv
  const askpass = env.GIT_ASKPASS
  check(env.MCD_TEST_CODEX_GIT_PAT === 'test-only-token' && !!askpass && existsSync(askpass), 'git credential reaches Codex child')
  await proc.kill('shutdown')
  check(!existsSync(askpass!), 'git askpass helper cleaned up on exit')
  delete process.env.MCD_TEST_CODEX_GIT_PAT
  console.log('PASS Codex git credential passthrough and cleanup')
}

await testSetupAndIsolation()
await testQueueAndResume()
await testReplies()
await testFailures()
await testGitCredential()
