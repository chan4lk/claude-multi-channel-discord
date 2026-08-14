# Design: Idle-Gated Schedules

**Change:** idle-gated-schedules
**Created:** 2026-07-12

## Technical Approach

Wire the two existing primitives together through a dependency-injected hook. `ProjectPool` grows a public `isBusy(chatId, graceMs)` probe built on the same signals the stuck-watchdog already reads (`pendingDeliverAtMs`, `transcriptMtimeMs`). `Scheduler` consults it via a new optional `SchedulerDeps.isBusy` just after `isDue()` and just before `deliver()`. Skips are logged (diag line + `schedule-log.jsonl` with `reason: "busy"`) and stamped on the schedule (`lastSkippedAt`) for `schedule list` visibility. `master-commands` exposes the flag on `schedule add` and the indicator on `schedule list`.

Fail-open by design: no `isBusy` dep, no live process, or unknown transcript state all mean "fire". The gate only suppresses when there is positive evidence of activity.

## Architecture

```
Scheduler.tick()
  └─ isDue(s)? ──yes──▶ s.onlyWhenIdle && deps.isBusy?(s.chatId, graceMs)
                              │true                          │false/undefined
                              ▼                              ▼
                      skip: log 'skipped' reason=busy     deliver() as today
                      s.lastSkippedAt = now (dirty)
                      (lastRunAt/runCount untouched
                       → still due next tick)

server.ts:  isBusy: (chatId, graceMs) => projectPool.isBusy(chatId, graceMs)

ProjectPool.isBusy(chatId, graceMs):
  p = processes.get(chatId)
  if (!p?.isAlive()) return false
  if (p.pendingDeliverAtMs?.() != null) return true      // in-flight turn
  m = p.transcriptMtimeMs?.()
  return m != null && Date.now() - m < graceMs           // recent transcript write
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/schedules-config.ts` | modify | `onlyWhenIdle`, `idleGraceMinutes`, `lastSkippedAt` on `ScheduleSchema` |
| `src/scheduler.ts` | modify | `SchedulerDeps.isBusy?`, busy-gate in `tick()`, `reason` param on `appendScheduleLog` |
| `src/project-pool.ts` | modify | public `isBusy(chatId, graceMs): boolean` |
| `server.ts` | modify | wire `isBusy` into `new Scheduler({...})` deps |
| `src/master-commands.ts` | modify | `--only-when-idle` / `--idle-grace` on `scheduleAdd`, indicators in `scheduleList`, help text |
| `src/scheduler.test.ts` | create | tick decision matrix (AC2, AC4) with mocked deps + tmp `MCD_CHANNELS_DIR` |
| `src/project-pool.test.ts` | modify | `isBusy` matrix (AC3) using `MockProjectProcess` |
| `src/master-commands.test.ts` | modify | flag parse + list indicator (AC5, AC6) |

## Data Model Changes

`ScheduleSchema` additions (all optional → old files parse unchanged):

```ts
onlyWhenIdle: z.boolean().optional(),
idleGraceMinutes: z.number().int().positive().optional(),
/** ISO timestamp of the most recent busy-skip; cleared semantics: a later successful fire updates lastRunAt past it. */
lastSkippedAt: z.string().nullable().optional(),
```

`schedule-log.jsonl` entries gain optional `reason` (only written on skip): `{chatId, scheduledAt, firedAt, status: "skipped", reason: "busy", durationMs: 0}`.

## API Changes

- `SchedulerDeps.isBusy?: (chatId: string, graceMs: number) => boolean` — optional; absent = fail-open.
- `ProjectPool.isBusy(chatId: string, graceMs: number): boolean` — new public method.
- `!project schedule add ... [--only-when-idle] [--idle-grace <minutes>]` — `--idle-grace` without `--only-when-idle` is rejected with a usage error.
- `schedule list` row suffix: `⏸ idle-gated` for gated entries; `⏸ skipped (busy)` when `lastSkippedAt` is set and `lastRunAt` is null or older.

## Key Decisions

1. **Gate reads pool state via DI, not a pool import** — keeps `Scheduler` embedder-agnostic and the decision matrix trivially testable with a stubbed `isBusy` (mirrors existing `slugForChatId`/`deliver` deps).
2. **`pendingDeliverAtMs` OR fresh transcript** (proposal said transcript only) — covers the just-delivered window before claude's first transcript write; without it, a fire in the first seconds of a turn would race through the gate. Strict `<` at the grace boundary.
3. **Persist `lastSkippedAt` on the schedule entry** rather than parsing `schedule-log.jsonl` in `scheduleList` — one field, no log-scan; comparison against `lastRunAt` gives the "was the last outcome a skip" signal for free.
4. **Daily `at:` jobs retry all day** (resolves open question) — `hasFiredToday` already scopes to calendar day; no extra window bookkeeping. Simplicity first.
5. **Fail-open everywhere** — a monitoring gate must never strand a schedule permanently; worst case is today's (pre-change) behavior.

## Risks & Mitigations

- **Permanently-busy channel starves its gated schedule** — by design (that channel is doing work); `lastSkippedAt` makes it visible in `schedule list`. Out of scope: replay queue.
- **`transcriptMtimeMs` depends on `.session-id` capture** — when null the pending-deliver clause still catches in-flight turns; both null → fail-open fire (documented edge case).
- **Skip-tick writes to schedules.json** — atomic tmp+rename already in `saveSchedules`; write volume is one per skip, bounded by tick rate (60s).
