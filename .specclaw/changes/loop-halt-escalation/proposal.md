# Proposal: Loop Guardrail-Halt Escalation to Master

**Created:** 2026-07-12
**Status:** ✅ Approved

## Problem

When the specclaw loop controller halts on a guardrail (verify red N times, review blocked, task budget exhausted), the channel simply goes idle. The next scheduled tick then re-fires `/specclaw:loop` blindly into the same blocked state, producing a thrash cycle: halt → 30m wait → re-attempt → same halt. The operator learns nothing unless they read the channel; the master heartbeat reports the channel as healthy-idle because nothing is *stuck* in the process sense — the watchdog and stall detection (`stalledSince`, mcd-reliability-fixes Fix 4) only see process/transcript liveness, not lifecycle failure.

## Proposed Solution

Detect a specclaw halt on disk and escalate once:

1. Extend the specclaw status parser (see `specclaw-status-visibility`) to recognize blocked state: any phase row `🔴`/`❌` in the active change's `status.md`, or a `## Issues` section with content, or N consecutive failed tasks in `.specclaw/STATUS.md` (`| X failed` where X > 0 and unchanged across two checks).
2. In the master heartbeat scan (`src/heartbeat.ts`), when a channel with an enabled specclaw-loop schedule shows blocked state, post to the master channel: `🛑 dstm-apps: specclaw loop halted on <change> — verify failed 3×. Schedule s_xxx suspended pending operator.` and set that schedule `enabled: false`.
3. Store `escalatedAt` on the schedule so the same halt never escalates twice; operator re-enabling the schedule (`schedule resume`) clears it.

This combines with `stopOnReply` (goal completion) and `onlyWhenIdle` (mid-turn collision): together they close the three ways a blind timer misbehaves.

## Scope

### In Scope
- Blocked-state detection in the specclaw status parser
- `src/heartbeat.ts`: escalation check + master post + schedule suspend
- `src/schedules-config.ts`: `escalatedAt` bookkeeping field
- Tests: fixture status files for halted/healthy, single-escalation invariant

### Out of Scope
- Auto-remediation (retry with different model, auto-revert) — operator decides
- Escalation for non-specclaw channels (covered by existing stall detection)

## Impact

- **Files affected:** 4 (estimated)
- **Complexity:** medium
- **Risk:** medium — false-positive halt detection would pause a healthy loop; mitigate with conservative markers (explicit 🔴/failed-count only) and the operator notice always naming the evidence

## Open Questions

- Depends on `specclaw-status-visibility` parser — build order: that change first.
- Should escalation also fire when the loop makes no BACKLOG.md progress across M fires? Deferred — needs progress fingerprinting.

---

**To proceed:** Review this proposal and approve to begin planning.
