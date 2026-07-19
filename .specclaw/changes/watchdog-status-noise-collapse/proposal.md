# Proposal: Watchdog status noise collapse

**Created:** 2026-07-18
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

During long Claude turns, the stuck-watchdog fires a `progress-skip` event on every poll cycle where the transcript is advancing but no `reply` has landed. `server.ts:1381-1388` posts each of these as a **new** Discord message (`⏳ still working (transcript active, N min since last reply)`). In the finaudit-agents bot-peer session on 2026-07-18, this produced ~15 near-identical posts in one afternoon (plus 4 teardown warnings), drowning out substantive bot-to-bot dialogue — roughly 60% of the channel was watchdog noise. In shared channels this noise also burns the peer bot's attention (dHermes reads and reacts to channel traffic).

## Proposed Solution

_What are we building? High-level approach._

Reuse the existing edit-in-place pattern (progressMode `edit`, `editProgressState` in `server.ts`): the **first** `progress-skip` in a stuck episode posts one status message; subsequent `progress-skip` events for the same episode **edit** that message in place (updating the elapsed-minutes line). An episode ends when the turn completes (reply lands), the process is killed, or the watchdog resets — the next episode starts a fresh message.

- `src/project-pool.ts` / `src/claude-process.ts`: carry a stable episode identifier (e.g. turn start timestamp) on the `progress-skip` event payload.
- `server.ts`: keep a `Map<chatId, { episodeId, msgId }>`; post on first event, edit on repeats, clear on `stuck-kill` / reply / episode change.
- Teardown (`agent stopped responding`) and respawn warnings remain separate new posts — those are actionable state changes, not progress ticks.

## Scope

### In Scope
- `progress-skip` event payload extension (episode id)
- Edit-in-place dispatch in `server.ts` for progress-skip notifications
- State cleanup on kill/teardown/reply
- Tests covering post-then-edit sequence and episode rollover

### Out of Scope
- Watchdog thresholds, AND-gate, or kill logic changes
- The peer bot's (dHermes) own "Still working..." spam — external system
- Teams/WhatsApp edit parity beyond what `edit_message` routing already supports

## Impact

- **Files affected:** 3-4 (estimated) — `server.ts`, `src/project-pool.ts`, `src/claude-process.ts`, tests
- **Complexity:** small
- **Risk:** low — display-only change; worst case falls back to posting new messages when edit fails (same as progressMode `edit` fallback)

## Open Questions

- Should the collapsed status message be deleted (not just stop updating) when the turn completes cleanly, to leave zero residue?
- Teams `edit` support already exists for progress mode — reuse the same routing for parity, or Discord-only first?

---

**To proceed:** Review this proposal and approve to begin planning.
