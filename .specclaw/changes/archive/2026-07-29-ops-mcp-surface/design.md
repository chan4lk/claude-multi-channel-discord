# Design: Ops MCP Surface

**Change:** ops-mcp-surface
**Created:** 2026-07-29

## Technical Approach

Reuse over reimplementation: the ops endpoint is a thin, token-gated adapter from seven read-only MCP tools onto the existing `!project` read verbs. `MasterMcpServer` already holds an injected `executeMasterCommand` callback (used by master's `run_master_command`); ops tools compose fixed command strings (`list`, `show <slug>`, `backlog <slug>`, `schedule list [<slug>]`, `usage`, `collab <slug>`) and pass them through. Zero render logic is duplicated; every `!project` display improvement automatically reaches ops clients.

Auth follows the `externalToken` precedent (claude-ai-connector, `.specclaw/context.md` Recent Decisions: "MCP endpoint reachable … via a persistent per-project externalToken … the auth bridge is a Caddy capability-URL"): a persistent secret in `channels.json`, presented via `x-mcd-token`, compared timing-safe, fronted externally by a Caddy secret-path that injects the header. The difference: `opsToken` is instance-level (top-level config field), not per-project, and is valid *only* on `/mcp/ops` — never on chat routes — while chat tokens are never valid on `/mcp/ops`.

## Architecture

```
any Claude instance (Claude Code / desktop / agent)
        │  https://mcd.tld/<caddy-secret>/mcp/ops   (capability URL)
        ▼
Caddy: handle_path strip → header_up x-mcd-token <opsToken> → 127.0.0.1:48620
        ▼
MasterMcpServer.route()
  ├─ url === '/mcp/ops'            ← NEW, checked before ChatIdRoute
  │    ├─ opsTokenValid()? ── no → 401
  │    └─ buildOpsServer() ── stateless Server+Transport per POST
  │         tools: list_projects · project_status · backlog_state
  │                schedules · usage · collab_state · server_info
  │         └─ executeMasterCommand('<whitelisted read verb>')
  │              └─ handleMasterCommand → handleList/handleShow/… (unchanged)
  └─ ChatIdRoute /mcp/<chat_id>    ← existing, byte-for-byte unchanged
```

Gate check follows the `<feature>Source`/`<feature>Access` convention (context.md: "Gate checks live in private `<feature>Access`/`<feature>Source` methods on `MasterMcpServer`"): private `opsTokenValid(presented): boolean` reading `getConfig()?.opsToken`.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | Add optional top-level `opsToken: z.string()` to the config schema |
| `src/master-mcp-server.ts` | modify | `/mcp/ops` route (pre-ChatIdRoute), `opsTokenValid()`, `buildOpsServer()` with 7 tools + slug validation, `ops` log markers |
| `src/master-commands.ts` | modify | New `ops` verb (status / `rotate --yes` / `none`), help text row, add to `MUTATION_VERBS` |
| `src/master-mcp-server.test.ts` | modify | AC1–AC6, AC8 checks (token gates, tool list, command composition, injection guard, cross-route isolation) |
| `src/master-commands.test.ts` | modify | AC7 checks (`ops` verb lifecycle, allowFrom gate, `--yes` gate) |
| `README.md` | modify | "Ops MCP surface" section: rotate flow, Caddy recipe, `claude mcp add` example, rotate⇒Caddy-sync gotcha |

No `server.ts` changes: `executeMasterCommand`, `getConfig`, and `getPool` are already injected (server.ts:1234–1264).

## Data Model Changes

`channels.json` top level:

```jsonc
{
  "master": { ... },
  "defaults": { ... },
  "opsToken": "<64-hex>",   // NEW, optional; absent = ops endpoint off
  "projects": { ... }
}
```

Written only by `!project ops rotate --yes` / removed by `ops none`, via the existing atomic config IO. Low-churn operator-owned secret — belongs in `channels.json` per the context.md rule (high-churn runtime state goes to `shared/*.json`; this is not that).

## API Changes

New HTTP surface: `POST /mcp/ops` (405 on GET/DELETE, 401 unauthenticated — same shapes as chat routes). New MCP tools (ops endpoint only): `list_projects`, `project_status`, `backlog_state`, `schedules`, `usage`, `collab_state`, `server_info`. New master verb: `ops [rotate --yes | none]`.

## Key Decisions

1. **Compose commands, don't export handlers.** Alternative was exporting `handleList`/`handleShow`/… from `master-commands.ts` and calling directly. Rejected: `handleUsage` needs a full `MasterContext` (mutator, circuit states) that `MasterMcpServer` doesn't hold; the injected `executeMasterCommand` already builds that context in `server.ts`. String composition + strict slug regex gives the same reuse with no new coupling.
2. **Slug regex as the injection boundary.** `executeMasterCommand` runs `splitArgv` on the composed line; a slug like `foo --yes` or `foo"; rm` must never reach it. `/^[A-Za-z0-9._-]{1,64}$/` matches every legal slug (init slugifies to lowercase/hyphens) and admits no whitespace/quote/flag characters. Checked before composition — fail = tool error, stub never called (AC5).
3. **Instance-level token, not a pseudo-project.** An `ops` pseudo-project entry would leak into `list`, pool logic, and sweeps. A top-level field keeps the fleet model clean.
4. **`ops` verb rather than a `set` flag.** `set` targets a project slug; `opsToken` has no project. A standalone verb mirrors how `teams-setup` handles instance-level config.
5. **Attribution:** ops-invoked commands run through `executeMasterCommand`'s synthetic `__mcd_master_self__` identity (read verbs only, so command-log attribution granularity is acceptable); per-request `ops` log markers in `MasterMcpServer` provide the audit trail (FR8).
6. **Defense in depth** (context.md: "tool listing AND call handler check the same gate independently"): the ops Server is a *separate* `buildOpsServer()` whose list and call handlers contain only the seven tools — session tools aren't gated out, they're structurally absent.

## Risks & Mitigations

- **Leaked ops URL ⇒ fleet metadata disclosure** (slugs, git remotes in `show`, schedule prompts). Mitigation: read-only by construction (NFR1), token rotatable in seconds (`ops rotate --yes` + Caddy header update), endpoint off unless `opsToken` exists.
- **Future verb drift:** someone later maps an ops tool to a mutating verb. Mitigation: NFR1 stated in spec; test asserts the stub receives only whitelisted strings; comment in `buildOpsServer()` marks the whitelist as a security boundary.
- **Rotate/Caddy drift** (hit us on claude-ai-connector: rotated `externalToken`, stale Caddy `header_up` → mystery 401s). Mitigation: `ops rotate` reply text explicitly reminds "update the Caddy header_up"; README gotcha box.
- **`ops` as chat_id collision:** route order (ops check first) makes `/mcp/ops` unambiguous; Discord/Teams/WhatsApp ids can't be `ops` anyway.

## Grounding sources

- `.specclaw/context.md` — gate-method convention ("Gate checks live in private `<feature>Access`/`<feature>Source` methods"), off-by-default reach rule ("features that widen a project Claude's reach … are off by default"), defense-in-depth rule ("tool listing AND call handler check the same gate independently"), config-vs-runtime-state rule ("High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json`"), and the claude-ai-connector decision (capability-URL + `x-mcd-token` bridge, "No OAuth in MCD by design").
- `CLAUDE.md` — externalToken semantics ("master refused structurally in `tokenSource()` even if hand-edited into config") — mirrored inversely: ops token refused structurally on chat routes.
