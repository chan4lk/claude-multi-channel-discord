# Proposal: Bot-peer turn limit — exempt status posts

**Created:** 2026-07-18
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

`BotPeerGate` (`src/bot-peers.ts`) counts **every** inbound message from an allowlisted peer bot toward the consecutive-turn limit (default 5). In the finaudit-agents session on 2026-07-18, dHermes's automated progress ticks (`⏳ Still working... (N min elapsed — iteration X/90)`) consumed the budget, so `🚫 bot-peer turn limit (5) reached` fired twice **mid-coordination** — while the two bots were legitimately handing off work — stalling the dialogue until a human posted. The limit exists to stop infinite bot loops, but status chatter is not a loop signal: it carries no question or directive, and blocking on it punishes exactly the long-running work sessions where peer coordination matters most.

## Proposed Solution

_What are we building? High-level approach._

Classify inbound peer messages before counting:

- **Status/progress posts don't increment** the consecutive counter. Detection: configurable regex list on the `botPeers` block (`statusPatterns?: string[]`), with built-in defaults matching the observed shapes (`⏳ Still working`, `(no content)`/empty body, bare progress-tick lines). Status posts are also **not injected** into the project session (they're noise for the receiving Claude too) — or injected only when `progressMode` isn't off, TBD in spec.
- **Substantive messages count** as today.
- Optionally raise the built-in default `maxConsecutive` from 5 to 8 based on observed legitimate exchange lengths; per-channel override already exists (`--bot-peers` limits / `defaults.botPeers`).

## Scope

### In Scope
- `src/bot-peers.ts`: message classification + counter exemption
- `src/channels-config.ts`: optional `statusPatterns` on `botPeers` schema (project + defaults)
- `!project set` flag pass-through if trivial; otherwise config-file-only for v1
- `src/bot-peers.test.ts` coverage: status flood doesn't trip limit, substantive loop still does

### Out of Scope
- Changing the cooldown mechanism or human-reset behavior
- Semantic/LLM-based classification — regex only
- Fixing dHermes's spam at its source (external system; separate ask to its operator)

## Impact

- **Files affected:** 3 (estimated) — `src/bot-peers.ts`, `src/channels-config.ts`, `src/bot-peers.test.ts`
- **Complexity:** small
- **Risk:** low-medium — a too-broad pattern could exempt real messages and re-open loop risk; mitigate with anchored defaults and per-channel opt-out (`statusPatterns: []`)

## Open Questions

- Should exempted status posts still reset the cooldown clock, or be fully invisible to the gate?
- Drop status posts entirely (no injection) or inject with a `[status]` marker so the receiving Claude has context but is told not to reply?

---

**To proceed:** Review this proposal and approve to begin planning.
