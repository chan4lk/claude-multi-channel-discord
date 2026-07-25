# Verify Report: backlog-stall-watch

**Date:** 2026-07-25
**Verdict:** PASS

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | PASS | `src/backlog.test.ts` watch-51 through watch-60c (30 checks): init (watch-51/52), delta-done (watch-53), delta-total (watch-54), below-threshold none (watch-55/55b), past-threshold alert (watch-56/56b/56c/56d), throttle inside window (watch-57), re-alert after window (watch-58), zero-open never alerts (watch-59), staleBacklogDays=0 clamps to 3 (watch-60/60b/60c). `evaluateBacklogWatch` at `src/backlog.ts:178–213`. All 81 checks pass. |
| AC2 | PASS | `listOpenItems` at `src/backlog.ts:225–260`. Tests watch-61 (file source: unchecked texts trimmed, checked excluded), watch-62 (missing file → []), watch-63 (specclaw: not-done names; done+archive excluded), watch-64 (missing changes dir → []), watch-65/65b/65c (12 open → 10 entries + `(+2 more)` suffix), watch-66 (source=none → []). All pass. |
| AC3 | PASS | `runBacklogWatchSweep` at `src/scheduler.ts:669–739`. Tests BW-1 (master skipped), BW-2 (autopilot.enabled skipped), BW-3 (project backlogWatch.enabled=false skipped), BW-4 (defaults.backlogWatch.enabled=false skipped), BW-5 (source none skipped). All pass with zero saves and zero alerts. |
| AC4 | PASS | BW-6 lifecycle test (`src/scheduler.test.ts:1252–1313`): init persists lastSnapshot+lastDeltaAt (no alert); stale alert fires with correct slug/openCount/staleDays/openItems and lastAlertAt persisted; immediate re-sweep throttled; delta clears latch (lastAlertAt key deleted via the `undefined`-delete loop at `src/scheduler.ts:716–717`). Read-merge-write at `src/scheduler.ts:712–725` re-reads latest config before patching. All 16 BW-6 checks pass. |
| AC5 | PASS | `server.ts:1632–1646`: `scheduler.registerBacklogWatchSweep` wired with `onAlert` that reads master chatId, builds `📋 **<slug>**: backlog stalled — X open item(s), no movement for N+ day(s)` + bullet items + hint, dispatched via `routeNotification(cfg, {kind:'text', chatId: masterChatId, text}, 'backlog-watch alert')` — same pattern as autopilot escalation. Format matches FR4. |
| AC6 | PASS | All 8 suites clean: backlog 81/81, scheduler all (incl. BW-1..BW-6, 16 new), project-pool, master-commands, master-mcp-server, bot-peers, shared-learnings all passed. `bun tsc --noEmit` clean. |

## Test Results

```
backlog.test.ts:           81/81 PASS (incl. watch-51..watch-66)
scheduler.test.ts:         all PASS (incl. BW-1..BW-6)
project-pool.test.ts:      all PASS
master-commands.test.ts:   all PASS
master-mcp-server.test.ts: all PASS
bot-peers.test.ts:         all PASS
shared-learnings.test.ts:  all PASS
bun tsc --noEmit:          clean
```

## Edge Cases

| Edge Case | Verified How |
|-----------|-------------|
| Server restart wipes nothing | Runtime lives on `project.backlogWatch` in `channels.json` via `saveChannels`; no in-memory-only state. |
| First sweep on long-stale backlog | `init` sets `lastDeltaAt = now`; alert only after full observed window (BW-6 sweep-1). |
| Backlog completes while stale | `openCount > 0` gate (`src/backlog.ts:209`); watch-59. |
| Project dir missing/unreadable | `detectBacklogSource` → `'none'` on fs error; sweep skips (`src/scheduler.ts:697`); BW-5. |
| `staleBacklogDays < 1` | Clamped to 3 (`src/backlog.ts:188`); watch-60/60b/60c. |
| Delta clears alert latch | Explicit `lastAlertAt: undefined` patch key deleted in merge (`src/scheduler.ts:717`); BW-6 hasOwnProperty check. |
| Re-alert after window | watch-58. |
| `onAlert` optional | `opts.onAlert?.()` — no crash when unwired. |

## Notes

- Alert hint text uses `backlogWatch.enabled: false` rather than the spec's example `set <slug> --backlog-watch off` — spec marks hint text as non-normative ("hint text only"), within bounds.
- `BacklogWatchSchema` / `DefaultsBacklogWatchSchema` use `.strict()` — no unrecognized runtime keys can enter `channels.json`.
- FR6 satisfied: autopilot code and tests untouched; all new code additive.
