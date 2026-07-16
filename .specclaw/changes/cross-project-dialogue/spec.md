# Spec: Cross-Project Dialogue (MCD project ↔ project messaging + shared learnings)

**Change:** cross-project-dialogue
**Created:** 2026-07-16
**Status:** 🟡 Draft

## Overview

Let two MCD project Claude sessions hold a constrained dialogue without operator relay, and share durable learnings via a common board. Builds on the existing one-way `handoff` tool's plumbing (slug resolution, `pool.deliver` envelope injection, Discord visibility posts) but adds: mutual-consent peer allowlists, threaded reply-back semantics, hop budgets, per-pair cooldowns, and two learnings tools backed by a shared markdown file. The existing `handoff` tool is untouched.

## Requirements

### Functional Requirements

- **FR1 — Peer config.** `ProjectSchema` gains optional `peers: { allow: string[] (slugs), maxHops?: number, cooldownSeconds?: number }`. `DefaultsSchema` gains optional `peers: { maxHops?: number, cooldownSeconds?: number }` (limits only — the allowlist is never defaultable). Effective limits: project → defaults → built-in (`maxHops: 6`, `cooldownSeconds: 15`).
- **FR2 — `ask_project` MCP tool.** Exposed to a project session only when its config has `peers.allow` non-empty. Args: `{ target_slug: string, text: string, thread_id?: string }`. Delivery requires **mutual consent**: target slug ∈ source's `peers.allow` AND source slug ∈ target's `peers.allow`. Violations return `errorResult` (tool call fails, no delivery).
- **FR3 — Threaded hop budget.** Omitted/unknown `thread_id` starts a new thread (server-generated id `t-<ts>-<rand>` returned in the tool result). Each delivery increments the thread's hop count; delivery is refused with an error once the count would exceed effective `maxHops`. Hop state is in-memory (process lifetime); restart resets it.
- **FR4 — Per-pair cooldown.** Deliveries on the same directed pair (source→target) closer together than effective `cooldownSeconds` are refused with an error stating the wait remaining.
- **FR5 — Peer envelope.** Injected message content is `[Peer message from "<sourceSlug>" thread=<id> hop=<n>/<max>] <text>`, `userId`/`username` = `peer:<sourceSlug>`, so the target session can attribute the sender and echo `thread_id` when replying via its own `ask_project`.
- **FR6 — Discord mirror.** On successful delivery, post a preview (first 200 chars) to **both** channels: source gets `🔁 → <targetSlug>: <preview>`, target gets `🔁 from <sourceSlug>: <preview>`. Mirror failures are logged, never fail the tool call.
- **FR7 — Master exclusion.** The master project is never a valid `ask_project` target, and the master session does not get the `ask_project` tool (it already has `inject`/`handoff`).
- **FR8 — Shared learnings board.** New module `src/shared-learnings.ts` managing `<MCD_CHANNELS_DIR>/shared/learnings.md`: `appendLearning({ slug, text, tags })` appends `- [<ISO ts> <slug>] <text> <#tag ...>`; file capped at 64 KB — when exceeded, oldest entries are dropped (rotation preserves newest). Entries over 2 KB are rejected.
- **FR9 — Learnings MCP tools.** `share_learning({ text, tags?: string[] })` and `read_learnings({ tags?: string[], limit?: number })` exposed to any project session with `peers.allow` non-empty (and to master). `read_learnings` filters by tag (AND semantics) and returns newest-first up to `limit` (default 20).
- **FR10 — Master verb.** `!project set <slug> --peers <slug,slug,...>` replaces the project's `peers.allow`; `--peers none` removes the peers block. Slugs validated against existing projects; self-reference rejected. Standard `set` authorization applies (allowFrom).

### Non-Functional Requirements

- **NFR1** — Peer routing never touches the Discord inbound path (no bot messages, no send round-trip); it goes `MCP tool → pool.deliver` in-process.
- **NFR2** — Hop/cooldown state lives in the `MasterMcpServer` instance; no new state files. Restart forgiveness (reset budgets) is acceptable and documented.
- **NFR3** — Learnings file writes are atomic (write temp + rename), consistent with `channels-config.ts` IO style.
- **NFR4** — All new tool descriptions state their constraints so sessions self-limit (e.g. "budget: N hops per thread").
- **NFR5** — `bun tsc --noEmit` clean; existing tests unaffected.

## Acceptance Criteria

- **AC1** — `tools/list` for a project without `peers` config omits `ask_project`, `share_learning`, `read_learnings`; with `peers.allow` non-empty, all three appear. Master lists learnings tools but not `ask_project`.
- **AC2** — `ask_project` A→B with mutual consent delivers: pool receives envelope with `userId: "peer:<aSlug>"` and content matching FR5 format; tool result includes `thread_id` and `hop`.
- **AC3** — One-way allow (A allows B, B does not allow A) → `errorResult` mentioning mutual consent; nothing delivered.
- **AC4** — With `maxHops: 2` on a thread: third delivery on that thread is refused; a fresh thread delivers again.
- **AC5** — Two deliveries on the same pair within `cooldownSeconds` → second refused; after the window (fake clock), it succeeds.
- **AC6** — `ask_project` targeting master slug or self → error; unknown slug → error.
- **AC7** — `share_learning` appends a slug-attributed, timestamped line; `read_learnings` returns it; tag filter excludes non-matching entries; `limit` respected, newest first.
- **AC8** — Appending past 64 KB drops oldest entries, keeps newest (file stays ≤ cap and still parses); >2 KB entry rejected with error.
- **AC9** — `set <slug> --peers <other>` persists `peers.allow` to channels.json; `--peers none` removes it; unknown slug and self-reference rejected with usage message.
- **AC10** — Mirror posts: successful delivery sends both channel previews (assert via mocked client), truncated at 200 chars.
- **AC11** — Full gate: `bun tsc --noEmit` + all three existing test files + new tests pass.

## Edge Cases

- Target project process not running → `pool.deliver` lazy-spawns (existing behavior); no special handling.
- Forged/expired `thread_id` → treated as new thread (server owns hop accounting; a bogus id can't inflate another thread's budget).
- Learnings file missing/dir absent → created on first append; `read_learnings` on missing file returns empty list.
- Concurrent appends → atomic rename makes last-writer-wins on the whole file acceptable at this scale (single process, sequential tool calls).
- `tags` with `#` or whitespace → normalized (strip `#`, lowercase, reject empty).
- Peer slug renamed after config set → stale allow entries simply never match; `set --peers` validates at write time only.

## Dependencies

- Existing: `pool.deliver` + `InboundEnvelope`, `findProjectBySlug`, `fetchTextChannel` visibility-post pattern (handoff), `parseFlags`/`handleSet` (master-commands), zod config schema, stateless MCP dispatch.
- No new packages.

## Notes

Operator-approved defaults (from proposal open questions): fire-and-forget delivery (no blocking wait), 200-char mirror previews, `maxHops` 6 / `cooldownSeconds` 15, global learnings commons (not per-pair), 64 KB cap. Bot-to-bot Discord messaging is the separate `bot-peer-dialogue` change.
