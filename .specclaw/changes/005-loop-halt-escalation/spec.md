# Spec: Loop Guardrail-Halt Escalation to Master

**Change:** loop-halt-escalation
**Created:** 2026-07-12

## Functional Requirements

- **FR1 — Halt detection.** New `detectSpecclawHalt(projectCwd)` in `src/specclaw-status.ts` returns `{ halted, change?, evidence? }`. A project is halted only when it has an active change AND at least one signal:
  - S1: dashboard active-change line reports ≥1 failed task (`| N failed`)
  - S2: a Progress-table row in the change's `status.md` contains 🔴 or ❌
  - S3: the change's `status.md` has a non-empty `## Issues` section (any line other than a `_None._`-style placeholder)
  Missing `.specclaw/`, missing `STATUS.md`, no active change, or unreadable change `status.md` → `halted: false` (fail-open, never throws).
- **FR2 — Evidence marker.** Each signal yields a short evidence string: S1 `"<N> failed task(s)"`, S2 `"phase <name> <emoji>"`, S3 `"open issue: <first line, truncated>"`.
- **FR3 — Escalation gate.** Scheduler tick: for a due, enabled schedule whose target chat is halted (via new optional dep `checkHalt`), do not fire. If `escalatedAt` is unset: set `escalatedAt = now`, set `enabled = false`, persist, call new optional dep `onEscalate(schedule, change, evidence)`. If `escalatedAt` is already set: skip silently (no post, no fire).
- **FR4 — Master notice.** server.ts wires `onEscalate` to post `🛑 **<slug>**: specclaw loop halted on **<change>** — <evidence>. schedule **<id>** suspended; \`schedule resume <id>\` after fixing.` to the master channel via `routeNotification`.
- **FR5 — Resume clears.** `schedule resume <id>` sets `escalatedAt = null` alongside `enabled = true`, so a genuinely-fixed loop can escalate again if it halts anew.
- **FR6 — Schema.** `escalatedAt: string | null` optional field on `ScheduleSchema`; legacy files parse unchanged.
- **FR7 — List marker.** `schedule list` shows `🛑 escalated` on suspended-by-escalation rows.
- **FR8 — Fail-open.** Absent `checkHalt` dep → schedules fire exactly as before (no behavior change for tests/embedders that don't wire it).

## Acceptance Criteria

- AC1: Blocked fixture → one `onEscalate` call + schedule `enabled:false` + `escalatedAt` set, persisted; healthy fixture → fires normally, no escalation
- AC2: Second tick on same halt (re-enabled with `escalatedAt` intact) → no second `onEscalate`, no fire
- AC3: `schedule resume` clears `escalatedAt`
- AC4: Escalation message names change + evidence (verified via wired notice format / onEscalate args)
- AC5: Detection fixture tests (S1/S2/S3 + healthy + missing-files) and single-escalation invariant; `bun tsc --noEmit` clean

## Out of Scope

- Auto-resume when the halt clears (operator decision by design)
- Escalation for projects without schedules (heartbeat-only channels)
- Cron-expression schedules beyond existing support
