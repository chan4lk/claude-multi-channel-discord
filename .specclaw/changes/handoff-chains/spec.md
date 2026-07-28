# Spec: Handoff chains (work-graph layer)

**Change:** handoff-chains
**Created:** 2026-07-28
**Status:** 🟡 Draft

## Overview

Extend the collab handoff registry (PR #318) from single hops into linear multi-step chains. `mcp__mcd__handoff` gains an optional `chain` argument (ordered steps); when a step's handoff closes, MCD auto-fires the next step to its resolved target and posts chain progress to the source channel. Steps may carry an `approve` gate; failing the gate halts the chain and escalates to master. Chain state persists with the handoff registry so chains survive restarts and session evictions. Single-hop handoffs are byte-for-byte unchanged.

## Requirements

### Functional Requirements

- **FR1 — `chain` arg.** `handoff` accepts `chain: [{ role?, target?, task, gate? }, ...]` (2–N steps; exactly one of `role`/`target` per step; `gate` only value `"approve"`). When `chain` is passed, top-level `target_slug`/`role`/`message` are refused (chain steps are the whole spec). Step 1 fires immediately through the existing delivery paths (project envelope or bot-peer mention), tagged with both its handoff id `#h-<id>` and the chain id `#c-<id>` plus `step 1/N`.
- **FR2 — Chain record.** A `ChainRecord` is created alongside step 1: id `c-<base36ts>-<hex4>`, source slug, steps, cursor, per-step fired handoff ids, state `active → done | halted | expired`. Persisted in `shared/handoffs.json` (registry file format upgraded, see NFR1).
- **FR3 — Auto-advance.** When a pending handoff belonging to an active chain closes as `done` — via `handoff_complete` OR the bot-reply auto-close path (`acknowledgeHandoffs`) — MCD evaluates the chain: gate check first, then either fires step cursor+1 (resolving `role`/`target` at fire time against current config) or marks the chain `done` when the closed step was last. Each advance posts progress to the source project's channel: `⛓ chain #c-<id>: <n>/<N> done → <next target>` (or `✅ chain #c-<id> complete`).
- **FR4 — Context carry.** A mid-chain step's delivery includes the prior step's outcome, truncated to 500 chars, in the envelope/mention body (standardized handoff context: `[chain #c-<id> step n/N from <slug>; prior outcome: "..."] <task>`).
- **FR5 — Approve gate.** A step with `gate: "approve"`: on close, if the outcome does not start with `approve` (case-insensitive, trimmed), the chain becomes `halted`, no next step fires, and master gets `⚠️ chain #c-<id> halted at step n/N (<role|target>): gate not approved — "<outcome ≤120>"`. No retry in v1 (proposal open question resolved: escalate immediately).
- **FR6 — Budgets.** At creation, chains longer than the hop budget are refused with an error (budget = source project's effective peers `maxHops`, built-in fallback 6). Chain expiry rides the existing per-step sweep: when the sweep escalates/expires a step's handoff, the owning chain becomes `expired` and the master escalation names the stalled step (`⚠️ chain #c-<id> expired at step n/N (<target>) — handoff #h-<id> unanswered`).
- **FR7 — Fire-time resolution failure.** If a mid-chain step's `role`/`target` no longer resolves when it should fire (renamed slug, changed allowlist, disabled target project), the chain becomes `halted` and master is notified naming the step and the resolution error. Never throws into the closing caller's path.
- **FR8 — `!project collab` chains.** The collab view lists open (active/halted) chains for the target project with per-step status glyphs (`✔` done, `▶` pending/current, `·` not fired, `✖` gate-failed) and age. Done/expired chains omitted (same spirit as pending-only handoff listing).
- **FR9 — Cooldown bypass.** Chain auto-advance fires immediately, ignoring bot-peer cooldown/turn budget for the *delivery* (registry-driven, not chatter — proposal open question resolved as proposed). The existing handoff-ack exemption already covers the closing direction.
- **FR10 — Docs.** `handoff` tool description documents `chain`; CLAUDE.md, README, docs/commands.md updated.

### Non-Functional Requirements

- **NFR1 — Registry format v2, backward-compatible read.** `shared/handoffs.json` becomes `{ version: 2, handoffs: HandoffRecord[], chains: ChainRecord[] }`. `loadRegistry()` accepts the legacy bare-array format (treated as `{ handoffs: arr, chains: [] }`); first save writes v2. Single file so a chain advance (close step + create next handoff + move cursor) is one atomic tmp+rename write — no cross-file consistency window.
- **NFR2 — Pure state machine.** Chain decisions (`nextChainAction(chain, closedRecord, outcome, nowMs)` → `advance | complete | halt-gate`) are pure functions in `src/handoffs.ts` with injectable clock, tested without filesystem or delivery machinery. Delivery side effects stay in `MasterMcpServer`.
- **NFR3 — Single-hop invariant.** With no `chain` arg, every existing code path, message format, registry record shape, and test outcome is unchanged. `HandoffRecord` gains only optional `chainId?`/`chainStep?` fields.
- **NFR4 — Idempotent transitions.** Re-processing a close for an already-advanced/closed chain is a no-op (cursor + state latch). Sweep re-runs never double-fire escalations (same latch discipline as `sweepHandoffs`).
- **NFR5 — Tests.** Chain state machine + format migration in the handoffs test suite; tool arg validation + advance wiring in `src/master-mcp-server.test.ts`; all plain bun PASS/FAIL scripts.

## Acceptance Criteria

- **AC1:** `handoff` with a 3-step chain fires step 1 immediately (envelope contains `#h-<id>`, `#c-<id>`, `step 1/3`), returns `{ ok, chain_id, id }`, and persists an `active` chain with cursor 0.
- **AC2:** `handoff_complete` on step 1's id fires step 2 to its resolved target with prior outcome (≤500 chars) in the body, and posts `⛓ chain … 1/3 done → …` to the source channel.
- **AC3:** A bot-peer reply containing step N's `#h-<id>` (the `acknowledgeHandoffs` path) advances the chain identically to AC2.
- **AC4:** Closing the final step marks the chain `done` and posts the completion line; no further handoff is created.
- **AC5:** A `gate: "approve"` step closed with outcome `"rejected: tests fail"` halts the chain, fires no next step, and escalates to master with the outcome excerpt; closed with `"Approved — LGTM"` advances normally.
- **AC6:** A chain whose length exceeds the effective hop budget is refused at creation with an explanatory error; no records are written.
- **AC7:** When the handoff sweep expires a chain step's handoff, the chain state becomes `expired` and the master escalation names chain id + step index + target.
- **AC8:** A mid-chain step whose role no longer resolves at fire time halts the chain + escalates; the completing session's tool call still returns ok (close succeeded).
- **AC9:** `!project collab <slug>` shows an active chain with per-step glyphs; single-hop output unchanged when no chains exist.
- **AC10:** Legacy bare-array `handoffs.json` loads cleanly; after the first v2 save, reload round-trips. Corrupt file still fail-opens empty.
- **AC11:** All existing suites pass unchanged; `bun tsc --noEmit` clean.

## Edge Cases

- `chain` with 1 step: allowed, behaves as a tracked single hop with chain progress/complete post (harmless degenerate).
- `chain` with 0 steps or >budget: refused at validation.
- Step targeting the source project itself: refused at creation (same rule as single-hop self-handoff).
- Chain step closed by master (`handoff_complete` from master session): advances the chain — closer identity doesn't matter, record ownership check already ran.
- Two pending chain-step ids acked in one bot message: each processed in order; second may belong to a different chain.
- Server restart between step close and advance: cannot happen — close+advance is one synchronous sequence ending in one registry save; a crash before save leaves the step pending (sweep will nag), never a half-advanced chain.
- Outcome empty on a gated step: fails the gate (empty ≠ approve).
- Target project disabled at fire time: FR7 halt path (matches single-hop `target project is disabled` refusal).

## Dependencies

- Builds directly on `src/handoffs.ts` registry (PR #318): `createHandoff`, `completeHandoff`, `acknowledgeHandoffs`, `sweepHandoffs`, atomic save/prune.
- `resolveCollabTarget` (`src/channels-config.ts:673`) for fire-time step resolution; `effectivePeerLimits` for hop budget.
- Delivery machinery in `MasterMcpServer` `handoff` case (`src/master-mcp-server.ts:630-708`) — refactored into a reusable helper, not duplicated.
- No new npm dependencies; no `channels.json` schema change in v1 (chain templates/`collab.workflows` explicitly out of scope).

## Notes

- Proposal's "chain-level timeout (default 2× per-handoff timeoutMinutes)" is simplified in v1: chain expiry derives from the *current step's* existing sweep expiry (each step already nags at `timeoutMinutes` and expires at 2×). A separate whole-chain clock added no protection beyond what per-step expiry gives and complicated the sweep; deviation recorded here deliberately.
- Chain pruning: closed chains follow the same prune policy as closed handoffs (30 days / 200 entries) to keep the registry bounded.
