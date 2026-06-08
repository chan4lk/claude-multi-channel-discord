# Proposal: MS Teams Channel for MCD

**Created:** 2026-06-08
**Status:** 🟡 Draft

## Problem

MCD currently supports only Discord as a messaging channel. Teams using Microsoft Teams — common in enterprise environments — cannot use the per-project Claude Code bot without switching platforms. Operators want to run projects on Discord, Teams, or both — without friction.

## Proposed Solution

Add MS Teams as a parallel channel adapter. Key decisions:

- **Linked projects model:** Discord and Teams channels are separate `channels.json` entries, each with its own Claude session. Both can point to the same git repo/worktree. No shared session state — simple and mirrors the existing per-channel isolation model.
- **Setup wizard:** `!project teams-setup` prints step-by-step Azure App Registration instructions, prompts for App ID + secret, then writes `.env` and `channels.json` automatically. One-time friction, no manual JSON editing.

**Architecture:**
- New `src/teams-adapter.ts` — Bot Framework webhook HTTP server, receives Teams activities, wraps in `<channel source="teams" chat_id="..." ...>BODY</channel>`, routes to `ProjectPool`
- New `mcp__mct__reply` MCP tool (or reuse `mcp__mcd__reply` with platform routing) posts back via Bot Framework REST API
- `channels.json` gets a `platform: 'discord' | 'teams'` field per project entry (defaults to `'discord'` for backward compat)
- Both adapters run in the same `bun server.ts` process — no separate entry point

## Scope

### In Scope
- Teams Bot Framework webhook adapter (`src/teams-adapter.ts`)
- Text reply via Bot Framework REST API, chunked at 4000 chars (`src/teams-chunk.ts`)
- `!project teams-setup` wizard (prints Azure instructions, writes `.env` + `channels.json`)
- `platform` field in `channels.json` schema (backward-compatible default: `'discord'`)
- `TEAMS_APP_ID` / `TEAMS_APP_SECRET` loaded from `.env`
- `!project create --platform teams` flag
- Both adapters run concurrently in same process

### Out of Scope
- Shared Claude session across Discord + Teams (linked-projects model chosen)
- Adaptive Cards / rich Teams UI
- Teams voice channel support
- File/attachment upload to Teams
- Teams-specific scheduling
- Migration tooling for existing Discord projects

## Impact

- **Files affected:** ~10–14 (new `src/teams-adapter.ts`, `src/teams-chunk.ts`; edits to `server.ts`, `src/channels-config.ts`, `src/master-commands.ts`, `src/init.ts`, `templates/master.CLAUDE.md`)
- **Complexity:** large
- **Risk:** medium — new external dependency (Bot Framework SDK), Azure webhook auth; core project pool untouched

## Decisions

1. **Auth:** Raw REST + HMAC verification — no Bot Framework SDK dependency.
2. **Webhook endpoint:** `/teams` on same port as the existing MCP HTTP server.
3. **Setup UX:** `!project teams-setup` master-channel command.

## Open Questions

_None — all key decisions resolved._

---

**To proceed:** Approve this proposal to begin planning.
