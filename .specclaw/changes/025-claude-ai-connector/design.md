# Design: claude.ai Connector Support for MCD MCP Server

**Change:** claude-ai-connector
**Created:** 2026-07-28

## Technical Approach

MCD's MCP server already speaks the exact protocol claude.ai custom connectors need (stateless Streamable HTTP, per-request `Server` + `Transport`). The blocker is auth lifecycle: per-chat tokens are minted in-memory at spawn (`chatTokens`, `src/master-mcp-server.ts:165`) and die with the process, and claude.ai connectors cannot send the custom `x-mcd-token` header anyway (OAuth or unauthenticated only).

Fix in three thin layers:

1. **Persistent external token (MCD code)** — optional `externalToken` on the project entry. `tokenSource()` replaces the boolean `tokenValid()`: check the in-memory boot token first, then the project's configured `externalToken`, returning `'local' | 'external' | null`. External source triggers two extra gates (master refusal, `disabled` refusal) and an audit log line.
2. **Operator flag (MCD code)** — `!project set <target> --external-token rotate|none`, following the `--hermes on --yes` / `--bot-peers none` precedents exactly.
3. **Auth bridge (Caddy config, docs only)** — claude.ai calls `https://mcd.<host>/<url-secret>/mcp/<chat_id>` as an unauthenticated connector. Caddy matches the secret prefix, strips it, injects `header_up x-mcd-token <externalToken>`, and proxies to `127.0.0.1:$MCD_MCP_PORT`. Two independent secrets (URL path claude.ai-side, header token MCD-side), rotatable independently.

No port work needed: `server.ts` already reads `MCD_MCP_PORT` into the `port` option; binding stays `127.0.0.1` (Caddy is same-host).

## Architecture

```
claude.ai routine (custom connector, unauthenticated URL)
        │  https://mcd.tecbizsolutions.com/<url-secret>/mcp/<chat_id>
        ▼
     Caddy  ── match secret prefix ── strip ── header_up x-mcd-token <tok>
        │  http://127.0.0.1:$MCD_MCP_PORT/mcp/<chat_id>
        ▼
 MasterMcpServer.route()
   ├─ tokenSource(chatId, header, config)
   │     'local'    → existing path, unchanged
   │     'external' → refuse if master chat ── refuse if project disabled ── log `external`
   │     null       → 401
   └─ buildServer(chatId) → tool dispatch (reply, fetch_messages, handoff, …)
```

Request-time config reread (`getConfig`, already injected) means token rotate/remove and disabled toggles apply without a restart — same live-reread pattern as `getMasterChatId` and handoff opt-ins.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | Add `externalToken: z.string().min(16).optional()` to `ProjectSchema` |
| `src/master-mcp-server.ts` | modify | `tokenValid()` → `tokenSource()` returning `'local' \| 'external' \| null`; external gates (master refusal, disabled refusal) + `external` audit log in `route()` |
| `src/master-commands.ts` | modify | `--external-token rotate\|none` flag on `set` (master refused, `rotate` requires `--yes`, one-time token reveal in reply); `show` marks `external-token: set` without value; help text |
| `src/master-mcp-server.test.ts` | modify | External-token acceptance/rejection, cross-chat isolation, disabled refusal, master refusal, local-token regression |
| `src/master-commands.test.ts` | modify | Flag parsing: rotate/none/--yes/master-target cases |
| `README.md` (or `ARCHITECTURE.md`) | modify | "claude.ai connector" section: `MCD_MCP_PORT`, Caddyfile snippet, connector registration steps, security model |

## Data Model Changes

`channels.json` project entry gains one optional field:

```jsonc
"projects": {
  "1502917980625829932": {
    "slug": "agent-nexus",
    "externalToken": "a3f9…64-hex-chars…"   // absent = no external access
  }
}
```

Persisted via existing atomic `saveConfig()`. Precedent for secrets in `channels.json`: per-project PR tokens (`--pr-token-github`). No new state files.

## API Changes

- MCP endpoint contract unchanged (same URL shape, same tools). Only the set of accepted credentials widens per-project.
- `!project set` grows `--external-token rotate|none`; `!project show` reports presence (never the value).
- GET remains 405 (allowed by MCP Streamable HTTP spec for stateless servers). If live claude.ai connector registration turns out to hard-require a GET/SSE stream, that is an explicitly deferred follow-up.

## Key Decisions

1. **Per-project token, not a central map** — colocates with the exposed thing; matches every per-project opt-in block (`hermes`, `botPeers`, `peers`, `collab`). (context.md: "Per-project opt-in reach grants … off by default, enabled per-project in `channels.json`, toggled via `!project set` flags; flags that grant reach require `--yes`.")
2. **Source discriminator, not boolean** — context.md: "Gate checks live in private `<feature>Access`/`<feature>Source` methods on `MasterMcpServer` returning a source discriminator or `null`." `tokenSource()` follows it; external-only gates hang off the discriminator.
3. **Master refusal enforced in `tokenSource()`, not only in the set flag** — defense in depth (context.md: "tool listing AND call handler check the same gate independently"). Hand-editing `externalToken` onto the master entry must still not grant external access.
4. **Caddy owns the claude.ai-facing auth** — no OAuth in MCD. Capability-URL + injected header is two lines of Caddyfile; OAuth/DCR would be a new subsystem for one consumer. YAGNI.
5. **Respect `disabled`** — the flag's contract is "drops all inbound"; an external caller replying into a disabled project's channel would violate it. Mirrors existing refusals (`ask_project` → `target project is disabled`, `src/master-mcp-server.ts:705,797`).
6. **Full project toolset for external callers in v1** — no per-tool scoping. The exposed chat is operator-chosen and non-master; scoping adds config surface with no current consumer needing it.
7. **Audit = log line, not master-channel notice** — a per-request Discord notice would spam (routines make many tool calls per run). The one-time reach grant already surfaces in master via the `set` command itself.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| First non-localhost exposure of an MCD endpoint | Default-off (no token → no access); server still binds 127.0.0.1 — only Caddy routes in; two independent secrets; TLS at Caddy; master structurally refused |
| Token leak via `channels.json` | Same posture as existing PR tokens; state dir is operator-owned; `show` never prints the value; `rotate` invalidates instantly (per-request config reread) |
| claude.ai connector registration fails on 405 GET | MCP spec permits 405 for stateless servers; verify live during build (AC11 manual step); GET/SSE support is a scoped follow-up if needed |
| Disabled-project bypass via external token | FR4 gate at route level, before tool dispatch; tested (AC5) |
| Local-token regression | `tokenSource()` checks boot token first; full existing test suite must stay green (AC1/NFR1) |

## Grounding sources

- `.specclaw/context.md` — "Per-project opt-in reach grants", "Gate checks live in private `<feature>Access`/`<feature>Source` methods … returning a source discriminator or `null`", "Defense in depth on MCP tools: tool listing AND call handler check the same gate independently", "High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json` (operator-owned config)" — externalToken is operator-owned config (not runtime state), so `channels.json` is the right home.
- `src/master-mcp-server.ts:159-165` — "The endpoint is localhost-only but any local process could otherwise POST /mcp/<chat_id> and reply as any channel" — existing threat model the external token must not weaken for local callers.
- `server.ts:1220` — `port: process.env.MCD_MCP_PORT ? parseInt(process.env.MCD_MCP_PORT, 10) : undefined` — fixed-port support already shipped; docs-only.
- `src/master-commands.ts:771-774` — `--hermes on` `--yes` refusal wording — template for the `--external-token rotate` refusal.
