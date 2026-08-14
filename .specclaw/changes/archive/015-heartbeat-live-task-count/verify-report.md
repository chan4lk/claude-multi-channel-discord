# Verification Report: heartbeat-live-task-count

**Verified:** 2026-07-18
**Verdict:** PASS

- ✅ AC1: stale dashboard 0/14 + tasks.md 2/3 → readSpecclawStatus returns 2/3 — test "live-count: tasks.md overrides stale dashboard" PASS
- ✅ AC2: tasks.md absent → dashboard counts 4/9 unchanged — test "live-count fallback" PASS
- ✅ AC3: done===total>0 → resume block instructs /specclaw:verify, forbids build re-run, drops continue-via-build line — 4 "resume complete" tests PASS
- ✅ AC4: heartbeat specclaw-idle reworded on complete counts — heartbeat AC4c tests PASS
- ✅ AC5: `bun tsc --noEmit` clean; specclaw-status, heartbeat, backlog, master-commands, specclaw-progress, scheduler suites all green

Fix applied at the single source (`readSpecclawStatus`, src/specclaw-status.ts) so heartbeat, rotation resume brief, and `!project show` all get live counts; countCheckboxes reused from src/backlog.ts.

**Verdict:** PASS (5/5)
