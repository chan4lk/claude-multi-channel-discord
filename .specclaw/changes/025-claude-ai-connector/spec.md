# Spec: claude.ai Connector Support for MCD MCP Server

**Change:** claude-ai-connector
**Created:** 2026-07-28
**Status:** 🟡 Draft

## Overview

Let a claude.ai custom connector (e.g. the agent-nexus daily tech-radar routine) call into one MCD project chat's MCP endpoint. The transport is already compatible (stateless Streamable HTTP); the work is a persistent per-project external token that survives restarts, an operator flag to manage it, guardrails (master refused, disabled projects refused, audit log), and documentation for the Caddy capability-URL route that bridges claude.ai's no-custom-headers limitation to MCD's `x-mcd-token` auth.

Port exposure needs no code: `MCD_MCP_PORT` is already wired (`server.ts` reads it into `MasterMcpServer`'s `port` option); the server correctly stays bound to `127.0.0.1` with Caddy terminating TLS on the same host.

## Requirements

### Functional Requirements

- **FR1** — New optional `externalToken` string field on project entries in `channels.json` (`ProjectSchema` in `src/channels-config.ts`). Absent = feature off for that project.
- **FR2** — `MasterMcpServer` token validation accepts, for a given chat_id, **either** the in-memory per-boot token (existing behavior, used by local claude subprocesses) **or** that project's configured `externalToken` (reread from config per request via the injected `getConfig`). Both comparisons use `timingSafeEqual`.
- **FR3** — Token validation returns a source discriminator (`'local' | 'external' | null`) following the existing `<feature>Access`/`<feature>Source` pattern, so downstream guardrails can distinguish external callers.
- **FR4** — Requests authenticated via `externalToken` against a project with `disabled: true` are refused with a JSON-RPC error before any tool executes. Local-token requests are unaffected (existing behavior preserved).
- **FR5** — Every externally-authenticated request is logged with an `external` marker (chat_id + request received), so connector traffic is auditable in server logs.
- **FR6** — `!project set <target> --external-token rotate --yes` mints a fresh 32-byte hex token, persists it to the project entry, and replies with the token and the connector path (`/mcp/<chat_id>`) exactly once. Requires `--yes` (grants external reach — matches the `--hermes on`/`--bot-peers` precedent).
- **FR7** — `!project set <target> --external-token none` removes the field (no `--yes`, matches `--bot-peers none` precedent).
- **FR8** — `--external-token` targeting the master project is refused (`run_master_command` must never be externally reachable).
- **FR9** — `!project show <target>` (or `set` confirmation output) indicates whether an external token is configured, without printing the token value.
- **FR10** — Documentation (README or ARCHITECTURE): Caddyfile snippet for the capability-URL route (secret path prefix → strip → `reverse_proxy 127.0.0.1:$MCD_MCP_PORT` with `header_up x-mcd-token <token>`), `MCD_MCP_PORT` usage, claude.ai custom-connector registration steps, and the security model (two independent secrets, master never exposed).

### Non-Functional Requirements

- **NFR1** — Zero behavior change when no project has `externalToken`: all existing tests pass unmodified; requests without a valid token still get 401.
- **NFR2** — No new dependencies; no OAuth implementation in MCD (the Caddy capability-URL is the v1 auth bridge).
- **NFR3** — Token comparison remains timing-safe for both token sources.
- **NFR4** — `externalToken` lives in `channels.json` alongside existing secrets (PR tokens precedent); saved via the existing atomic `saveConfig`.

## Acceptance Criteria

- **AC1** — Config with no `externalToken` anywhere: local per-boot token accepted, any other token 401. (Existing tests green.)
- **AC2** — Config with `externalToken: "T"` on chat X: request to `/mcp/X` with `x-mcd-token: T` reaches tool dispatch; request with `x-mcd-token: T` to a *different* chat Y is 401 (tokens are per-project, no cross-chat reuse).
- **AC3** — Local per-boot token continues to work on a project that also has an `externalToken`.
- **AC4** — Wrong/stale external token → 401 with `rejected` log line.
- **AC5** — External-token request to a project with `disabled: true` → JSON-RPC error refusing the request; same request with the local token behaves as before.
- **AC6** — External-token request emits a log line containing `external` and the chat_id.
- **AC7** — `set <slug> --external-token rotate --yes` persists a 64-char hex token to `channels.json` and the reply contains the token; running it again replaces the old token (old one then 401s).
- **AC8** — `set <slug> --external-token rotate` without `--yes` is refused with an explanatory message.
- **AC9** — `set <slug> --external-token none` removes the field; the removed token 401s afterward.
- **AC10** — `set master --external-token rotate --yes` (or master chat_id) is refused.
- **AC11** — Docs contain a complete Caddyfile snippet + claude.ai connector registration steps (manual verification).

## Edge Cases

- **Server restart:** in-memory tokens rotate, `externalToken` persists — the claude.ai connector keeps working across restarts (the whole point).
- **Config edit race:** `getConfig` rereads `channels.json` per request, so `rotate`/`none` take effect on the next request without a server restart.
- **`externalToken` set to empty string:** schema forbids (min length); validation treats absent/empty as no external token — never accept an empty presented token.
- **GET/SSE from claude.ai:** stateless transport returns 405 for GET — permitted by the MCP Streamable HTTP spec (clients must tolerate it). Verify during live connector registration; if claude.ai hard-requires a GET stream, that's a follow-up change, not v1.
- **Master chat:** even if an operator hand-edits `externalToken` onto the master entry in `channels.json`, token validation must refuse external-source auth for the master chat (defense in depth — same both-sides gating as tool listing/execution elsewhere).

## Dependencies

- `MCD_MCP_PORT` env var set on the production server (operator action, no code).
- Caddy on the host with an available hostname (e.g. `mcd.tecbizsolutions.com`) — operator applies the documented snippet.
- claude.ai custom connector registration (operator action in claude.ai UI).

## Notes

- Open question from proposal resolved: per-project `externalToken` (not a central map) — colocates with the thing being exposed, matches every other per-project opt-in block.
- Open question resolved: external calls **respect** `disabled` (FR4).
- Rate limiting: out of scope v1 (single trusted routine).
