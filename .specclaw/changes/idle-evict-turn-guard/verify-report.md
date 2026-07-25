# Verify Report: idle-evict-turn-guard

**Date:** 2026-07-25
**Verdict:** PASS

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1: Transcript records `turn_duration` after deliver ⇒ `pendingDeliverAtMs()` null on next read; watchdog never fires; duration lands in `turnHistory`. | PASS | `noteTurnComplete` at `claude-process.ts:1246–1253`: checks `_pendingDeliverAt !== null`, pushes `duration` into `turnHistory`, sets `_pendingDeliverAt = null`, bumps `_lastActivity`. Mirror in `MockProjectProcess.completeTurn` at `project-process.ts:186–193`. Test 24 (`project-pool.test.ts:829–878`) confirms all three observables: `pendingDeliverAtMs() === null` after `completeTurn`, `adaptiveThresholdMs(base) === 30*60_000` (turnHistory fed), no `stuck` event after sweeping 31 min past adaptive cap. |
| AC2: AC1 holds with zero tool-progress/limit subscribers (progressMode off). | PASS | Early-return condition at `claude-process.ts:1134`: `if (this.toolProgressHandlers.size === 0 && this.limitHitHandlers.size === 0 && this._pendingDeliverAt === null) return` — the `_pendingDeliverAt === null` clause means the watcher continues to parse when a deliver is pending even with zero handlers. Test 24 comment at line 832–835 documents this code-review verification path. |
| AC3: Idle process with transcript mtime inside window ⇒ no kill; `evict-skip` event with `sinceActivityMs` and `sinceTranscriptMs`. | PASS | `project-pool.ts:426–448`: when `proc.lastActivityMs() < idleCutoff` and `transcriptMtime >= idleCutoff`, fires `evict-skip` event with both fields and `continue`s (no kill). Test 25 (`project-pool.test.ts:880–922`): 90s idle (past 1-min window), transcript 30s ago; checks `pool.has()`, no `evict` event, `evict-skip` with `sinceActivityMs===90_000` and `sinceTranscriptMs===30_000`. All 4 checks PASS. |
| AC4: Same idle process with transcript mtime outside window (or null/method absent) ⇒ `evict` event + kill. | PASS | Pool code path at `project-pool.ts:449–451`: `fireEvent({kind:'evict', reason:'idle-evict'})` + `proc.kill('idle-evict')` when mtime is null or older than cutoff. Test 26 sub-case 1 (`project-pool.test.ts:926–958`): stale transcript kills with idle-evict event + `killReasons.includes('idle-evict')`. Test 26 sub-case 2 (lines 959–991): null transcript kills with idle-evict event and no evict-skip. All 6 checks PASS. |
| AC5: Pending deliver + no turn-completion + stale transcript past threshold ⇒ `stuck` event + watchdog kill. | PASS | Stuck-watchdog branch at `project-pool.ts:371–422`: AND-gate requires stale/null `transcriptMtimeMs()`; fires `stuck` event + `proc.kill('watchdog')`. Test 27 (`project-pool.test.ts:994–1027`): hangs=true, transcript set 7 min stale, 6-min advance past 5-min threshold; `pool.has()` false, `stuck` event fires, `killReasons.includes('watchdog')`. All 3 checks PASS. |
| AC6: All suites pass + `bun tsc --noEmit`. | PASS | `project-pool.test.ts` — 80 checks all PASS (tests 1–27); `master-commands.test.ts` — all PASS; `master-mcp-server.test.ts` — all PASS; `bot-peers.test.ts` — all PASS; `shared-learnings.test.ts` — all PASS; `backlog.test.ts` — 50 checks PASS; `scheduler.test.ts` — all PASS. `bun tsc --noEmit` — zero output (clean). |

## Test Results

```
project-pool.test.ts:      80/80 PASS (tests 1–27, including new 24–27)
master-commands.test.ts:   all PASS
master-mcp-server.test.ts: all PASS
bot-peers.test.ts:         all PASS
shared-learnings.test.ts:  all PASS
backlog.test.ts:           50/50 PASS
scheduler.test.ts:         all PASS
bun tsc --noEmit:          clean (no output)
```

## Edge Cases

| Edge Case | Verified How |
|-----------|-------------|
| Resumed-transcript replay protection (offset seek on path change) | `claude-process.ts:1138–1144`: when `path !== this.transcriptWatcherPath`, sets `transcriptWatcherOffset = currentSize` (seeks to EOF) before processing. Historical lines from a `--resume` session are never parsed. |
| `acceptReply` and `noteTurnComplete` racing (double-clear harmlessness) | Both paths guard on `_pendingDeliverAt` null before pushing to `turnHistory`; second caller is a no-op. `acceptReply` at `claude-process.ts:1227–1236`; `noteTurnComplete` at `1246–1253`. |
| Multiple deliver→turn cycles in one poll window | Each `turn_duration` line clears the flag; subsequent `deliver()` (`claude-process.ts:707`) re-arms only when null. Ordering follows transcript append order. |
| Session continuously writing transcript never idle-evicts | Accepted by spec (watchdog owns stuck-but-writing); `evict-skip` fires each sweep; `!project stop` / LRU still available. |

## Notes

- AC2's code-path is not directly exercisable through the pool+mock harness (transcript watcher is `ClaudeProjectProcess`-internal). Test 24 verifies the observable outcome via `MockProjectProcess.completeTurn`; the conditional at `claude-process.ts:1134` is verified by code review, documented in the test file at lines 832–835.
- `MockProjectProcess.completeTurn` mirrors `noteTurnComplete` faithfully including the MAX_TURN_HISTORY cap.
- NFR1 satisfied: no schema/config changes. NFR3 satisfied: mock gained hooks without constructor changes.
