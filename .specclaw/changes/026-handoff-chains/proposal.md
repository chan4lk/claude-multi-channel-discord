# Proposal: Handoff chains (work-graph layer)

**Created:** 2026-07-28
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The collab handoff registry (PR #318) tracks single hops only: A→B, `pending → done | expired`. Real cross-agent workflows are multi-step — build→review→merge, research→draft→verify — and today each agent must *remember* to fire the next handoff after closing theirs. The chain can die silently at every link, which is exactly the failure class handoffs were built to kill (finaudit's "reviewer reviews each PR" agreement died silently as a free-text norm; a single tracked hop only fixes the first link).

2026 graph-engineering practice names this gap directly: production multi-agent systems need a deterministic work-graph skeleton with bounded loops inside nodes — edges that aren't explicit aren't modeled, and unmodeled edges are where workflows rot. MCD already has the bounded loops (turn limits, maxHops, cooldowns, watchdog, autopilot stall thresholds) and long-lived org nodes (projects, bot peers). What's missing is the explicit multi-step work edge.

## Proposed Solution

_What are we building? High-level approach._

Extend the handoff registry into a chain state machine — a pure registry extension, no new process model:

- `mcp__mcd__handoff` gains an optional `chain` arg: an ordered list of steps `[{ role?: string, target?: string, task: string, gate?: "approve" }]`. Step 1 fires immediately as a normal handoff tagged `#h-<id>` plus a chain id `#c-<id>` (step 1/N shown in the envelope).
- When step N is closed (`handoff_complete` or bot-reply auto-close), MCD auto-fires step N+1 to its resolved node and posts chain progress to the source channel (`⛓ chain #c-x: 2/3 → reviewer`). Chain state lives in `shared/handoffs.json`, so chains survive agent restarts and session evictions.
- **Verify gates:** a step with `gate: "approve"` halts the chain unless its completion outcome starts with `approve`; otherwise the chain stops and escalates to master (council-lite verification node).
- **Budgets:** chain-level hop budget (default = peers `maxHops` fallback 6) and chain-level timeout (default 2× the per-handoff `timeoutMinutes`); exceeded ⇒ chain marked `expired`, master escalation names the stalled step. Reuses the existing 5-min scheduler sweep.
- `!project collab <slug>` shows open chains with per-step status alongside single handoffs.

## Scope

### In Scope
- `src/handoffs.ts`: chain records (`ChainRecord`), step state machine (`nextChainAction`), auto-advance on close, gate evaluation
- `src/master-mcp-server.ts`: `chain` arg on `handoff` tool; auto-advance wiring on `handoff_complete` and bot-reply auto-close paths
- `src/scheduler.ts`: chain timeout/budget in the existing handoff sweep
- `src/master-commands.ts`: chain rows in `!project collab`
- Docs: CLAUDE.md, README, docs/commands.md; tests for the chain state machine

### Out of Scope
- Branching/parallel chains (DAG fan-out) — linear chains only in v1
- Chain templates / named reusable workflows (possible follow-up: `collab.workflows`)
- Cross-chain dependencies, conditional routing on outcome content (beyond the approve gate)
- Any UI beyond `!project collab` text output

## Impact

- **Files affected:** ~6 (estimated)
- **Complexity:** medium
- **Risk:** low — pure extension of shared/handoffs.json + existing sweep; single-hop handoffs unchanged; chains only exist when the `chain` arg is used

## Open Questions

- Should a failed gate allow one retry (re-fire the same step) before escalating, or escalate immediately? (proposed: escalate immediately, keep v1 simple)
- Should chain auto-advance respect the target's bot-peer cooldown, or fire immediately? (proposed: fire immediately — registry-driven, not chatter)
- Envelope format for mid-chain steps: include prior step's outcome text as context? (proposed: yes, truncated to ~500 chars — graph-engineering handoff-protocol norm: standardize what B receives from A)

---

**To proceed:** Review this proposal and approve to begin planning.
