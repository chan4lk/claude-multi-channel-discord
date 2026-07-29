# Tasks: Ops MCP Surface

**Change:** ops-mcp-surface
**Created:** 2026-07-29
**Total Tasks:** 6

## Summary

Two waves: Wave 1 lands the config field, endpoint, tools, and master verb (T1 → T2/T3 can proceed once T1's schema field exists); Wave 2 covers tests and docs against the built surface.

## Tasks

### Wave 1 — Config, endpoint, verb

- [x] `T1` — Add `opsToken` to the channels.json schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Kind: config
  - Notes: Optional top-level `opsToken: z.string().optional()` on the root config schema. No other schema changes.

- [x] `T2` — `/mcp/ops` route + `buildOpsServer()` in MasterMcpServer
  - Files: `src/master-mcp-server.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: Route check for `/mcp/ops` (± trailing slash) BEFORE `ChatIdRoute`; private `opsTokenValid(presented)` timing-safe vs `getConfig()?.opsToken` (null-safe: no config or no token ⇒ false); 405 GET/DELETE; stateless Server+Transport per POST, same as chat path. `buildOpsServer()`: 7 tools (`list_projects`, `project_status{slug}`, `backlog_state{slug}`, `schedules{slug?}`, `usage`, `collab_state{slug}`, `server_info`); slug regex `/^[A-Za-z0-9._-]{1,64}$/` validated before composing; delegate via `this.executeMasterCommand` (error `ops tools not configured` when absent); `server_info` composed from `getConfig()` project count + `getPool()?` warm count — no secrets. Log `ops request` / `ops tool <name>`. Comment the verb whitelist as a security boundary. Ops token must NOT be accepted by `tokenSource()` on chat routes (don't touch that method — isolation is structural since `opsTokenValid` is only called for `/mcp/ops`, and chat tokens only live in `chatTokens`/`externalToken`).

- [x] `T3` — `ops` master verb (status / rotate / none)
  - Files: `src/master-commands.ts`
  - Estimate: small
  - Kind: impl
  - Depends: T1
  - Notes: New `case 'ops'` + `handleOps(rest, ctx)`; add `'ops'` to `MUTATION_VERBS`; help text row. `ops` → masked token status (`fa16…9cf` style) + `/mcp/ops` hint or `not configured`; `ops rotate --yes` → `randomBytes(32).toString('hex')`, persist via existing config save path, reveal once + "update Caddy header_up" reminder; `ops rotate` sans `--yes` → refusal; `ops none` → delete field. Mirror `--external-token` wording where sensible.

### Wave 2 — Tests, docs

- [x] `T4` — MCP server tests (AC1–AC6, AC8)
  - Files: `src/master-mcp-server.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T2
  - Notes: Follow the file's existing PASS/FAIL check style + HTTP harness. Cases: no/wrong/unconfigured token ⇒ 401; correct token ⇒ tools/list is exactly the 7 ops tools; `list_projects` call reaches an injected `executeMasterCommand` stub with exactly `list`; each slug tool composes the right string; `slug: "foo --yes"` ⇒ error, stub uncalled; opsToken on `/mcp/<chat_id>` ⇒ 401 and chat local token on `/mcp/ops` ⇒ 401; `server_info` has counts, no token material; GET `/mcp/ops` ⇒ 405. Confirm all pre-existing checks pass unmodified (NFR3).

- [x] `T5` — Master-command tests (AC7)
  - Files: `src/master-commands.test.ts`
  - Estimate: small
  - Kind: test
  - Depends: T3
  - Notes: `ops rotate --yes` persists 64-hex + reveals once; `ops` masked; `ops none` removes; `rotate` without `--yes` refused; non-allowFrom user refused (existing unauthorized-path harness).

- [x] `T6` — README "Ops MCP surface" section
  - Files: `README.md`
  - Estimate: small
  - Kind: docs
  - Depends: T2, T3
  - Notes: What/why, `ops rotate --yes` flow, Caddy capability-URL recipe (second secret path → `header_up x-mcd-token <opsToken>` → client URL `https://…/<secret>/mcp/ops`), `claude mcp add --transport http mcd-ops <url>` example, gotcha box: every rotate needs the Caddyfile header updated (claude-ai-connector lesson).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Kind: docs | test | config | refactor | impl | migration   (optional; hints the build subagent's role, tools, and model)
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
