# Proposal: Schedule Auto-Pause on Reply Pattern (stopOnReply)

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

Interval schedules keep firing long after their goal is met. Historical evidence from `schedules.json`:

- keyflow backlog loop `s_mqlo8z2b_2dle4f`: **74 runs** at every-45m, many after the backlog was empty
- claude-mcd loop `s_mqmdkei1_m4wsqa`: **200 runs**
- agent-nexus loop `s_mqwfvtem_unfrwt`: **107 runs**

Each post-completion fire spins up a Claude turn that reads the backlog, finds nothing, and replies "backlog complete" — pure token burn, forever, until the operator notices and manually pauses. Several schedule prompts even instruct the agent to "pause this schedule" — asking the model to do what the scheduler should do deterministically. `maxRuns` exists (`src/schedules-config.ts:51`) but caps count, not goal state.

## Proposed Solution

Add optional `stopOnReply: string` (regex, case-insensitive) to the schedule schema. After a fire, the scheduler watches the project's next outbound `mcp__mcd__reply` for that schedule's channel (within a bounded window, e.g. until the turn ends or 30 min). If the reply text matches, set `enabled: false`, persist, and post a one-line notice to the master channel: `⏸ schedule <id> (<slug>) auto-paused — reply matched /<pattern>/`.

Wiring: the pool already routes replies through `MasterMcpServer` → `server.ts`; add a lightweight `onReply(chatId, text)` tap that the scheduler subscribes to for schedules with `stopOnReply` and a recent fire.

CLI: `!project schedule add ... --stop-on-reply "backlog complete"`.

## Scope

### In Scope
- `src/schedules-config.ts`: `stopOnReply` field (validated as compilable regex)
- Reply tap: `server.ts` / `src/master-mcp-server.ts` → scheduler notification path
- `src/scheduler.ts`: match → disable → persist → master notice
- `src/master-commands.ts`: `--stop-on-reply` flag; `schedule list` shows the pattern
- Tests: match/no-match, window expiry, invalid regex rejected at add time

### Out of Scope
- Matching on transcript content (reply text only — the loop's contract already ends with a distinctive reply)
- Auto-resume conditions
- Retroactively adding patterns to existing schedules

## Impact

- **Files affected:** 5 (estimated)
- **Complexity:** medium
- **Risk:** low — opt-in; worst case is a missed match (status quo)

## Open Questions

- Window semantics: match only the first reply after the fire, or any reply until the next fire? Proposal: any reply until next fire, simplest and safest.

---

**To proceed:** Review this proposal and approve to begin planning.
