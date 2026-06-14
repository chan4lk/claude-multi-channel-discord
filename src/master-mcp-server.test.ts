/**
 * bun src/master-mcp-server.test.ts
 *
 * Lightweight checks: start/stop lifecycle, URL routing rejects malformed
 * paths. End-to-end MCP-client-against-this-server tests live separately
 * once a future phase adds an MCP test client harness.
 */
import type { OutboundReply } from './project-process.ts'
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

// After stop, urlFor should error out cleanly.
let urlAfterStopThrew = false
try {
  server.urlFor('111111111111111111')
} catch {
  urlAfterStopThrew = true
}
check('urlFor after stop throws', urlAfterStopThrew)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall checks passed')
