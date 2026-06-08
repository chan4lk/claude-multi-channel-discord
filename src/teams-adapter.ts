/**
 * TeamsAdapter — JWT verifier (RS256, inline, no external JWT library)
 * and Microsoft Teams activity parser.
 *
 * Implements the inbound side of the Teams Bot Framework integration.
 * postReply() is stubbed here and will be implemented in T3.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createVerify, createPublicKey, type JsonWebKeyInput } from 'node:crypto'
import type { InboundEnvelope } from './project-process.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JwkKey {
  kty: string
  kid: string
  n: string
  e: string
  use?: string
  alg?: string
  [key: string]: unknown
}

interface JwksResponse {
  keys: JwkKey[]
}

interface OpenIdConfig {
  jwks_uri: string
  [key: string]: unknown
}

interface TeamsActivity {
  type: string
  id: string
  timestamp?: string
  serviceUrl: string
  channelId?: string
  text?: string
  conversation?: {
    id: string
    [key: string]: unknown
  }
  from?: {
    id: string
    name?: string
    [key: string]: unknown
  }
  channelData?: {
    teamsChannelId?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface TeamsAdapterOpts {
  appId: string
  appSecret: string
  onInbound: (chatId: string, env: InboundEnvelope, serviceUrl: string) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENID_CONFIG_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration'
const EXPECTED_ISSUER = 'https://api.botframework.com'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ---------------------------------------------------------------------------
// TeamsAdapter
// ---------------------------------------------------------------------------

export class TeamsAdapter {
  private jwksCache: { keys: JwkKey[]; fetchedAt: number } | null = null
  private openIdCache: { jwksUri: string; fetchedAt: number } | null = null
  private serviceUrlMap = new Map<string, string>() // chatId → serviceUrl

  constructor(private opts: TeamsAdapterOpts) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Validate credentials are present
      if (!this.opts.appId || !this.opts.appSecret) {
        console.error('[TeamsAdapter] TEAMS_APP_ID or TEAMS_APP_SECRET missing')
        sendJson(res, 500, { error: 'server misconfiguration' })
        return
      }

      // Verify JWT
      const authHeader = req.headers['authorization']
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error('[TeamsAdapter] Missing or malformed Authorization header')
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }

      const token = authHeader.slice('Bearer '.length).trim()
      const verified = await this.verifyJwt(token)
      if (!verified) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }

      // Read and parse body
      let body: string
      try {
        body = await readBody(req)
      } catch (err) {
        console.error('[TeamsAdapter] Failed to read request body:', err)
        sendJson(res, 400, { error: 'bad request' })
        return
      }

      let activity: TeamsActivity
      try {
        activity = JSON.parse(body) as TeamsActivity
      } catch (err) {
        console.error('[TeamsAdapter] Failed to parse activity JSON:', err)
        sendJson(res, 400, { error: 'bad request' })
        return
      }

      // Only process message activities with non-empty text
      if (activity.type !== 'message' || !activity.text?.trim()) {
        sendJson(res, 200, {})
        return
      }

      // Resolve chatId
      const chatId =
        activity.channelData?.teamsChannelId ?? activity.conversation?.id
      if (!chatId) {
        console.error('[TeamsAdapter] Cannot determine chatId from activity')
        sendJson(res, 200, {})
        return
      }

      // Store serviceUrl for outbound replies (T3)
      this.serviceUrlMap.set(chatId, activity.serviceUrl)

      // Build InboundEnvelope
      const envelope: InboundEnvelope = {
        messageId: activity.id,
        userId: activity.from?.id ?? 'unknown',
        username: activity.from?.name ?? 'unknown',
        content: activity.text.trim(),
        ts: activity.timestamp ?? new Date().toISOString(),
      }

      // Deliver to project pool
      this.opts.onInbound(chatId, envelope, activity.serviceUrl)

      sendJson(res, 200, { id: activity.id })
    } catch (err) {
      console.error('[TeamsAdapter] Unexpected error in handleRequest:', err)
      sendJson(res, 500, { error: 'internal server error' })
    }
  }

  /**
   * Stub — postReply will be implemented in T3.
   */
  async postReply(chatId: string, text: string, replyTo?: string): Promise<void> {
    throw new Error('not implemented')
  }

  // -------------------------------------------------------------------------
  // JWT verification (RS256, inline, no external library)
  // -------------------------------------------------------------------------

  private async verifyJwt(token: string): Promise<boolean> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('[TeamsAdapter] JWT does not have 3 parts')
      return false
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Parse header
    let header: { alg?: string; kid?: string }
    try {
      header = JSON.parse(base64urlDecode(headerB64)) as { alg?: string; kid?: string }
    } catch (err) {
      console.error('[TeamsAdapter] Failed to parse JWT header:', err)
      return false
    }

    if (header.alg !== 'RS256') {
      console.error('[TeamsAdapter] Unexpected JWT algorithm:', header.alg)
      return false
    }

    if (!header.kid) {
      console.error('[TeamsAdapter] JWT header missing kid')
      return false
    }

    // Parse payload
    let payload: { aud?: string; iss?: string; exp?: number }
    try {
      payload = JSON.parse(base64urlDecode(payloadB64)) as {
        aud?: string
        iss?: string
        exp?: number
      }
    } catch (err) {
      console.error('[TeamsAdapter] Failed to parse JWT payload:', err)
      return false
    }

    // Validate claims
    if (payload.aud !== this.opts.appId) {
      console.error('[TeamsAdapter] JWT aud mismatch. Got:', payload.aud)
      return false
    }
    if (payload.iss !== EXPECTED_ISSUER) {
      console.error('[TeamsAdapter] JWT iss mismatch. Got:', payload.iss)
      return false
    }
    if (!payload.exp || payload.exp < Date.now() / 1000) {
      console.error('[TeamsAdapter] JWT expired or missing exp')
      return false
    }

    // Find matching JWK
    const jwk = await this.findJwk(header.kid)
    if (!jwk) {
      console.error('[TeamsAdapter] No JWK found for kid:', header.kid)
      return false
    }

    // Verify signature
    try {
      const jwkInput: JsonWebKeyInput = {
        key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
        format: 'jwk',
      }
      const publicKey = createPublicKey(jwkInput)

      const verifier = createVerify('RSA-SHA256')
      // Input is the raw `header.payload` bytes before the last `.`
      verifier.update(`${headerB64}.${payloadB64}`)
      const signatureBytes = Buffer.from(signatureB64, 'base64url')
      const valid = verifier.verify(publicKey, signatureBytes)
      if (!valid) {
        console.error('[TeamsAdapter] JWT signature verification failed')
        return false
      }
      return true
    } catch (err) {
      console.error('[TeamsAdapter] Error verifying JWT signature:', err)
      return false
    }
  }

  private async findJwk(kid: string): Promise<JwkKey | null> {
    // Try cached JWKS first
    let keys = await this.getJwks()
    let key = keys.find(k => k.kid === kid) ?? null
    if (key) return key

    // Cache miss for kid — force refresh once
    this.jwksCache = null
    keys = await this.getJwks()
    key = keys.find(k => k.kid === kid) ?? null
    return key
  }

  private async getJwks(): Promise<JwkKey[]> {
    const now = Date.now()
    if (this.jwksCache && now - this.jwksCache.fetchedAt < CACHE_TTL_MS) {
      return this.jwksCache.keys
    }

    const jwksUri = await this.getJwksUri()
    const resp = await fetch(jwksUri)
    if (!resp.ok) {
      throw new Error(`Failed to fetch JWKS from ${jwksUri}: ${resp.status}`)
    }
    const data = (await resp.json()) as JwksResponse
    this.jwksCache = { keys: data.keys, fetchedAt: now }
    return data.keys
  }

  private async getJwksUri(): Promise<string> {
    const now = Date.now()
    if (this.openIdCache && now - this.openIdCache.fetchedAt < CACHE_TTL_MS) {
      return this.openIdCache.jwksUri
    }

    const resp = await fetch(OPENID_CONFIG_URL)
    if (!resp.ok) {
      throw new Error(
        `Failed to fetch OpenID config from ${OPENID_CONFIG_URL}: ${resp.status}`
      )
    }
    const config = (await resp.json()) as OpenIdConfig
    this.openIdCache = { jwksUri: config.jwks_uri, fetchedAt: now }
    return config.jwks_uri
  }

  // -------------------------------------------------------------------------
  // Internal accessor for tests / T3
  // -------------------------------------------------------------------------

  getServiceUrl(chatId: string): string | undefined {
    return this.serviceUrlMap.get(chatId)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64urlDecode(input: string): string {
  // Convert base64url to base64 and decode to UTF-8 string
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
