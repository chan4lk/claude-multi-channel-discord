# Spec: Ops MCP Surface

**Change:** ops-mcp-surface
**Created:** 2026-07-29
**Status:** 🟡 Draft

## Overview

Add a dedicated read-only operator endpoint `POST /mcp/ops` to `MasterMcpServer`, authenticated by a persistent instance-level `opsToken`, exposing fleet-state query tools (`list_projects`, `project_status`, `backlog_state`, `schedules`, `usage`, `collab_state`, `server_info`) to any standard MCP client. Tools delegate to the existing `!project` read verbs via the already-injected `executeMasterCommand` callback — no render logic is duplicated. External reachability reuses the proven Caddy capability-URL pattern from claude-ai-connector.

## Requirements

### Functional Requirements

- **FR1** — `channels.json` gains an optional top-level `opsToken: string` field (zod schema in `src/channels-config.ts`). Absent field ⇒ ops endpoint refuses all requests (feature off by default, matching the per-project opt-in pattern from `.specclaw/context.md`: "features that widen reach are off by default").
- **FR2** — `MasterMcpServer.route()` handles `POST /mcp/ops` (with or without trailing slash) **before** the `ChatIdRoute` regex match, since `ops` is otherwise a syntactically valid chat_id.
- **FR3** — Auth gate: request header `x-mcd-token` must timing-safe-equal `opsToken` from live config. Per-boot chat tokens are **not** accepted on `/mcp/ops`, and `opsToken` is **not** accepted on any `/mcp/<chat_id>` route (mutual isolation). No token configured ⇒ 401 (same JSON-RPC error shape as existing unauthorized path).
- **FR4** — The ops endpoint serves a separate MCP `Server` (`buildOpsServer()`) listing exactly seven tools:
  - `list_projects` (no args) → executes `list`
  - `project_status { slug }` → `show <slug>`
  - `backlog_state { slug }` → `backlog <slug>`
  - `schedules { slug? }` → `schedule list [<slug>]`
  - `usage` (no args) → `usage`
  - `collab_state { slug }` → `collab <slug>`
  - `server_info` (no args) → composed locally: server name/version, project count, warm-session count (via pool), master configured yes/no. Never lists slugless secrets.
- **FR5** — Slug arguments are validated against `/^[A-Za-z0-9._-]{1,64}$/` before command composition; failing values return a tool error without invoking `executeMasterCommand` (prevents flag/argv injection through the composed command line).
- **FR6** — The ops call handler's switch contains **only** the seven tools above; any other tool name returns `unknown tool`. No `reply`, `run_master_command`, `handoff`, `inject`, `hermes_run`, or memory tools are listable or callable on `/mcp/ops` — defense in depth: absent from both the list handler and the call handler.
- **FR7** — New master verb `ops` in `src/master-commands.ts`:
  - `!project ops` → status: token configured or not (masked, e.g. `fa16…9cf`), endpoint path `/mcp/ops`, README pointer
  - `!project ops rotate --yes` → mint 64-hex token, persist `opsToken`, reveal full token once in the reply (matching `--external-token rotate` behavior)
  - `!project ops none` → delete `opsToken` (no `--yes`, matching `--external-token none`)
  - `ops` is a mutation verb: requires `userId ∈ access.allowFrom`; `rotate` without `--yes` is refused with a hint.
- **FR8** — Every ops request is logged with an `ops` marker (`[mcp-master] ops request` / `ops tool <name>`), mirroring the `external` marker convention.
- **FR9** — README gains an "Ops MCP surface" section: what it is, `ops rotate` flow, Caddy capability-URL recipe (second secret path → `header_up x-mcd-token <opsToken>` → URL `https://…/<secret>/mcp/ops`), `claude mcp add --transport http` example, and the rotate ⇒ update-Caddyfile gotcha (bit us on claude-ai-connector).

### Non-Functional Requirements

- **NFR1** — Read-only guarantee: no ops tool may mutate `channels.json`, spawn/kill processes, deliver messages into project channels, or post to Discord. (`executeMasterCommand` is only ever invoked with the whitelisted read verbs `list`, `show`, `backlog`, `schedule list`, `usage`, `collab`.)
- **NFR2** — Stateless per-request Server + Transport, identical lifecycle to existing chat endpoints.
- **NFR3** — Existing `/mcp/<chat_id>` behavior is byte-for-byte unchanged (all existing tests keep passing unmodified).
- **NFR4** — Timing-safe token comparison (reuse the `timingSafeEqual` pattern from `tokenSource()`).

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

- **AC1** — POST `/mcp/ops` without `x-mcd-token`, with a wrong token, or when no `opsToken` is configured → 401 JSON-RPC error.
- **AC2** — POST `/mcp/ops` with the configured `opsToken`: `tools/list` returns exactly the seven ops tools and none of the session/master tools.
- **AC3** — `tools/call list_projects` returns the `handleList` rendering (verified against an injected `executeMasterCommand` stub receiving exactly `list`).
- **AC4** — `project_status`, `backlog_state`, `collab_state`, `usage`, `schedules` each compose the expected command string (`show x`, `backlog x`, `collab x`, `usage`, `schedule list` / `schedule list x`).
- **AC5** — Slug `"foo --yes"` (or any value failing the regex) → tool error; `executeMasterCommand` stub not called.
- **AC6** — `opsToken` presented on `/mcp/<chat_id>` → 401; a chat's local token presented on `/mcp/ops` → 401.
- **AC7** — `!project ops rotate --yes` persists a 64-hex `opsToken` and reveals it once; `ops` shows masked status; `ops none` removes it; `ops rotate` without `--yes` refused. Non-allowFrom user refused.
- **AC8** — `server_info` returns name, version, project count, and warm-session count without any token material.
- **AC9** — `bun tsc --noEmit` clean; all existing test files pass unchanged; new checks added to `src/master-mcp-server.test.ts` and `src/master-commands.test.ts` pass.
- **AC10** — README section present with Caddy recipe + client-attach example.

## Edge Cases

- `opsToken` removed from config while server running → next request 401 (config is re-read per request via `getConfig`).
- Project chat_id literally equal to `ops` cannot exist in practice (Discord snowflakes are numeric), but route ordering makes the outcome deterministic anyway: `/mcp/ops` is always the ops endpoint.
- `executeMasterCommand` not injected (constructed without it, as some tests do) → ops tools return a `not configured` error; endpoint still auths correctly.
- `schedules` with a slug that resolves to nothing → underlying handler's friendly `no schedules for …` text passes through (no crash).
- GET/DELETE on `/mcp/ops` → 405, same as chat endpoints.
- Disabled projects: `list`/`show`/`backlog` render them (with `⛔` marks) — read-only display is allowed; the `disabled` gate only blocks *acting as* a project, which ops tools cannot do.

## Dependencies

- Existing: `executeMasterCommand` + `getConfig` + `getPool` options on `MasterMcpServer` (all already wired in `server.ts`) — no new server.ts wiring expected beyond none.
- Operator-side (out of repo): Caddy route addition for external reach; documented, not automated.

## Notes

- Decision on proposal Q1: `usage` stays process-stats (existing render) — token/cost is a future enhancement.
- Decision on Q2: `backlog_state` requires a slug (underlying `handleBacklog` requires a target; an all-projects sweep is a future change).
- Decision on Q3: single `opsToken`; Caddy secret-path sync remains a documented manual step (README gotcha).
- Decision on Q4: yes — `server_info` included (cheap, lets a fresh client confirm the instance).
