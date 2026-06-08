# Tasks: MS Teams Channel for MCD

## Wave 1 — Schema & Config (no behavior change)

- [x] `T1` — Add `platform` field to `ProjectSchema` in `src/channels-config.ts`
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Notes: `z.enum(['discord','teams']).default('discord')`. Run `bun tsc --noEmit` to confirm no breakage.

## Wave 2 — Teams Adapter Core

- [ ] `T2` — Create `src/teams-adapter.ts` with JWT verifier and activity parser
  - Files: `src/teams-adapter.ts` (new)
  - Estimate: large
  - Depends: T1
  - Notes: Inline RS256 verifier using Node `crypto`. Cache JWKS 24h, re-fetch on 401. Only process `activity.type === 'message'` with non-empty text. Store `serviceUrl` in `Map<chatId, string>`.

- [ ] `T3` — Add outbound `postReply` to `TeamsAdapter` (client-credentials token + chunked POST)
  - Files: `src/teams-adapter.ts`
  - Estimate: medium
  - Depends: T2
  - Notes: Token endpoint `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`. Cache token until expiry - 60s. Chunk at 4000 chars inline. POST to `{serviceUrl}/v3/conversations/{conversationId}/activities`.

## Wave 3 — Server Wiring

- [ ] `T4` — Add `/teams` route to `MasterMcpServer`
  - Files: `src/master-mcp-server.ts`
  - Estimate: small
  - Depends: T2
  - Notes: Add `teamsAdapter?: TeamsAdapter` to constructor opts. In `handleRequest`, if `url.pathname === '/teams' && method === 'POST'`, delegate to `teamsAdapter.handleRequest`. Return 503 if adapter is null.

- [ ] `T5` — Instantiate `TeamsAdapter` in `server.ts` and wire platform dispatch
  - Files: `server.ts`
  - Estimate: medium
  - Depends: T3, T4
  - Notes: Read `TEAMS_APP_ID` + `TEAMS_APP_SECRET` from `process.env` after `.env` load. If present, create `TeamsAdapter` and pass to `MasterMcpServer`. Add `dispatchTeamsReply(reply)` function. Update `onReply` callback to check `cfg.projects[reply.chatId]?.platform` and route accordingly.

## Wave 4 — Master Commands

- [ ] `T6` — Add `--platform teams` flag to `!project create` in `src/master-commands.ts`
  - Files: `src/master-commands.ts`
  - Estimate: small
  - Depends: T1
  - Notes: When `--platform teams` is set, skip `mutator.createDiscordChannel`; use the positional chat ID arg directly as the Teams conversation ID. Write `platform: 'teams'` to the new project entry.

- [ ] `T7` — Add `!project teams-setup` wizard verb
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Depends: T1
  - Notes: Print Azure App Registration instructions + webhook URL (`https://<host>/teams`). Multi-step: install a one-shot handler on master channel for App ID, then App Secret. Append/overwrite `TEAMS_APP_ID` and `TEAMS_APP_SECRET` in `.env`. Reply confirmation. Do NOT restart server — tell operator to restart manually.

## Wave 5 — Verification

- [ ] `T8` — Typecheck and test suite
  - Files: none (verification only)
  - Estimate: small
  - Depends: T5, T6, T7
  - Notes: `bun tsc --noEmit` must exit 0. `bun src/master-commands.test.ts && bun src/project-pool.test.ts && bun src/master-mcp-server.test.ts` must all pass.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
