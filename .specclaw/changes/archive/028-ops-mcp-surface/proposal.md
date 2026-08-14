# Proposal: Ops MCP Surface

**Created:** 2026-07-29
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The operator wants to query MCD's project fleet — what projects exist, their state, backlogs, schedules, resource usage — from **any Claude instance** (Claude Code on a laptop, Claude desktop, another agent), not only from the Discord master channel.

MCD already runs an HTTP MCP server (`MasterMcpServer`, port `MCD_MCP_PORT`), but every endpoint is per-project (`/mcp/<chat_id>`) and serves only that project's *session* tools (`reply`, `ask_project`, …) — designed for the project's own Claude subprocess, not for an outside operator. The one endpoint that can answer fleet questions (master's, via `run_master_command`) is structurally refused external tokens in `tokenSource()` — deliberately, because `run_master_command` can mutate and destroy projects.

Net effect: the only way to ask "what's the state of my projects?" is to open Discord and type `!project list` in the master channel. The claude.ai connector dead-end (2026-07-29, broker OAuth bug) makes a direct-MCP operator surface the natural path instead.

## Proposed Solution

_What are we building? High-level approach._

A dedicated **read-only ops endpoint** on the existing `MasterMcpServer`: `POST /mcp/ops`, gated by its own persistent token (`opsToken` in `channels.json`, minted via `!project set --ops-token rotate --yes` style command on master), exposed externally through the same Caddy capability-URL pattern already proven for the claude.ai connector (secret path prefix → strip → `header_up x-mcd-token`).

The endpoint registers a small read-only tool set that reuses the existing render logic from `master-commands.ts` (the same functions that back `!project list`, `show`, `usage`, `backlog`, `collab`, `schedule list`):

- `list_projects` — slug, platform, model, disabled/enabled, warm/cold session state
- `project_status <slug>` — the `!project show` view: git status, session, provider, flags
- `backlog_state [slug]` — backlog source, X/Y done, autopilot state, stalled flag
- `schedules [slug]` — configured jobs + next-fire estimates
- `usage` — the `ps`/`top` view: warm sessions, RSS, last activity
- `collab_state [slug]` — open handoffs/chains, roles

Strictly **no mutation tools** — no `run_master_command`, no `set`, no `stop`, no message delivery. A leaked ops URL reads state but cannot touch anything.

Any standard MCP client (Claude Code `claude mcp add --transport http`, desktop config) can then attach MCD as a server and answer fleet questions conversationally.

## Scope

### In Scope
- `opsToken` config field + rotate/remove master command flag (mirrors `externalToken` mechanics, mode-0600 handling via existing atomic IO)
- `POST /mcp/ops` route on `MasterMcpServer`, stateless like existing endpoints, token-gated (per-boot local token NOT accepted — external token only, so project sessions can't discover it)
- The 6 read-only tools above, delegating to existing `master-commands.ts` render helpers (refactor those helpers to be callable without Discord reply plumbing where needed)
- README section: attaching MCD to Claude Code / desktop as an MCP server (Caddy capability-URL recipe reusing the claude-ai-connector pattern)
- Tests in `master-mcp-server.test.ts`: token gate (valid/invalid/missing), each tool round-trip, mutation-tool absence

### Out of Scope
- Any mutation verbs over the ops endpoint (create/set/stop/rm/schedule add) — future change if ever
- Sending messages into project channels from outside (`ask_project`-style) — powerful but changes the threat model; separate proposal
- claude.ai web connector registration (dead-ended on broker OAuth bug — this surface targets standard MCP clients)
- Per-tool ACLs / multiple operator identities — single ops token v1
- Streaming/push notifications (stateless HTTP only, same as existing endpoints)

## Impact

- **Files affected:** ~6 (`src/master-mcp-server.ts`, `src/master-commands.ts`, `src/channels-config.ts`, `server.ts`, `README.md`, `src/master-mcp-server.test.ts`)
- **Complexity:** medium (small / medium / large)
- **Risk:** low — new endpoint is additive, read-only, token-gated; existing per-project endpoints untouched

## Open Questions

1. Should `usage` include per-project token spend / cost if available, or just process stats (RSS, last activity)?
2. `backlog_state` with no slug: all projects (could be slow — reads N files) or require a slug?
3. Is one global `opsToken` enough, or should rotation also bump the Caddy secret path (operator currently syncs Caddyfile by hand — the claude-ai-connector rotate/Caddy-drift gotcha bit us once already)?
4. Worth adding a `whoami`/`server_info` tool so a fresh client can confirm it's talking to the right MCD instance?

---

**To proceed:** Review this proposal and approve to begin planning.
