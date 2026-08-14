# Proposal: MCD Reliability Fixes

**Created:** 2026-07-08
**Status:** ✅ Approved

## Problem

Four distinct failure modes were observed in the agent-nexus channel over Jul 6–8, causing 36 watchdog kills and a 16-hour silent failure loop the operator had no visibility into:

1. **Silent infinite respawn loop:** When `.session-id` is missing and fresh sessions consistently fail to make any tool calls, MCD killed and respawned the agent 15 times over 16 hours with zero operator notification. Each cycle consumed a tmux session + Claude process for 15 minutes. The operator only discovered this by returning and manually sending a message.

2. **Session UUID not captured at watchdog-kill time:** `.session-id` was missing for agent-nexus because UUID capture happens after `waitForTuiReady`, but watchdog kills can happen before that completes. Every subsequent respawn was a cold start, making the stall-loop worse.

3. **Nonsensical heartbeat auto-inject messages:** `buildInjectionMessage` in `behaviour-mirror.ts` pads heartbeats with random words sampled from short operator messages ("approved", "done?"), producing messages like *"Keep making progress. Stay left, left."* This appeared 20+ times in Jul 7 sessions, wasting context tokens and injecting noise.

4. **PR-wait polling with no backoff or operator escalation:** The session spent 20+ hours in a tight 15-minute ScheduleWakeup loop polling ADO PRs for reviewer assignment. No exponential backoff, no master-channel notification that the channel was in a holding pattern. The operator had no way to know without reading Discord manually.

## Proposed Solution

Four targeted fixes:

**Fix 1 — Kill-loop detector with master alert (`src/project-pool.ts`)**
Track consecutive watchdog kills per `chatId` where `lastToolCall` is null. After 3 consecutive such kills within a sliding 2-hour window, pause auto-respawn for that channel and post a message to the master channel: *"⚠️ agent-nexus killed 3× in a row with no tool calls — auto-respawn paused. Operator action needed."*

**Fix 2 — UUID capture at kill time (`src/claude-process.ts`)**
When `kill('watchdog')` fires, snapshot the transcript directory before tearing down the tmux session and attempt to capture the session UUID. Write it to `.session-id` if found. Currently this only happens in the happy path after `waitForTuiReady`. Capturing at kill time ensures `--resume` is possible on the next spawn even if the session was killed mid-ready.

**Fix 3 — Heartbeat suffix guard (`src/behaviour-mirror.ts`)**
In `buildInjectionMessage`, skip the `Stay X, Y` random-vocab suffix when the `contextSummary` string is shorter than 20 characters. Just emit `"Keep making progress."` Plain baseline is cleaner than mangled noise.

**Fix 4 — Stall detection in master heartbeat (`src/heartbeat.ts` + master schedule)**
Add a `stalledSince` timestamp to per-channel state. When master heartbeat scans active channels, check if any channel has been in a ScheduleWakeup loop (repeated wakeups with no user message delivered) for > 2 hours. If so, post a stall alert to the master channel: *"📌 agent-nexus has been in a holding pattern for 3h — may need operator direction."*

## Scope

### In Scope
- `src/project-pool.ts`: consecutive-kill counter + respawn pause + master alert
- `src/claude-process.ts`: UUID snapshot at watchdog-kill path
- `src/behaviour-mirror.ts`: heartbeat suffix guard
- `src/heartbeat.ts` (or equivalent master-schedule logic): stall detection + master alert
- Tests for kill-loop detector logic

### Out of Scope
- Exponential backoff in ScheduleWakeup (agent behavior, not MCD)
- PR-polling backoff documentation in agent-nexus CLAUDE.md (separate concern)
- Podman deploy workaround (agent-nexus project config)
- WhatsApp or Teams-specific changes

## Impact

- **Files affected:** 3–4
- **Complexity:** medium
- **Risk:** low — all changes are additive or guard-only; no existing behavior removed

## Decisions

1. **Kill-loop pause:** Permanent — operator must run `!project start <slug>` to resume. Alert includes this hint.
2. **Stall heuristic:** Stall = 3+ consecutive `ScheduleWakeup` calls with no `mcp__mcd__reply` between them AND no user message delivered in 2h. Legitimate long turns (parallel subagents) advance the transcript rapidly and always eventually produce a `reply`.
3. **Master alert:** Yes, include `!project start <slug>` hint in kill-loop alert.

---

**Status:** Approved — proceeding to plan.
