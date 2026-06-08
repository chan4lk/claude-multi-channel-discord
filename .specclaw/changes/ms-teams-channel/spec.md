# Spec: MS Teams Channel for MCD

## Functional Requirements

### FR1 — Teams Webhook Receiver
The server MUST expose a `/teams` HTTP route on the existing MasterMcpServer port that receives Bot Framework activity POSTs from MS Teams. The route MUST verify the JWT bearer token from Azure AD before processing any activity.

### FR2 — Message Routing
Inbound Teams message activities MUST be translated to `InboundEnvelope` and delivered to the `ProjectPool` for channels registered with `platform: 'teams'` in `channels.json`.

### FR3 — Outbound Reply
When Claude calls the `reply` MCP tool for a Teams channel, the bot MUST post the reply text back to the originating Teams conversation via the Bot Framework REST API (direct POST to `serviceUrl`). Text MUST be chunked at 4000 chars.

### FR4 — Linked Projects
A Teams channel and a Discord channel MAY both map to the same git repo (`git.remote`) in `channels.json` but MUST each have their own `chatId` key and isolated Claude session.

### FR5 — Platform Field
`channels.json` `ProjectSchema` MUST accept an optional `platform: 'discord' | 'teams'` field (default `'discord'`). Existing projects without the field behave as before.

### FR6 — HMAC / JWT Auth
The Teams webhook endpoint MUST validate the `Authorization: Bearer <token>` header using Azure AD OIDC public keys (fetched from `https://login.botframework.com/v1/.well-known/openidconfiguration`). Requests failing validation MUST return HTTP 401 and be silently dropped.

### FR7 — `.env` Keys
The server MUST load `TEAMS_APP_ID` and `TEAMS_APP_SECRET` from `~/.claude/channels/discord-multi/.env`. If either is missing when a Teams activity arrives, the server MUST log an error and return HTTP 500 without crashing.

### FR8 — `!project teams-setup` Wizard
The master-channel command `!project teams-setup` MUST print step-by-step instructions for creating an Azure Bot registration and configuring the webhook URL, then prompt the operator for App ID and secret, write them to `.env`, and confirm success.

### FR9 — `!project create --platform teams` Flag
The `create` verb MUST accept `--platform teams` and set `platform: 'teams'` on the new project entry. When `--platform teams` is set, `!project create` MUST NOT attempt to create a Discord channel.

### FR10 — Master Commands via Teams
The master channel `commandPrefix` check MUST work for Teams messages — a Teams channel may be designated as the master channel by setting `master.chatId` to a Teams conversation ID.

## Non-Functional Requirements

### NFR1 — No New npm Dependencies
Auth MUST use raw HTTPS (Node `https` module / `fetch`) + JWT parsing without adding a Bot Framework SDK package. JWT verification can use a minimal inline verifier or `jose` if already present; otherwise implement manually (RS256).

### NFR2 — Same Port
The `/teams` route MUST be added to the existing `MasterMcpServer` HTTP server — not a separate port or process.

### NFR3 — Backward Compatibility
All existing Discord projects MUST continue to work unchanged. The `platform` field defaults to `'discord'` and is optional in the schema.

### NFR4 — Typecheck Clean
`bun tsc --noEmit` MUST pass with zero errors after all changes.

### NFR5 — Existing Tests Pass
All existing tests (`master-commands.test.ts`, `project-pool.test.ts`, `master-mcp-server.test.ts`) MUST continue to pass.

## Acceptance Criteria

- AC1: A Teams message sent to a registered Teams channel triggers a Claude response posted back to that Teams conversation.
- AC2: A reply >4000 chars is split into multiple Teams messages, each posted sequentially.
- AC3: A message with an invalid or missing Bearer token returns HTTP 401; no activity is processed.
- AC4: Removing `TEAMS_APP_ID` from `.env` and sending a Teams activity logs an error and returns HTTP 500 without crashing the server.
- AC5: An existing Discord project sends and receives messages without any change in behavior after the Teams adapter is added.
- AC6: `!project create --platform teams #channel-id my-slug` registers a Teams project without attempting Discord channel creation.
- AC7: `!project teams-setup` in the master channel prints Azure setup instructions and, after operator input, writes `TEAMS_APP_ID` and `TEAMS_APP_SECRET` to `.env`.
- AC8: `bun tsc --noEmit` exits 0.
- AC9: All three existing test files pass.

## Edge Cases

- Teams `serviceUrl` varies per message; MUST be stored per-turn (from the activity), not globally.
- Teams retry delivery (duplicate activities): deduplicate on `activity.id` using the same msg-id dedup already in `ProjectPool`.
- Typing indicator activities (type `'typing'`) and other non-message activities MUST be ignored (return HTTP 200, no delivery).
- Teams conversation IDs contain `:` and `@` — `chatId` stored as-is; URL routing must handle encoded forms.
- If `master.chatId` is a Teams conversation ID, `handleTeamsInbound` must check the same master-command path as Discord.
