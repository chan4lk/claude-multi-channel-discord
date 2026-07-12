# Design: Loop Guardrail-Halt Escalation to Master

**Change:** loop-halt-escalation

## Approach

Detection lives next to the P303 parser (`src/specclaw-status.ts`) and reuses `readSpecclawStatus` for the active change + failed count, then re-reads the change's `status.md` for 🔴/❌ rows and Issues. Escalation lives in the Scheduler tick — the component that owns the thrash — as a gate between `isDue` and the idle-gate, mirroring the P302/P304 optional-dep pattern (`isBusy`/`onAutoPause` → `checkHalt`/`onEscalate`). State (`escalatedAt`) persists on the schedule record itself so restarts keep the guard.

## Touch points

| File | Change |
|------|--------|
| `src/specclaw-status.ts` | `SpecclawHalt` interface + `detectSpecclawHalt()` |
| `src/schedules-config.ts` | `escalatedAt: z.string().nullable().optional()` |
| `src/scheduler.ts` | `SchedulerDeps.checkHalt?` / `onEscalate?`; tick gate before idle-gate; `appendScheduleLog(..., 'skipped', 'specclaw-halted')` |
| `src/master-commands.ts` | `scheduleSetEnabled(true)` clears `escalatedAt`; `scheduleList` 🛑 tag |
| `server.ts` | wire `checkHalt` (slug → projects dir → `detectSpecclawHalt`) + `onEscalate` (master notice via `routeNotification`) |

## Decisions

- **Deviation from proposal:** proposal sited escalation in the heartbeat scan (`src/heartbeat.ts`). Built in the Scheduler tick instead — the heartbeat is a manual `!project heartbeat` command (not periodic), while the scheduler tick already runs every 60s, owns the schedule record it must suspend, and already has the persist path. Same observable behavior, one fewer moving part.

- **Gate placement before idle-gate:** a halted loop should suspend even while the channel looks busy; halt check is a cheap file read done only for due schedules.
- **`enabled=false` + `escalatedAt` both set:** disable stops the thrash; the timestamp is the never-twice guard if the schedule gets re-enabled without clearing (legacy resume path, hand-edited json).
- **Detection never throws:** all reads wrapped; any parse gap → `halted: false`. A false negative costs one redundant fire; a false positive would silently kill a healthy loop.
- **Placeholder Issues lines** (`_None._`, `None`, case-insensitive, with/without markdown emphasis) are not signals.
