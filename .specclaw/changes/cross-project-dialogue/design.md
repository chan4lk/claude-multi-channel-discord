# Design: Cross-Project Dialogue (MCD project ↔ project messaging + shared learnings)

**Change:** cross-project-dialogue
**Created:** 2026-07-16

## Technical Approach

Extend `MasterMcpServer` with three gated tools that reuse the handoff plumbing. `ask_project` is handoff-plus-constraints: same slug resolution (`findProjectBySlug`), same `pool.deliver` injection, same visibility-post pattern — plus mutual-consent gating, an in-memory thread/hop ledger, and a per-pair cooldown map. Learnings live in a new small module (`src/shared-learnings.ts`) with atomic file IO, surfaced as two more tools. Config gains a `peers` block; the `set` verb gains `--peers`.

No new processes, files-on-disk state (except the learnings board itself), or Discord inbound changes.

## Architecture

```
project A session ── mcp__mcd__ask_project ──► MasterMcpServer
                                                 │ 1. gate: peers mutual consent (getConfig)
                                                 │ 2. hop ledger: threadHops.get(threadId) < maxHops
                                                 │ 3. cooldown: pairLastSent.get("a→b") + cd ≤ now
                                                 │ 4. pool.deliver(bChatId, peerEnvelope)
                                                 │ 5. mirror posts → both Discord channels
                                                 ▼
project B session ◄── tmux send-keys (existing deliver path)
        │
        └── replies with ask_project({target_slug:"a", thread_id}) — same path, hop++
```

State (instance fields on `MasterMcpServer`, process lifetime):
- `threadHops: Map<string, number>` — thread_id → deliveries so far (pruned FIFO at 500 entries)
- `pairLastSentMs: Map<string, number>` — `"src→dst"` → last delivery timestamp

Learnings:
```
share_learning / read_learnings ──► src/shared-learnings.ts ──► <MCD_CHANNELS_DIR>/shared/learnings.md
                                        append: parse → cap 64KB (drop oldest lines) → tmp+rename
                                        read: parse lines → filter tags → newest-first limit
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | `PeersSchema` (`allow: SlugSchema[]`, `maxHops?`, `cooldownSeconds?`); add `peers` to ProjectSchema; limits-only variant on DefaultsSchema; `effectivePeerLimits(config, project)` helper |
| `src/shared-learnings.ts` | create | `appendLearning`, `readLearnings`, entry parse/format, 64 KB rotation, 2 KB entry cap, atomic write; `sharedLearningsPath()` from `src/paths.ts` |
| `src/paths.ts` | modify | `sharedDir()` + `sharedLearningsPath()` |
| `src/master-mcp-server.ts` | modify | Register `ask_project` (peer-gated, non-master), `share_learning`/`read_learnings` (peer-gated or master); `peerSource(chatId)` gate mirroring `handoffSource`; hop ledger + cooldown maps; handlers |
| `src/master-commands.ts` | modify | `handleSet`: `--peers <csv|none>` validation (slugs exist, no self) + persist; help text |
| `src/master-mcp-server.test.ts` | modify | AC1–AC7, AC10 coverage (mock pool + mocked client `send`) |
| `src/master-commands.test.ts` | modify | AC9 coverage |
| `src/shared-learnings.test.ts` | create | AC7–AC8 unit coverage (tmp dir) |
| `README.md`, `ARCHITECTURE.md`, `CLAUDE.md` | modify | Document peers config, tools, learnings board |

## Data Model Changes

`channels.json`:
```jsonc
"projects": { "<chat_id>": { "peers": { "allow": ["keyflow"], "maxHops": 6, "cooldownSeconds": 15 } } }
"defaults": { "peers": { "maxHops": 6, "cooldownSeconds": 15 } }   // limits only, no allow
```

`shared/learnings.md` entry grammar:
```
- [2026-07-16T04:55:00.000Z claude-mcd] tmux send-keys drops Enter pre-TUI #tmux #claude-cli
```

## API Changes

New MCP tools (server `mcd`):
- `ask_project({ target_slug, text, thread_id? }) → { ok, thread_id, hop, max_hops }`
- `share_learning({ text, tags? }) → { ok }`
- `read_learnings({ tags?, limit? }) → { entries: [{ ts, slug, text, tags }] }`

New master verb flag: `!project set <slug> --peers keyflow,other` / `--peers none`.

## Key Decisions

1. **Reuse handoff plumbing, don't extend the `handoff` tool.** Handoff is shipped, one-way, differently gated. Overloading it with thread args risks regressions; a distinct tool keeps both contracts simple.
2. **Server-owned hop accounting.** The tool result hands back `thread_id`; the target echoes it. The server never trusts client-supplied hop counts — unknown ids just start fresh threads, which cannot exceed budget faster than real ones.
3. **In-memory constraint state (NFR2).** Loops we're guarding against are within-session bursts; persisting hop ledgers across restarts adds a state file for negligible protection.
4. **Errors, not silent drops, for cooldown/hop refusals.** The calling Claude sees why and can back off or tell the operator (bot-peer-dialogue chose silent cooldown drops because Discord senders can't see tool errors; MCP callers can).
5. **Learnings = markdown commons.** Grep-able, operator-editable, no schema migration. Vector search explicitly out of scope.
6. **Mutual consent directional check at call time** from live config — no cached ACLs, so `set --peers` takes effect immediately without respawn.

## Risks & Mitigations

- **Runaway A↔B loop burns tokens** → hop budget per thread (6), per-pair cooldown (15 s), Discord mirrors give the operator live visibility; both limits configurable per project.
- **Prompt injection across projects** → mutual consent (both operators-of-record opted in), `peer:<slug>` attribution in envelope, master excluded both directions.
- **Learnings poisoning/bloat** → slug attribution, 2 KB entry cap, 64 KB file cap with oldest-drop; operator can edit the file directly.
- **Hop-ledger memory growth** → FIFO prune at 500 thread entries.
- **Mirror post failures masking delivery** → mirrors are best-effort (logged), delivery result is the tool's return value.
