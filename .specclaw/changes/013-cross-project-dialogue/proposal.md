# Proposal: Cross-Project Dialogue (MCD project ↔ project messaging + shared learnings)

**Created:** 2026-07-16
**Status:** 🟡 Draft

## Problem

Each MCD project runs an isolated Claude session that cannot reach any other project. Two projects on the same server cannot hand off work, ask each other questions, or share what they have learned — even though they live in the same process (`ProjectPool`) and the operator often wants them to collaborate (e.g. keyflow's Claude asking claude-mcd's Claude how the scheduler works, or one project finishing a PR another started). Today the operator must copy/paste between channels by hand.

This is the roadmap item "Cross-project handoff (`@<slug> please finish this`)" generalized to two-way dialogue plus a learning mechanism.

## Proposed Solution

Two parts, both opt-in per project pair.

### 1. Dialogue: `mcp__mcd__ask_project` MCP tool

New MCP tool available to project sessions whose config allows it:

```jsonc
"projects": {
  "<chat_id>": {
    "slug": "claude-mcd",
    "peers": {
      "allow": ["keyflow"],        // slugs this project may message
      "maxHops": 6,                 // total exchanges in one conversation thread
      "cooldownSeconds": 15
    }
  }
}
```

- `ask_project({ slug, text })` routes **internally** through `ProjectPool` — no Discord round-trip. The target session receives a wrapped envelope: `<channel source="mcd-peer" from_slug="claude-mcd" thread_id="..." hop="2/6">BODY</channel>`.
- Target's reply comes back the same way (its own `ask_project` back, or a `reply_to_peer` variant) and lands in the asker's session as a new inbound message.
- Both channels get a mirror post to Discord (`🔁 claude-mcd → keyflow: <text>`) so the operator can watch the dialogue live.
- **Loop constraints:** `hop` counter carried in the envelope — at `maxHops` the pool refuses delivery and posts a notice; `cooldownSeconds` between peer deliveries per pair; operator message to either channel resets nothing (hop budget is per-thread, threads are cheap).
- Authorization is **directional**: A may message B only if B's slug is in A's `peers.allow` AND A's slug is in B's `peers.allow` (mutual consent), preventing one hijacked project from spamming all others.
- Master project excluded as a peer target (its Claude runs privileged `run_master_command`).

### 2. Learning: shared learnings board

Lightweight, file-based: `MCD_CHANNELS_DIR/shared/learnings.md` (append-only, size-capped). New MCP tool `mcp__mcd__share_learning({ text, tags })` appends a timestamped, slug-attributed entry; the same file is readable by every opted-in project via `mcp__mcd__read_learnings({ tags?, limit? })`. Projects with `peers` configured get both tools. This gives "learn from each other" without cross-mounting project dirs or building a memory database — entries look like:

```
- [2026-07-16 04:02 claude-mcd] tmux send-keys drops Enter if TUI not ready; poll for ❯ first. #tmux #claude-cli
```

## Scope

### In Scope
- `channels-config.ts`: `peers` schema on project entries
- `master-mcp-server.ts`: `ask_project`, `share_learning`, `read_learnings` tools (gated by project config)
- `project-pool.ts`: internal peer routing, hop/cooldown enforcement, Discord mirror posts
- `server.ts`: wiring
- Shared learnings file IO with size cap + rotation (`src/shared-learnings.ts`)
- `!project set <slug> --peers <slug,...>` master verb
- Tests: mutual-consent matrix, hop limit, cooldown, master exclusion, learnings append/read/cap
- README + ARCHITECTURE docs

### Out of Scope
- Bot-to-bot via Discord (separate proposal: bot-peer-dialogue — this one never touches the Discord inbound path)
- Automatic learning extraction (projects decide what to share; no transcript mining)
- Vector search / embeddings over learnings (grep-able markdown is v1)
- Peer messaging across MCD instances / machines

## Impact

- **Files affected:** ~7 (estimated)
- **Complexity:** medium-large
- **Risk:** medium — runaway A↔B loops burn tokens (mitigated: hop budget per thread + cooldown + Discord mirror for operator visibility); cross-project prompt injection (mitigated: mutual consent, master excluded, envelope labels source project); learnings file poisoning (mitigated: slug attribution, size cap, operator can prune)

## Open Questions

1. Mirror posts to Discord: full text or first 200 chars? (proposed: 200-char preview)
2. Should `ask_project` block awaiting the peer's answer (synchronous, simpler for the asking Claude) or fire-and-forget with the reply arriving as a later inbound message? (proposed: fire-and-forget — matches existing send-keys architecture; synchronous would hold the MCP HTTP call open across a whole peer turn)
3. `maxHops` default 6 OK? Hop budget per thread_id, new thread = new budget — acceptable, or need a per-hour cap too?
4. Learnings cap: 64 KB with oldest-entry rotation OK?
5. Should shared learnings be global (all opted-in projects) or scoped to peer pairs? (proposed: global — it's a knowledge commons)

---

**To proceed:** Review this proposal and approve to begin planning.
