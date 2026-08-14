# Tasks: claude.ai Connector Support for MCD MCP Server

**Change:** claude-ai-connector
**Created:** 2026-07-28
**Total Tasks:** 4

## Summary

Two implementation tasks (schema + token source in the MCP server, then the operator flag), one test task covering both, one docs task, one live-verification task. Port exposure is docs-only (`MCD_MCP_PORT` already wired at `server.ts:1220`).

## Tasks

### Wave 1 — Core token path

- [x] `T1` — `externalToken` schema + `tokenSource()` in MCP server
  - Files: `src/channels-config.ts`, `src/master-mcp-server.ts`
  - Estimate: medium
  - Kind: impl
  - Notes: Add `externalToken: z.string().min(16).optional()` to `ProjectSchema`. Replace `tokenValid()` with `tokenSource(chatId, presented): 'local' | 'external' | null` — boot token first, then `getConfig()?.projects[chatId]?.externalToken`, both via `timingSafeEqual`; never accept empty/absent presented token. In `route()`: `null` → 401 (unchanged); `'external'` → refuse master chat (compare against `getMasterChatId()`), refuse `disabled: true` project (JSON-RPC error, mirror the `target project is disabled` wording), log `external request /mcp/<chatId>` on acceptance. `'local'` path byte-for-byte unchanged.

### Wave 2 — Operator flag

- [x] `T2` — `!project set --external-token rotate|none`
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: Follow the `--hermes` handler pattern (`src/master-commands.ts:760`). `rotate` requires `--yes` (reach grant), mints `randomBytes(32).toString('hex')`, persists via mutator/saveConfig, reply reveals token once + connector path `/mcp/<chat_id>` + pointer to the Caddy docs. `none` removes the field, no `--yes` (matches `--bot-peers none`). Master target refused. Update the `set` usage string and help text; `show` output gains `external-token: set|—` (never the value).

### Wave 3 — Tests

- [x] `T3` — Test coverage for token source + flag
  - Files: `src/master-mcp-server.test.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T1, T2
  - Notes: Server tests: external token accepted (AC2), cross-chat token 401 (AC2), local token still works alongside external (AC3), wrong token 401 (AC4), disabled project refused for external but not local (AC5), master chat external refusal even with hand-edited token (AC10 defense-in-depth), `external` log marker (AC6). Command tests: rotate persists 64-hex token (AC7), rotate without `--yes` refused (AC8), `none` removes (AC9), master target refused (AC10). All existing checks stay green (AC1).

### Wave 4 — Docs + live verify

- [x] `T4` — Connector documentation
  - Files: `README.md`, `CLAUDE.md` (brief section pointer)
  - Estimate: small
  - Kind: docs
  - Depends: T2
  - Notes: New "claude.ai connector" section: `MCD_MCP_PORT` env, full Caddyfile snippet (secret path prefix match → `uri strip_prefix` → `reverse_proxy 127.0.0.1:{$MCD_MCP_PORT}` with `header_up x-mcd-token <token>`), claude.ai custom-connector registration steps, security model (two secrets, master never exposed, disabled respected), rotation procedure.

## Post-deploy verification (not a build task)

Live connector registration check (AC11) — requires merged + deployed code, an applied Caddy route, and claude.ai UI access, so it cannot run inside the build: register the connector in claude.ai against the agent-nexus chat endpoint and run one `fetch_messages`/`reply` round-trip. Specifically watch whether claude.ai tolerates 405 on GET (stateless transport). If registration hard-fails on GET, file a follow-up change — do not scope-creep into this one. Until performed, AC11 is unverified.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
