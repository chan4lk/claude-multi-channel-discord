# Verify Report: heartbeat-attention-report

**Date:** 2026-07-12
**Verdict:** 🟢 PASS

## Gates

| Command | Result | Checks |
|---------|--------|--------|
| `bun src/heartbeat.test.ts` | ✅ All checks PASSED | 37 |
| `bun src/master-commands.test.ts` | ✅ all checks passed | includes AC5/AC6/help-text checks |
| `bun src/project-pool.test.ts` | ✅ all checks passed | 23 |
| `bun src/master-mcp-server.test.ts` | ✅ all checks passed | 11 |
| `bun tsc --noEmit` | ✅ clean (no output) | — |

## Acceptance Criteria

- ✅ **AC1:** Unanswered question ≥ staleAfterMinutes → 🔴 item with `detail` > 80 chars — `heartbeat.test.ts` "AC1: detail length > 80" PASS; `heartbeat.ts:272` stores `text.replace(/\n+/g, ' ').slice(0, 300)` in `detail`.
- ✅ **AC2:** schedule-noop-loop: 5 trailing scheduler msgs → 🟡 item; 4 → none; disabled → none; operator msg resets count — `heartbeat.test.ts` AC2a–AC2d PASS; `heartbeat.ts:379` gates `trailingSchedulerMsgs >= 5`.
- ✅ **AC3:** circuitOpen → 🔴 `circuit-open` item; absent dep → no item, no throw — AC3a/AC3b PASS; `heartbeat.ts:361-373`.
- ✅ **AC4:** Active specclaw change + stale transcript → 🔵 `specclaw-idle`; fresh → none — AC4a/AC4b PASS; `heartbeat.ts:393-419`.
- ✅ **AC5:** `--quiet` + zero items → exactly `HEARTBEAT_OK`; with items → full report — `master-commands.ts:1779`.
- ✅ **AC6:** Sort 🔴→🟡→🔵; 15-cap `(+N more)`; zero-item non-quiet `✅ all quiet — N channels scanned` — `heartbeat.ts:427-432`, `master-commands.ts:1788-1799`.
- ✅ **AC7:** All four suites pass + tsc clean.

## Notes

- **FR10:** `templates/master.CLAUDE.md:229` has the exact HEARTBEAT_OK suppression instruction.
- **NFR1:** heartbeat.ts read-only (readdirSync/readFileSync/realpathSync/statSync only).
- **FR9:** both MasterContext sites wired (`server.ts:1248`, `server.ts:2002`).
- **FR8:** `--channel` filters items + scannedCount; `--quiet` applies to filtered result.
- No deviations. Operator must restart MC + update the heartbeat schedule prompt to `heartbeat --quiet` to activate suppression.

## Commits

- `e1f3601` T1 — detail field + scanOne + AttentionItem/buildAttentionReport detectors
- `e9f0a51` T2 — detector test matrix (37 checks)
- `585b631` T3 — attention-report rendering + --quiet sentinel + circuit-state wiring
- `72db7b7` T4 — docs — attention report + HEARTBEAT_OK contract
- `fddfcff` merge to local main
