import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { InboundEnvelope } from './project-process.ts'

// ---------------------------------------------------------------------------
// Stub global fetch before importing TeamsAdapter
// ---------------------------------------------------------------------------

let fetchStub: typeof globalThis.fetch = globalThis.fetch
globalThis.fetch = (url, init) => fetchStub(url, init)

const { TeamsAdapter } = await import('./teams-adapter.ts')

// ---------------------------------------------------------------------------
// TestableTeamsAdapter — bypasses JWT verification
// ---------------------------------------------------------------------------

class TestableTeamsAdapter extends TeamsAdapter {
  protected async verifyJwt(_token: string): Promise<boolean> {
    return true
  }

  setToken(token: string): void {
    this.tokenCache = { token, expiresAt: Date.now() + 3_600_000 }
  }
}

// ---------------------------------------------------------------------------
// Helpers — Node.js IncomingMessage + ServerResponse mocks
// ---------------------------------------------------------------------------

function makeIncomingMessage(body: object, extraHeaders: Record<string, string> = {}): IncomingMessage {
  const bodyStr = JSON.stringify(body)
  const emitter = new EventEmitter() as IncomingMessage
  ;(emitter as unknown as Record<string, unknown>).headers = {
    authorization: 'Bearer test-jwt-token',
    'content-type': 'application/json',
    ...extraHeaders,
  }
  // Emit body on next tick so handleRequest can attach listeners first
  setTimeout(() => {
    emitter.emit('data', Buffer.from(bodyStr))
    emitter.emit('end')
  }, 0)
  return emitter
}

class MockServerResponse extends EventEmitter {
  statusCode = 0
  body = ''
  headers: Record<string, string> = {}

  writeHead(status: number, hdrs?: Record<string, string | number>): void {
    this.statusCode = status
    if (hdrs) {
      for (const [k, v] of Object.entries(hdrs)) {
        this.headers[k.toLowerCase()] = String(v)
      }
    }
  }

  end(data?: string): void {
    this.body = data ?? ''
  }

