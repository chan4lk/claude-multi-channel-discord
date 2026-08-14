# Proposal: claude.ai Connector Support for MCD MCP Server

**Created:** 2026-07-28
**Status:** 🟡 Draft

## Problem

claude.ai routines (cloud agents, e.g. the agent-nexus daily tech-radar `trig_019AS3dhCKzNmYAejfX2hM2w`) run on Anthropic infrastructure and have no path back into the MCD ecosystem. Their output lands only in the claude.ai UI — it cannot reach the project's Discord channel, cannot create tracked handoffs, and cannot write to the shared learnings board. Meanwhile MCD's MCP server already speaks exactly the protocol claude.ai custom connectors require (stateless Streamable HTTP), but it is unreachable from outside the host:

1. **Binding** — the server listens on `127.0.0.1` with an ephemeral port (`opts.port ?? 0`, `src/master-mcp-server.ts:169`). The `port` option exists but nothing wires it from config, and there is no way to front it with TLS.
2. **Auth mismatch** — per-chat auth uses a custom `x-mcd-token` header (`src/master-mcp-server.ts:273`). claude.ai custom connectors support only OAuth 2.0 or unauthenticated URLs; they cannot send custom headers.
3. **Token rotation** — chat tokens are minted in-memory on first request (`tokenFor`, `src/master-mcp-server.ts:225`) and rotate on every server restart, so any externally configured credential breaks at the next deploy.

## Proposed Solution

Expose a single, operator-chosen project chat's MCP endpoint to claude.ai through Caddy, using a capability-URL (long random path secret) that Caddy translates into the `x-mcd-token` header. MCD changes stay minimal; the trust boundary lives in the reverse proxy.

1. **Fixed port config** — new `defaults.mcp.{port?, host?}` in `channels.json` (zod schema in `src/channels-config.ts`), wired into the `MasterMcpServer` constructor in `server.ts:1219`. Default remains ephemeral/localhost when absent — zero behavior change for existing installs.
2. **Static external tokens** — new `projects[<chat_id>].externalToken?` (or `defaults.mcp.externalTokens` map). When present, `tokenValid()` accepts the static token *in addition to* the in-memory per-boot token used by local claude subprocesses. Stored in `channels.json` (already mode-sensitive state dir); minted via a new `!project set <slug> --external-token rotate|none` flag so the operator never hand-writes secrets.
3. **Caddy route (docs + snippet, not code)** — documented Caddyfile block:
   `https://mcd.tecbizsolutions.com` route `/<url-secret>/mcp/<chat_id>` → strip prefix → `reverse_proxy 127.0.0.1:<port>` with `header_up x-mcd-token <static-token>`. The URL secret is the claude.ai-facing credential (connectors accept unauthenticated URLs); the header token is the MCD-facing credential. Both rotate independently.
4. **Guardrails** — refuse `--external-token` on the master project (endpoint carries `run_master_command`); log every externally-authed request (`external` marker in the request log) so connector traffic is auditable.

Result: operator adds `https://mcd.tecbizsolutions.com/<secret>/mcp/1502917980625829932` as a claude.ai custom connector; the tech-radar routine gains `reply`, `fetch_messages`, `share_learning`, `handoff`, `ask_project` scoped to the agent-nexus project, and its findings land in Discord as tracked MCD activity.

## Scope

### In Scope
- `defaults.mcp.{port, host}` config + wiring to `MasterMcpServer` (`src/channels-config.ts`, `server.ts`)
- Static external token: schema, `tokenValid()` dual-accept, `!project set --external-token rotate|none`, master-target refusal (`src/master-mcp-server.ts`, `src/master-commands.ts`)
- External-request audit logging
- Caddy setup documentation + example Caddyfile snippet (README or ARCHITECTURE section)
- Tests: token dual-accept, rotation, master refusal, config schema (`src/master-mcp-server.test.ts`, `src/master-commands.test.ts`)

### Out of Scope
- OAuth 2.0 / dynamic client registration on MCD itself (Caddy capability-URL covers v1)
- Exposing the master chat endpoint externally (explicitly refused)
- Automating Caddyfile edits from MCD (operator applies the snippet manually)
- Per-tool scoping / reduced toolset for external callers (full project toolset in v1; revisit if needed)
- Inbound message push from claude.ai → MCD (connector is claude.ai-initiated tool calls only)

## Impact

- **Files affected:** ~6 (`src/master-mcp-server.ts`, `src/channels-config.ts`, `src/master-commands.ts`, `server.ts`, docs, tests)
- **Complexity:** small–medium
- **Risk:** medium — first intentional exposure of an MCD endpoint beyond localhost. Mitigated by: double secret (URL path + header token), single non-master chat scope, TLS via Caddy, audit logging, and default-off (no config → no exposure).

## Open Questions

1. Static token per project (`projects[*].externalToken`) vs central map (`defaults.mcp.externalTokens`)? Per-project reads cleaner and colocates with the thing being exposed — proposed default.
2. Should external calls bypass or respect the project's `disabled` flag? Proposal: respect it (`deliver()` gate already handles it for `ask_project`-style paths; direct `reply` should also refuse when disabled).
3. Rate limiting on external requests — Caddy-level or skip in v1? Proposal: skip; single trusted routine, revisit if a connector misbehaves.
4. Does claude.ai's connector validation require the MCP `initialize` handshake over GET/SSE as well as POST? Verify during build against a real connector registration; stateless transport may need a benign GET response.

---

**To proceed:** Review this proposal and approve to begin planning.
