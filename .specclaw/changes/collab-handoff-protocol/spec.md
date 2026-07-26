# Spec: Collab handoff protocol

**Change:** collab-handoff-protocol
**Created:** 2026-07-26
**Status:** 🟡 Draft

## Overview

Turn the existing fire-and-forget `mcp__mcd__handoff` tool into a tracked collaboration primitive: every handoff gets an id and a pending/done/expired lifecycle, receivers close it explicitly (`handoff_complete`) or implicitly (reply detection for external bot peers), stalled handoffs nag once then escalate to master, and stable role names (`collab.roles`) let prompts say "reviewer" instead of hardcoding slugs/ids. Grounded in the finaudit-agents failure analysis (2026-07-26): agreed workflows ("dHermes reviews each PR") silently never fired because nothing tracked the handoff.

## Requirements

### Functional Requirements

- **FR1 — Handoff registry.** Every `handoff` tool call creates a record `{ id: "h-<base36ts>-<hex4>", from, to, task, state, createdAt }` persisted in `<MCD_CHANNELS_DIR>/shared/handoffs.json` (atomic tmp+rename writes, survives restarts). States: `pending → done | expired`.
- **FR2 — External bot-peer targets.** `handoff` accepts targets that resolve to a bot-peer id in the source project's `botPeers.allow`. Delivery = post to the source project's own channel: `<@botId> [handoff #h-<id> from <slug>] <task>` (bot peers share the project channel; the mention satisfies dHermes' `DISCORD_ALLOW_BOTS=mentions`). Internal project targets keep the existing `pool.deliver` path, with `#h-<id>` added to the envelope content.
- **FR3 — Role resolution.** Per-project `collab.roles: Record<string, string>` maps a role name to an internal project slug or an external bot-peer id. `handoff` accepts `role` as an alternative to `target_slug`; resolution errors name the missing role and the configured roles.
- **FR4 — Completion.** `mcp__mcd__handoff_complete({ id, outcome })` marks a pending handoff `done` (exposed to any project session that is the handoff's target; master may close any). Fallback for external bots: an inbound allowlisted bot message containing a known pending `#h-<id>` for that channel marks it `done` with the message text as outcome.
- **FR5 — Timeout escalation.** A scheduler sweep (every tick batch, acting on handoffs older than `timeoutMinutes`, default 30) nags the receiver once (`⏰ handoff #h-<id> pending Nm: <task ≤120>`), and on a second timeout window escalates to the master channel (`⚠️ handoff #h-<id> <from>→<to> unanswered`) and marks it `expired`. Sweep is idempotent; each transition fires at most once per handoff.
- **FR6 — Turn-limit exemption.** An inbound bot-peer message that closes a known pending handoff (FR4 fallback) is delivered without incrementing the bot-peer consecutive counter. Exemption applies only when a matching pending id exists — unmatched `#h-…` text gets normal gate treatment (loop safety).
- **FR7 — Master verb.** `!project collab <slug>` shows configured roles and open handoffs (id, direction, age, task ≤80 chars). `!project set <slug> --collab-role <name>=<slug|botId>` adds/updates a role; `--collab-role <name>=none` removes it. Values are validated: internal target must be an existing non-master, non-self slug; external target must be in the project's `botPeers.allow`.
- **FR8 — Docs norms.** CLAUDE.md template gains the addressing protocol (unaddressed human messages belong to the channel-owner bot) and peer-clarify norm (answer a peer's blocking question when you own the context) — docs only, no enforcement code.

### Non-Functional Requirements

- **NFR1 — Registry bounded.** `handoffs.json` capped: completed/expired records pruned beyond 200 entries or 30 days (oldest first). File writes atomic.
- **NFR2 — Fail-open display, fail-closed reach.** Notification/mirror failures never fail the tool call (log + continue). Gate checks (handoff enabled, role validation, allowlist membership) are enforced in both tool listing and call handler (defense-in-depth pattern per context.md).
- **NFR3 — Injectable side effects.** Registry takes an injectable clock; sweep and server wiring take injected deps so tests never touch real Discord/tmux.

## Acceptance Criteria

- **AC1:** `handoff` with `target_slug` (internal) creates a pending registry record and the target envelope contains `#h-<id>`.
- **AC2:** `handoff` with `role: "reviewer"` where roles maps reviewer → bot-peer id posts `<@id> [handoff #h-<id> …]` to the source channel and records `to.kind === 'botPeer'`.
- **AC3:** `handoff_complete` from the target project transitions pending → done; from an unrelated project it is refused; from master it succeeds.
- **AC4:** Inbound allowlisted bot message containing a pending `#h-<id>` marks it done and does NOT increment the consecutive counter; the same message with no matching pending id increments normally.
- **AC5:** Sweep: a pending handoff older than timeout gets exactly one receiver nag; older than 2× timeout escalates to master once and becomes `expired`. Re-running the sweep produces no duplicate posts.
- **AC6:** `set --collab-role reviewer=nosuch` is refused with a clear error; `reviewer=<valid-slug>` persists to channels.json; `reviewer=none` removes it.
- **AC7:** `!project collab <slug>` lists roles + open handoffs; empty state prints a friendly line.
- **AC8:** Registry survives restart: records written before a process restart load correctly after (file-backed, schema-validated).
- **AC9:** `bun tsc --noEmit` clean; all existing test suites still pass.

## Edge Cases

- Handoff to a disabled target project → refused (`target project is disabled`), no record created.
- Role resolving to a slug that was renamed/deleted after configuration → tool errors with the stale value named; `collab` verb flags stale roles.
- Duplicate `handoff_complete` for an already-done id → idempotent ok (no error, no state change).
- Corrupt/unparseable handoffs.json → treated as empty with a stderr warning (fail-open read), next write rewrites clean.
- Bot-peer message matching TWO pending ids → closes all matched ids, single delivery.
- `collab.roles` present but `handoff` flag off → tools stay hidden; `collab` verb still shows config (read-only).

## Dependencies

- Existing: `handoff` tool + `handoffEnabled()` gate, `BotPeerGate`, `botPeers.allow`, scheduler sweep registration pattern, `routeNotification`, shared-learnings file pattern.
- No new packages.

## Notes

Out of scope per proposal: event sniffing (auto PR-opened triggers), Hermes-side config, multi-hop delegation chains, non-Discord report-back parity.