  json(): unknown {
    return JSON.parse(this.body)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamsAdapter attachment handling', () => {
  let inboxDir: string
  let envelopes: InboundEnvelope[]
  let adapter: TestableTeamsAdapter

  beforeEach(() => {
    inboxDir = join(tmpdir(), `teams-test-${Math.random().toString(36).slice(2)}`)
    mkdirSync(inboxDir, { recursive: true })
    envelopes = []

    adapter = new TestableTeamsAdapter({
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      inboxDir,
      maxAttachmentBytes: 25 * 1024 * 1024,
      onInbound: (_chatId, env) => { envelopes.push(env) },
    })
    adapter.setToken('test-bearer-token')
  })

  afterEach(() => {
    rmSync(inboxDir, { recursive: true, force: true })
    fetchStub = globalThis.fetch
  })

  // -------------------------------------------------------------------------
  // Test 1: text + attachment → file downloaded, summary in envelope
  // -------------------------------------------------------------------------
  test('text + attachment: downloads file, populates envelope.attachments', async () => {
    const fileContent = Buffer.from('hello pdf')

    fetchStub = async (url) => {
      const u = typeof url === 'string' ? url : (url instanceof URL ? url.href : (url as Request).url)
      if (u.includes('cdn.teams.microsoft.com')) {
        return new Response(fileContent, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      }
      throw new Error(`unexpected fetch: ${u}`)
    }

    const activity = {
      type: 'message',
      id: 'msg1',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'Here is the file',
      attachments: [
        { contentUrl: 'https://cdn.teams.microsoft.com/file.pdf', contentType: 'application/pdf', name: 'report.pdf' },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect((res as unknown as MockServerResponse).statusCode).toBe(200)
    expect(envelopes).toHaveLength(1)
    const env = envelopes[0]!
    expect(env.content).toBe('Here is the file')
    expect(env.attachments).toHaveLength(1)
    expect(env.attachments![0]).toMatch(/^report\.pdf \(application\/pdf, \d+KB\)$/)

    const files = readdirSync(inboxDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/report\.pdf$/)
  })

  // -------------------------------------------------------------------------
  // Test 2: attachment-only message → placeholder content, delivered
  // -------------------------------------------------------------------------
  test('attachment-only message: content becomes "(attachment)"', async () => {
    const fileContent = Buffer.from('image data')

    fetchStub = async () => new Response(fileContent, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })

    const activity = {
      type: 'message',
      id: 'msg2',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      // no text
      attachments: [
        { contentUrl: 'https://cdn.teams.microsoft.com/photo.png', contentType: 'image/png', name: 'photo.png' },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.content).toBe('(attachment)')
    expect(envelopes[0]!.attachments).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Test 3: oversized attachment → not downloaded, summary shows size
  // -------------------------------------------------------------------------
  test('oversized attachment: skipped, summary shows size', async () => {
    let fetchCalled = false
    fetchStub = async () => { fetchCalled = true; return new Response('', { status: 200 }) }

    const activity = {
      type: 'message',
      id: 'msg3',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'big file',
      attachments: [
        {
          contentUrl: 'https://cdn.teams.microsoft.com/huge.zip',
          contentType: 'application/zip',
          name: 'huge.zip',
          contentLength: 30 * 1024 * 1024, // 30MB > 25MB limit
        },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.attachments![0]).toMatch(/too large/)
    expect(fetchCalled).toBe(false)
    expect(readdirSync(inboxDir)).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // Test 4: download failure → degraded summary, envelope still delivered
  // -------------------------------------------------------------------------
  test('download failure: envelope delivered with "(download failed)" summary', async () => {
    fetchStub = async () => new Response('forbidden', { status: 403 })

    const activity = {
      type: 'message',
      id: 'msg4',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'attached doc',
      attachments: [
        { contentUrl: 'https://cdn.teams.microsoft.com/secret.pdf', contentType: 'application/pdf', name: 'secret.pdf' },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.content).toBe('attached doc')
    expect(envelopes[0]!.attachments![0]).toBe('secret.pdf (download failed)')
  })

  // -------------------------------------------------------------------------
  // Test 5: text-only message → unchanged behavior, no attachments field
  // -------------------------------------------------------------------------
  test('text-only message: unchanged behavior, no attachments field', async () => {
    let fetchCalled = false
    fetchStub = async () => { fetchCalled = true; return new Response('', { status: 200 }) }

    const activity = {
      type: 'message',
      id: 'msg5',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'Hello world',
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    expect(envelopes[0]!.content).toBe('Hello world')
    expect(envelopes[0]!.attachments).toBeUndefined()
    expect(fetchCalled).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Test 6: filename sanitization — \r \n ; stripped from summary strings
  // -------------------------------------------------------------------------
  test('filename sanitization: strips \\r, \\n, ; from attachment name in summary', async () => {
    const fileContent = Buffer.from('data')
    fetchStub = async () => new Response(fileContent, { status: 200 })

    const activity = {
      type: 'message',
      id: 'msg6',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'file with bad name',
      attachments: [
        { contentUrl: 'https://cdn.teams.microsoft.com/f.pdf', contentType: 'application/pdf', name: 'evil\r\n;name.pdf' },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    const summary = envelopes[0]!.attachments![0]!
    expect(summary).not.toContain('\r')
    expect(summary).not.toContain('\n')
    expect(summary).not.toContain(';')
    expect(summary).toMatch(/^evil___name\.pdf \(application\/pdf, \d+KB\)$/)
  })

  // -------------------------------------------------------------------------
  // Test 7: Teams file attachment (vnd.microsoft.teams.file.download.info)
  //         uses content.downloadUrl (pre-signed) — no auth header sent
  // -------------------------------------------------------------------------
  test('Teams file attachment: downloads via content.downloadUrl without auth header', async () => {
    const fileContent = Buffer.from('prd content')
    let capturedHeaders: Record<string, string> = {}

    fetchStub = async (url, init) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      )
      const u = typeof url === 'string' ? url : (url instanceof URL ? url.href : (url as Request).url)
      if (u.includes('sharepoint.com')) {
        return new Response(fileContent, {
          status: 200,
          headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        })
      }
      throw new Error(`unexpected fetch: ${u}`)
    }

    const activity = {
      type: 'message',
      id: 'msg7',
      serviceUrl: 'https://smba.trafficmanager.net/apis',
      conversation: { id: 'conv1' },
      from: { id: 'user1', name: 'Alice' },
      text: 'Here is the PRD',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.teams.file.download.info',
          name: 'PRD.docx',
          content: {
            downloadUrl: 'https://tenant.sharepoint.com/sites/x/_layouts/15/download.aspx?SAS=abc123',
            uniqueId: 'file-uuid',
            fileType: 'docx',
          },
        },
      ],
    }

    const req = makeIncomingMessage(activity)
    const res = new MockServerResponse() as unknown as ServerResponse
    await adapter.handleRequest(req, res)

    expect(envelopes).toHaveLength(1)
    const env = envelopes[0]!
    expect(env.content).toBe('Here is the PRD')
    expect(env.attachments).toHaveLength(1)
    expect(env.attachments![0]).toMatch(/^PRD\.docx \(application\/vnd\.microsoft\.teams\.file\.download\.info, \d+KB\)$/)

    // Pre-signed URL — must NOT send Authorization header
    expect(capturedHeaders['Authorization']).toBeUndefined()
    expect(capturedHeaders['authorization']).toBeUndefined()

    const files = readdirSync(inboxDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/PRD\.docx$/)
  })
})
