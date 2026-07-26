# Proposal: Collab handoff protocol

**Created:** 2026-07-26
**Status:** 🟡 Draft

## Problem

Multi-agent collaboration in bot-peer channels (finaudit-agents ↔ dHermes, observed 2026-07-16 → 2026-07-26) is entirely ad hoc: agents coordinate via free-text @mentions with no shared task state, no handoff mechanism, and no delivery guarantee. Channel-history analysis of 100 recent messages shows the concrete failures:

1. **Handoffs silently never fire.** The operator agreed a workflow ("dHermes reviews each PR"), but when mclaude opened PR #2 and #3 no review was ever triggered — the reviewer waits for a ping the builder never sends. There is no mechanism, only convention.
2. **Ambiguous human broadcasts cause races.** "keep building the proposals" / "merge the pr" were each interpreted by both bots against different targets (repo backlog vs `~/proposals/` scratchpad); the operator had to manually "stand down" the wrong bot 3 times in one session.
3. **Peer questions dead-end on the human.** dHermes' clarify prompts timed out after 10-minute waits (3 occurrences) even when mclaude demonstrably knew the answer — there is no norm or channel for one agent to answer another's blocking question.
4. **Coordination messages compete with noise for the turn budget.** The bot-peer consecutive-turn limit (5) tripped mid-coordination because still-working status ticks consumed the budget (already filed: `bot-peer-limit-status-exempt`, `watchdog-status-noise-collapse` — both draft since 2026-07-18).

The result: the operator acts as a human message bus, relaying, disambiguating, and un-jamming the agents — the opposite of autonomous collaboration ([[project_mcd_vision]]: autonomy north star).

## Proposed Solution

Add a first-class, deterministic handoff primitive to MCD, layered on the existing bot-peers plumbing:

1. **`mcp__mcd__handoff` MCP tool** — an agent explicitly hands work to a named peer: `handoff({ to: "<role|peer>", task: "<text>", context?: "<text>" })`. MCD delivers it to the peer channel/bot with structured attribution (`[handoff from <slug> #h-<id>] <task>`), records it as *pending*, and confirms delivery to the sender.
2. **Pending-handoff tracking** — each handoff gets an id + state (`pending` → `acked`/`done`/`expired`). The receiving agent closes it via `handoff_complete({ id, outcome })` (or a reply-detection fallback). If a handoff sits pending past a timeout (default 30 min), MCD nags the receiver once, then escalates to the master channel — handoffs can no longer silently die.
3. **`collab.roles` config** — per-project role map in `channels.json` (`collab: { roles: { reviewer: "<botPeerId|projectSlug>", builder: "self" } }`) so prompts and handoffs use stable role names instead of raw ids; validated against existing `botPeers.allow` / `peers.allow`.
4. **Turn-limit exemption for handoff traffic** — handoff delivery and completion messages don't count toward `botPeers.maxConsecutive` (same rationale as the filed status-exempt proposal).
5. **`!project collab <slug>`** master verb — show roles + open handoffs; `!project set <slug> --collab-role reviewer=<id>` to configure.

Works uniformly for external bot peers (botPeers, e.g. dHermes) and MCD-internal peers (`ask_project` projects) — the handoff layer sits above both transports.

Explicitly deferred to config/docs (no code): addressing protocol (unaddressed human msgs belong to channel owner) and peer-clarify norm (answer a peer's blocking question if you own the context) — these land in project CLAUDE.md templates as part of this change's docs task.

## Scope

### In Scope
- `mcp__mcd__handoff` + `mcp__mcd__handoff_complete` MCP tools (master-mcp-server)
- Handoff registry with persistence (`channels.json` runtime block or `shared/handoffs.json`), states, timeout nag + master escalation via scheduler sweep
- `collab.roles` schema in channels-config + validation
- `!project collab` verb + `set --collab-role`
- Turn-limit exemption for handoff-tagged messages (bot-peers gate)
- CLAUDE.md template updates: addressing protocol + peer-clarify norm
- Tests for registry state machine, role resolution, exemption

### Out of Scope
- Event sniffing (auto-detecting "PR opened" from git/GitHub) — handoffs are explicit tool calls; event triggers can layer on later
- Hermes-side config changes (`free_response_channels` removal — still pending operator, tracked in postmortem memory)
- The 3 noise proposals themselves (`watchdog-status-noise-collapse`, `bot-peer-limit-status-exempt`, `heartbeat-live-task-count`) — prerequisites, approved separately
- Multi-hop delegation chains / task marketplaces
- Cross-server (non-Discord) handoff report-back parity

## Impact

- **Files affected:** ~8 (master-mcp-server.ts, channels-config.ts, master-commands.ts, bot-peers.ts, scheduler.ts, server.ts, new src/handoffs.ts + test)
- **Complexity:** medium
- **Risk:** medium — new persistent state + new inbound injection path; mitigated by reusing the existing deliver() funnel and bot-peer gate

## Open Questions

1. Should a pending-handoff timeout re-deliver to the receiver, or only escalate to master? (Proposal: one nag to receiver, then master escalation — no retry loops between bots.)
2. Reply-detection fallback for peers that can't call `handoff_complete` (external bots like dHermes have no MCD MCP access): treat any @reply from the receiver referencing `#h-<id>` as ack? (Proposal: yes — regex on inbound.)
3. Store handoffs in `channels.json` runtime (consistent with autopilot/backlogWatch) or a separate `shared/handoffs.json` (keeps channels.json small)? (Proposal: separate file, learnings-board pattern.)

---

**To proceed:** Review this proposal and approve to begin planning.
