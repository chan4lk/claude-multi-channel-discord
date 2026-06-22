# Tasks: Heartbeat Watchdog

**Change:** heartbeat-watchdog
**Created:** 2026-06-19
**Total Tasks:** 10

## Summary

6 waves. Waves 1–3 are independent and can run in parallel. Wave 4 depends on Wave 3. Wave 5 depends on Waves 3+4. Wave 6 (tests) depends on all prior waves.

## Tasks

### Wave 1 — Interval scheduler (schedules-config)

- [x] `T1` — Add interval support to schedules-config.ts
  - Files: `src/schedules-config.ts`
  - Estimate: medium
  - Depends: —
  - Notes: Add `IntervalSchema` (`/^every \d+[mh]$/`). Add optional `interval` field to `ScheduleEntrySchema` with `.refine()` ensuring exactly one of `at`/`interval` is set. Update `nextFireMs()` to compute interval-based next fire (`lastRunAt + durationMs`, falling back to `now` if `lastRunAt` is null). Add `hasFiredWithin(entry, durationMs)` for interval dedup within one tick.

### Wave 1b — Interval scheduler (scheduler.ts)

- [x] `T2` — Branch on interval vs at in scheduler tick
  - Files: `src/scheduler.ts`
  - Estimate: small
  - Depends: T1
  - Notes: In `tick()`, branch on `entry.interval` vs `entry.at` when computing whether to fire. Use `hasFiredWithin` for interval entries, `hasFiredToday` for `at` entries. No other changes.

### Wave 1c — Interval scheduler (master-commands parse)

- [x] `T3` — Accept every Xm/Xh as time arg in schedule add
  - Files: `src/master-commands.ts`
  - Estimate: small
  - Depends: T1
  - Notes: In `handleSchedule add`: accept `every Xm` / `every Xh` as the time argument (currently validated as `HH:MM`). Parse and store as `interval` field in new schedule entry. Update help text.

### Wave 2 — mcp__mcd__inject tool

- [x] `T4` — Add mcp__mcd__inject tool to master-mcp-server
  - Files: `src/master-mcp-server.ts`
  - Estimate: medium
  - Depends: —
  - Notes: Add `mcp__mcd__inject` tool in `buildServer()`. Parameters: `chatId` (string, required), `text` (string, required). Guard: reject if calling `chatId !== masterChatId`. On success: call `pool.deliver(chatId, syntheticEnvelope)` where envelope has `userId='heartbeat'`, `username='heartbeat'`, `messageId='heartbeat-<ts>'`. Return `{ ok: true }`.

### Wave 3 — Channels config heartbeat field

- [x] `T5` — Add heartbeat field to ProjectSchema in channels-config
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Depends: —
  - Notes: Add optional `heartbeat` field to `ProjectSchema`: `heartbeat: z.object({ mode: z.enum(['supervised', 'autonomous']).default('supervised'), window: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/).optional(), staleAfterMinutes: z.number().int().positive().default(60), }).optional()`

### Wave 3b — handleSet heartbeat flags

- [x] `T6` — Add heartbeat flags to handleSet in master-commands
  - Files: `src/master-commands.ts`
  - Estimate: small
  - Depends: T5
  - Notes: Add `--heartbeat-mode`, `--heartbeat-window`, `--heartbeat-stale-minutes` flags to `handleSet`. Validate mode enum, window regex, stale positive int. Update `channels.json` entry's `heartbeat` block. Add to the "requires at least one flag" guard.

### Wave 4 — Heartbeat scanner

- [x] `T7` — Create src/heartbeat.ts with classifyChannel and scanChannels
  - Files: `src/heartbeat.ts`
  - Estimate: large
  - Depends: T5
  - Notes: Implement `classifyChannel(slug, config): ChannelState`. Logic: (1) Resolve project cwd via `projectDir(slug)` + `realpathSync`. (2) Find latest `.jsonl` file in Claude transcript dir for that cwd. (3) If no file → `{ state: 'idle', reason: 'no-transcript' }`. (4) Check mtime: if < 30000 ms → `{ state: 'idle', reason: 'active' }`. (5) Read last 200 lines, parse JSON entries. (6) Detect `tool_use` without `tool_result` (scan for unmatched `tool_use_id`). (7) Detect last assistant message with `?` and no subsequent user message. (8) If age > `staleAfterMinutes` AND (6 OR 7) → `stalled`; else `idle`. Also implement `inWindow(window: string): boolean` with midnight-spanning support (UTC). Implement `scanChannels(config): ScanReport` — iterates all projects, calls `classifyChannel`, returns `{ idle: string[], stalled: ChannelState[] }`.

### Wave 5 — Heartbeat verb + docs

- [x] `T8` — Add heartbeat verb to master-commands
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Depends: T5, T7
  - Notes: Add `'heartbeat'` to verb list + `handleHeartbeat(rest, ctx)`. Parses optional `--channel <slug>`. Calls `scanChannels()` (or single-channel classify). Formats and returns the structured text report (see design.md output format). Add `case 'heartbeat'` in the verb switch.

- [x] `T9` — Update master CLAUDE.md template with Heartbeat docs
  - Files: `templates/master.CLAUDE.md`
  - Estimate: small
  - Depends: T5, T7
  - Notes: Add `# Heartbeat` section documenting: `!project heartbeat [--channel <slug>]` — immediate scan; `!project set <slug> --heartbeat-mode autonomous --heartbeat-window 09:00-17:00`; `!project schedule add master every 30m "<heartbeat prompt>"` — sample prompt included; `mcp__mcd__inject` tool description for autonomous nudge. Deploy updated template to live master project.

### Wave 6 — Tests

- [x] `T10` — Add heartbeat tests to master-commands.test.ts
  - Files: `src/master-commands.test.ts`
  - Estimate: medium
  - Depends: T1, T2, T3, T4, T5, T6, T7, T8
  - Notes: Add tests: (1) `schedule add master every 30m "..."` stores `interval` field, not `at`. (2) `set <slug> --heartbeat-mode autonomous --heartbeat-window 09:00-17:00` persists correctly. (3) `heartbeat --channel <slug>` returns stalled for mock transcript with unanswered `?`. (4) `heartbeat --channel <slug>` returns stalled for mock transcript with `tool_use` missing result. (5) `heartbeat --channel <slug>` returns idle for fresh transcript (mtime < 30s).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
