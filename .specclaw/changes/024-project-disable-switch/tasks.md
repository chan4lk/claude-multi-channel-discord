# Tasks: Project disable switch

**Change:** project-disable-switch
**Created:** 2026-07-26
**Total Tasks:** 6

## Summary

Six tasks, three waves. Wave 1 lands the schema + pool gate (the safety core) and the operator toggle in parallel. Wave 2 wires the notice dispatch, the scheduler/sweep/ask_project skips, and the auto-disable idle sweep. Wave 3 documents. Each impl task includes its tests (project convention: plain `bun src/<name>.test.ts` PASS/FAIL scripts, no framework).

## Tasks

### Wave 1 — schema, pool gate, toggle verb

- [x] `T1` — Schema field + pool deliver gate
  - Files: `src/channels-config.ts`, `src/project-pool.ts`, `src/project-pool.test.ts`
  - Estimate: small
  - Kind: impl
  - Notes: `disabled: z.boolean().optional()`, `enabledAt: z.string().optional()`, `autoDisable: z.boolean().optional()` on `ProjectSchema`; `autoDisable: z.object({ enabled: z.boolean(), idleDays: z.number().int().positive().default(7) }).strict().optional()` on `DefaultsSchema`. In `ProjectPool.deliver()` immediately after the `!project` check: `if (project.disabled) { this.fireEvent({ kind: 'disabled-drop', chatId, slug: project.slug }); return }`. Add `disabled-drop` to the `PoolEvent` union. Tests: deliver to disabled project → no spawn, MockProjectProcess receives nothing, event fired (AC1, AC2). Gate MUST precede kill-loop/circuit/budget/dedup.

- [x] `T2` — `set --disabled on|off` + list/show markers
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: Follow the `--hermes` flag pattern in `handleSet` (parse, validate on/off, master guard warn no-op, persist via fresh-config read-modify-write). `on`: set `disabled: true`, remove `enabledAt`, AND kill warm session via the same pool path `stop` uses; confirm both actions in the reply. `off`: delete the `disabled` key and stamp `enabledAt` (ISO now) — fresh idle window for the auto-disable sweep. Update `set` usage string + help text. `handleList`: `⛔` tag on disabled rows; `handleShow`: `disabled: yes` line. Tests: AC3, AC4, AC5, AC9.

### Wave 2 — notice dispatch, scheduler/sweep/ask_project skips

- [x] `T3` — Server notice on disabled-drop (throttled)
  - Files: `server.ts`
  - Estimate: small
  - Kind: impl
  - Depends: T1
  - Notes: In the pool event handler chain (near `evt.kind === 'evict'`), handle `disabled-drop`: module-level `Map<string, number>` throttle, 5-min window, then `routeNotification(cfg, { kind: 'text', chatId, text: 'project disabled. use master to enable' }, 'disabled notice')` so Teams/WhatsApp route correctly (FR5, AC10). Throttle logic small enough to live inline; if extracted for testability, put it in `src/project-pool.ts`-adjacent pure helper.

- [x] `T4` — Scheduler skip + sweeps skip + ask_project error
  - Files: `src/scheduler.ts`, `src/master-mcp-server.ts`, `server.ts`, `src/scheduler.test.ts`, `src/master-mcp-server.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: Add optional `isProjectDisabled?: (chatId: string) => boolean` to `SchedulerDeps`; in `tick()` before firing a due schedule, skip + `appendScheduleLog(..., 'skipped', ..., 'project disabled')` when true; fail-open when dep absent (AC6, edge case). Wire the dep in `server.ts` from `loadChannelsConfig`. `runAutopilotSweep` + backlog-watch sweep: `if (project.disabled) continue` (AC7). `ask_project` handler (src/master-mcp-server.ts:648): after target resolution, `if (target.project.disabled) return errorResult('target project is disabled')` (AC8). Tests for all three.

- [x] `T6` — Auto-disable idle sweep
  - Files: `src/scheduler.ts`, `server.ts`, `src/scheduler.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: `registerAutoDisableSweep`/`runAutoDisableSweep` mirroring `registerBacklogWatchSweep` (hourly, opts: `getChannels`, `saveChannels`, `projectDirFor`, `onAutoDisable?`, `nowMs?` injectable for tests). Skip master / `disabled` already set / `project.autoDisable === false` / sweep not enabled in defaults / no transcript dir or no `.jsonl`. Idle = `nowMs − max(newest .jsonl mtime, Date.parse(enabledAt ?? 0))`; negative → active. Idle > idleDays (default 7, clamp <1 → 7) → persist `disabled: true` (drop `enabledAt`), call `onAutoDisable(slug, chatId, idleDays)`. Transcript-dir helper: reuse/extract `encodeProjectCwd` + realpath logic from `src/heartbeat.ts:38-77` into a shared helper rather than a fourth copy (also duplicated in behaviour-mirror.ts, pattern-mining.ts — extract to e.g. `src/transcript-path.ts`, leave existing copies alone unless trivial). Wire in `server.ts` with master notice `⛔ auto-disabled <slug> — idle <N>d. re-enable: !project set <slug> --disabled off`. Tests: AC12–AC15 with temp dirs + injected `nowMs`.

### Wave 3 — docs

- [x] `T5` — Docs
  - Files: `CLAUDE.md`, `README.md`
  - Estimate: small
  - Kind: docs
  - Depends: T2, T3, T4, T6
  - Notes: CLAUDE.md — `disabled?`/`enabledAt`/`autoDisable` in channels.json key fields, `--disabled on|off` in the `set` flags paragraph, short auto-disable sweep section (mirroring backlog-stall-watch section style). README — operator command row. Keep to the existing terse doc style.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
