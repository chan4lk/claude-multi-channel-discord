# Tasks: Cross-Project Dialogue (MCD project ↔ project messaging + shared learnings)

**Change:** cross-project-dialogue
**Created:** 2026-07-16
**Total Tasks:** 6

## Summary

Two independent foundations (config schema; learnings module) land in Wave 1, the MCP tool surface builds on both in Wave 2, master verb + docs/gate close in Wave 3. Repo: `/home/openclaw/dev/multi-channel-discord`.

## Tasks

### Wave 1 — Foundations (parallel-safe)

- [x] `T1` — Peers config schema + effective limits helper
  - Files: `src/channels-config.ts`, `src/master-commands.test.ts` (schema round-trip only if config tests live there; otherwise inline zod tests in channels-config usage sites)
  - Estimate: small
  - Notes: `PeersSchema { allow: SlugSchema[], maxHops?: positive int, cooldownSeconds?: positive int }`; ProjectSchema gets `peers`, DefaultsSchema gets limits-only `peers` (no `allow` — enforce via separate schema). Export `effectivePeerLimits(config, project): { maxHops, cooldownSeconds }` with built-in fallback 6/15. FR1.

- [x] `T2` — `src/shared-learnings.ts` + `src/paths.ts` + unit tests
  - Files: `src/shared-learnings.ts`, `src/paths.ts`, `src/shared-learnings.test.ts`
  - Estimate: medium
  - Notes: `sharedLearningsPath()` under `MCD_CHANNELS_DIR/shared/`; entry format `- [<ISO> <slug>] <text> #tag...`; `appendLearning` (2 KB entry cap, 64 KB file cap w/ oldest-drop, tmp+rename atomic, mkdir -p), `readLearnings({tags?, limit=20})` newest-first AND-tag filter; tag normalization (strip `#`, lowercase, drop empties). FR8, AC7–AC8 unit level.

### Wave 2 — MCP tool surface

- [x] `T3` — `ask_project` tool: gating, hop ledger, cooldown, delivery, mirrors
  - Files: `src/master-mcp-server.ts`, `src/master-mcp-server.test.ts`
  - Estimate: large
  - Depends: T1
  - Notes: `peerSource(chatId)` gate (non-master project with non-empty `peers.allow`); mutual-consent check at call time; `threadHops` Map (FIFO prune 500) + `pairLastSentMs` Map; envelope per FR5 (`userId: peer:<slug>`, messageId `peer-<ts>-<rand>`); mirror posts to both channels, 200-char preview, best-effort (handoff pattern); tool result `{ok, thread_id, hop, max_hops}`. Inject a `now()` clock for cooldown tests. ACs 1–6, 10.

- [x] `T4` — `share_learning` + `read_learnings` tools
  - Files: `src/master-mcp-server.ts`, `src/master-mcp-server.test.ts`
  - Estimate: medium
  - Depends: T2, T3
  - Notes: Gated: project with `peers.allow` non-empty OR master. Wire through `src/shared-learnings.ts`; source slug from project config ('master' for master). tools/list visibility asserted in AC1 test alongside ask_project. AC1, AC7 tool level.

### Wave 3 — Operator surface + gate

- [x] `T5` — `set --peers` verb + help
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: small
  - Depends: T1
  - Notes: `--peers <csv>` replaces `peers.allow` (validate each slug exists via findProjectBySlug, reject self and master slug); `--peers none` deletes peers block; keep existing limits fields when replacing allow; update help text. AC9.

- [x] `T6` — Docs + full gate
  - Files: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`
  - Estimate: small
  - Depends: T3, T4, T5
  - Notes: Document peers config, three tools, learnings board path, constraint semantics (hop/cooldown/in-memory reset on restart). Run `bun tsc --noEmit` + all test files (AC11).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
