# Proposal: Org-graph view (`!project graph`)

**Created:** 2026-07-28
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

MCD's agent organization is already a graph — projects and bot peers are long-lived nodes; `peers.allow`, `botPeers.allow`, `collab.roles`, schedules, and autopilot are edges and self-loops — but the topology exists only as scattered `channels.json` entries. The operator has no way to see at a glance who can reach whom, which reach grants exist (`handoff`, `hermes`, peers), which edges are stale (roles pointing at renamed/deleted slugs, allowlisted bot ids no longer in the channel), or where the traffic actually flows (open handoffs, turn-budget burns, throttled notices).

2026 graph-engineering practice treats org-graph observability as a first-class requirement: track which nodes ran, what edges carried, and where budgets burn — an unobserved graph degrades silently. MCD already surfaces per-node health (`usage`, `heartbeat`, backlog watch) but nothing edge-level.

## Proposed Solution

_What are we building? High-level approach._

A read-only `!project graph` master verb (plus `mcp__mcd__run_master_command` reach) that renders the current org graph:

- **Nodes:** master + every project (slug, platform icon, ⛔ disabled, 🤖 autopilot, warm/cold session state from the pool)
- **Edges:** `peers` (bidirectional-consent marked), `botPeers.allow` (external bot ids), `collab.roles` (labelled with role name, `(stale)` when unresolvable — reuses the existing stale-detection), `hermes` grants, scheduler jobs (self-loops with cadence)
- **Traffic overlay** (`--stats`): open handoffs per edge (from `shared/handoffs.json`), bot-peer turn-budget/cooldown state (from `BotPeerGate`), last-activity age per node (transcript mtime, same source as heartbeat/auto-disable)
- **Output:** Discord-friendly — a compact text adjacency view by default; `--mermaid` emits a fenced Mermaid `graph LR` block (renders natively in GitHub, pasteable anywhere)

Pure read path: assembles from `channels.json`, the pool, the handoff registry, and transcript mtimes. No config writes, no new state files.

## Scope

### In Scope
- `src/master-commands.ts`: `graph` verb (`--stats`, `--mermaid` flags), help text
- Small pure builder module (e.g. `src/org-graph.ts`): config+registry → node/edge model → text / mermaid renderers, unit-tested
- `server.ts`: wire pool/session-state accessor into the builder deps
- Docs: README, docs/commands.md, CLAUDE.md verb list

### Out of Scope
- Any mutation via the graph view (no edge editing)
- Image rendering (Mermaid text only — no headless-browser PNG)
- Historical/time-series edge stats (point-in-time snapshot only)
- Per-message tracing or token accounting per edge

## Impact

- **Files affected:** ~5 (estimated)
- **Complexity:** small–medium
- **Risk:** low — read-only; worst case is a long message (chunker already handles 2000-char splits)

## Open Questions

- Should disabled projects and their edges be hidden by default (`--all` to include) or always shown with ⛔? (proposed: always show with ⛔ — hidden nodes are how graphs rot)
- Include WhatsApp/Teams nodes' JID/tenant details or just platform icon? (proposed: icon only — no PII in a shareable graph)
- Should `graph --stats` also flag *missing* expected edges, e.g. a collab role configured but `handoff` flag off (dead edge)? (proposed: yes — one ⚠ line per dead edge; cheap and catches the finaudit wiring gap class)

---

**To proceed:** Review this proposal and approve to begin planning.
