# Design: MS Teams Channel for MCD

## Architecture Overview

The Teams adapter slots in as a peer to the Discord gateway. Both gateways funnel into the same `ProjectPool` and `MasterMcpServer` — the core is unchanged.

```
MS Teams (Bot Framework)
       │  POST /teams  (HTTP, same port as MCP)
       ▼
 MasterMcpServer  ──── /teams route (new) ──── TeamsAdapter
       │                                              │
       │  (existing /mcp/<chat_id> route)             │  translate Activity → InboundEnvelope
       ▼                                              ▼
 ProjectPool ◄────────────────────────── deliver(chatId, envelope)
       │
       └─ ClaudeProjectProcess (per channel, platform-agnostic)
              └─ mcp__mcd__reply → onReply → dispatchTeamsReply / dispatchProjectReply
```

## File Changes Map

| File | Change |
|------|--------|
| `src/teams-adapter.ts` | **NEW** — JWT verifier, activity parser, `dispatchTeamsReply` |
| `src/channels-config.ts` | Add `platform: z.enum(['discord','teams']).default('discord')` to `ProjectSchema` |
| `src/master-mcp-server.ts` | Add `/teams` route handler; call `teamsAdapter.handleRequest(req, res)` |
| `src/master-commands.ts` | Add `teams-setup` verb; add `--platform teams` to `create` verb |
| `server.ts` | Instantiate `TeamsAdapter`; wire `onReply` to dispatch by platform; pass adapter to MasterMcpServer |

## `src/teams-adapter.ts` — Key Contracts

```typescript
export interface TeamsAdapterOpts {
  appId: string            // TEAMS_APP_ID from env
  appSecret: string        // TEAMS_APP_SECRET from env
  onInbound: (chatId: string, env: InboundEnvelope, serviceUrl: string) => void
}

export class TeamsAdapter {
  constructor(opts: TeamsAdapterOpts)

  // Called by MasterMcpServer for POST /teams
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>

  // Called by dispatchReply when platform === 'teams'
  async postReply(chatId: string, text: string, replyTo?: string): Promise<void>
}
```

**JWT Verification (FR6 / NFR1):**
1. Fetch OpenID config from `https://login.botframework.com/v1/.well-known/openidconfiguration` (cached 24h, re-fetched on 401).
2. Fetch JWKS from the `jwks_uri` in the config.
3. Verify `Authorization: Bearer <token>` — RS256, audience = `TEAMS_APP_ID`, issuer = `https://api.botframework.com`.
4. Minimal inline implementation using Node's `crypto.createVerify` — no external JWT library needed.

**Activity parsing:**
- Only process `activity.type === 'message'` with non-empty `activity.text`.
- Map to `InboundEnvelope`: `messageId = activity.id`, `userId = activity.from.id`, `username = activity.from.name`, `content = activity.text`, `ts = activity.timestamp`.
- Store `serviceUrl` in a `Map<chatId, string>` keyed on `chatId` for use in `postReply`.

**Outbound (`postReply`):**
- POST to `{serviceUrl}/v3/conversations/{conversationId}/activities` with Bearer token obtained via client-credentials flow (`TEAMS_APP_ID` + `TEAMS_APP_SECRET` → `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`).
- Cache access token until 60s before expiry.
- Chunk at 4000 chars (new `src/teams-chunk.ts` or inline in adapter).

## `/teams` Route in MasterMcpServer

MasterMcpServer already owns the HTTP server. Adding a route is straightforward:

```typescript
// In MasterMcpServer.handleRequest (src/master-mcp-server.ts):
if (url.pathname === '/teams' && req.method === 'POST') {
  await this.teamsAdapter?.handleRequest(req, res)
  return
}
```

`teamsAdapter` is optional — if `TEAMS_APP_ID` is absent the adapter is `null` and the route returns 503.

## `!project create --platform teams` (src/master-commands.ts)

`handleCreate` currently always calls `mutator.createDiscordChannel(name)`. Add:

```typescript
const platform = flags['platform'] ?? 'discord'
const chatId = platform === 'teams'
  ? parsedChatId  // operator passes the Teams conv ID directly
  : await mutator.createDiscordChannel(name, { parent: flags['parent'] })
```

Teams conversation IDs must be passed explicitly (`!project create --platform teams <conv-id> <slug>`).

## `!project teams-setup` (src/master-commands.ts)

New verb. Multi-step interactive wizard:

1. Print Azure portal link + step-by-step registration instructions.
2. Prompt: "Paste your App ID:". Read next inbound message from same user as the value.
3. Prompt: "Paste your App Secret:". Read next inbound.
4. Append `TEAMS_APP_ID=<id>` and `TEAMS_APP_SECRET=<secret>` to `.env` (or overwrite existing lines).
5. Reply: "Teams credentials saved. Restart MCD to activate."

**Implementation note:** Multi-step input requires the wizard to temporarily install a one-shot message handler on the master channel. Use the same pattern as any future interactive command.

## Platform Dispatch in `server.ts`

```typescript
function dispatchReply(reply: OutboundReply): Promise<void> {
  const cfg = loadChannelsConfig()
  const platform = cfg.projects[reply.chatId]?.platform ?? 'discord'
  if (platform === 'teams') return dispatchTeamsReply(reply)
  return dispatchProjectReply(reply)  // existing Discord path
}
```

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| SDK vs raw REST | Raw REST + inline JWT | No new deps (NFR1); Bot Framework SDK is 50MB+ |
| Webhook port | Same port as MCP (NFR2) | Simpler ops; no extra firewall rule |
| `serviceUrl` storage | In-memory Map per adapter instance | Teams requires replying to the URL from the activity, not a fixed URL |
| Token cache | In-memory, TTL = expiry - 60s | Avoid token fetch per message; simple |
| JWKS cache | In-memory, 24h TTL | Public keys rotate rarely; re-fetch on 401 |
| Multi-step wizard | Temporary one-shot handler | Cleanest UX; no persistent state needed |

## Risks

- **Teams JWT format changes:** Azure can update OIDC metadata. Mitigated by re-fetching on 401.
- **`serviceUrl` staleness:** If bot is offline and Teams retries with a different `serviceUrl`, the cached URL for outbound may differ. Mitigated by always updating the Map on each inbound activity.
- **HMAC vs JWT:** Teams actually uses JWT (RS256), not HMAC. The proposal said "HMAC" but the correct term for Bot Framework auth is JWT/Bearer. Implementation uses JWT per the spec.
