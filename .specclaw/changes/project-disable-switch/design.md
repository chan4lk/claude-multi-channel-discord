# Design: Project disable switch

**Change:** project-disable-switch
**Created:** 2026-07-26

## Technical Approach

All inbound routes — Discord `handleInbound`, `handleTeamsInbound`, `handleWhatsAppInbound`, scheduler fires, autopilot nudges, bot-peer inbound — converge on `ProjectPool.deliver(chatId, envelope)` (src/project-pool.ts:139). The primary gate therefore lives there: one `disabled` check immediately after project resolution, before kill-loop/circuit/budget/dedup logic. The gate fires a new `disabled-drop` pool event; `server.ts` translates it into the in-channel notice with a 5-minute per-channel throttle, reusing the platform-aware `routeNotification` path (same mechanism as autopilot announces, server.ts:1622).

Secondary source-level skips keep logs honest and avoid pointless work: the scheduler tick skips due jobs for disabled projects (logging `skipped` — the status already exists in `appendScheduleLog`), and the autopilot/backlog-watch sweeps `continue` past disabled projects. `ask_project` returns an explicit error so the asking Claude gets feedback instead of silence.

Toggle follows the `--hermes on|off` precedent in `handleSet` (src/master-commands.ts:737-755, 924-929): parse `--disabled on|off`, guard master target, persist via `saveConfig`, and additionally kill the warm session on `on` (reusing the `stop` verb's kill path, `pool.killChat(chatId, 'requested')`). No `--yes`: per the project convention (context.md, "flags that grant reach require `--yes`"), disabling grants no reach and is reversible.

## Architecture

```
inbound (discord/teams/whatsapp/scheduler/autopilot/bot-peer/ask_project)
        │
        ▼
ProjectPool.deliver()
  ├─ !project        → rejected event (existing)
  ├─ project.disabled → fire {kind:'disabled-drop', chatId, slug}; return   ← NEW
  └─ ... existing kill-loop / circuit / budget / dedup / spawn / deliver

server.ts pool event handler
  └─ 'disabled-drop' → throttle (Map<chatId, lastMs>, 5 min)
                     → routeNotification(cfg, {kind:'text', chatId,
                         text:'project disabled. use master to enable'})

Scheduler.registerAutoDisableSweep()   (hourly, mirrors registerBacklogWatchSweep)
  for each project: skip master / disabled / autoDisable:false / no transcript
    idle = now − max(newest transcript .jsonl mtime, enabledAt ?? 0)
    idle > idleDays → set disabled:true (drop enabledAt), save config,
                      onAutoDisable(slug, chatId, idleDays) → master notice
```

**Auto-disable sweep details:** config `defaults.autoDisable?: { enabled: z.boolean(), idleDays: z.number().int().positive().default(7) }` (`.optional().strict()` block, matching backlogWatch); per-project `autoDisable?: boolean` opt-out. Idle signal reuses the transcript-dir encoding already implemented in `src/heartbeat.ts:38-77` (`encodeProjectCwd` + realpath); extract or replicate a `newestTranscriptMtimeMs(cwd)` helper — sweep scans the encoded dir for the newest `.jsonl`. Transcript is touched by every turn regardless of trigger (human, schedule, autopilot, bot-peer), so any activity resets the clock and scheduled projects self-protect. Warm-session kill is unnecessary in the sweep: a project idle 7+ days was idle-evicted long ago (15-min default), and the pool gate stops the next spawn.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | `disabled: z.boolean().optional()` + `enabledAt: z.string().optional()` + `autoDisable: z.boolean().optional()` on `ProjectSchema`; `autoDisable` block on `DefaultsSchema` |
| `src/project-pool.ts` | modify | gate in `deliver()` after project lookup; add `disabled-drop` to `PoolEvent` union |
| `src/master-commands.ts` | modify | `--disabled on|off` in `handleSet` (+ master guard, warm-session kill, help text, usage string); `⛔` in `handleList`; `disabled: yes` in `handleShow` |
| `server.ts` | modify | `disabled-drop` event handler + `disabledNoticeAt` throttle map + notice dispatch; wire `registerAutoDisableSweep` with master-notice `onAutoDisable` hook |
| `src/scheduler.ts` | modify | optional `isProjectDisabled?: (chatId) => boolean` dep; tick skip + `skipped` log; `if (project.disabled) continue` in `runAutopilotSweep` and backlog-watch sweep; new `registerAutoDisableSweep`/`runAutoDisableSweep` (hourly) |
| `src/master-mcp-server.ts` | modify | `ask_project` handler: error result when target disabled |
| `src/master-commands.test.ts` | modify | set on/off/invalid/master-guard/kill-warm, list/show markers |
| `src/project-pool.test.ts` | modify | disabled gate: no spawn, no deliver, event fired |
| `src/scheduler.test.ts` | modify | tick skip + fail-open without dep; sweep skips |
| `CLAUDE.md`, `README.md` | modify | flag docs, verbs list, channels.json key fields |

## Data Model Changes

- `projects[<chat_id>].disabled?: boolean` — absent/false = enabled.
- `projects[<chat_id>].enabledAt?: string` — MCD-maintained ISO stamp written by `set --disabled off`; gives re-enabled projects a fresh idle window. Removed on any disable.
- `projects[<chat_id>].autoDisable?: boolean` — per-project override of the sweep (false = exempt).
- `defaults.autoDisable?: { enabled: boolean, idleDays?: number (default 7, clamp <1 → 7) }` — sweep off unless present with `enabled: true`.

No migration; all fields additive optional (project convention: per-project opt-in fields are `.optional()`, absent = off).

## API Changes

- New pool event: `{ kind: 'disabled-drop'; chatId: string; slug: string }`.
- New scheduler dep (optional, fail-open): `isProjectDisabled?: (chatId: string) => boolean` — injectable per the project's testability pattern.
- `ask_project` gains one error case: `target project is disabled`.
- No MCP tool surface changes.

## Key Decisions

1. **Gate in pool, notice in server.** Pool stays transport-agnostic (fires an event); server owns platform routing and throttling — matches the existing evict/stuck/budget event pattern.
2. **Gate placed before budget/dedup.** A disabled project must not queue budget messages or record dedup IDs; the drop must be total.
3. **Source-level skips in scheduler/sweeps despite pool gate.** Pool gate alone would log schedule fires as `ok` and post notices into a silent channel on every fire. Explicit skips keep `schedule log` truthful. Fail-open when the dep is absent so existing tests/callers are untouched.
4. **No `--yes`.** Reversible, no reach granted — consistent with the documented convention that only reach-granting flags need `--yes`.
5. **In-memory throttle.** Notice suppression state need not survive restarts; worst case after a restart is one extra notice.
6. **`disabled: true` persists in config on `on`; flag removed on `off`** (delete key rather than store `false`), keeping channels.json minimal — same as the `--hermes off` removal pattern.
7. **Transcript mtime as the idle signal.** Persistent across restarts (unlike in-memory `lastActivityMs`), already realpath-safe via the heartbeat helper, and touched by every kind of activity — no new bookkeeping. `enabledAt` stamp covers the one blind spot (re-enable without immediate traffic).
8. **Sweep is a separate opt-in (`defaults.autoDisable.enabled`)**, not implied by the manual flag — mirrors backlogWatch/autopilot structure; operator turns it on once, per-project `autoDisable: false` exempts pinned channels.

## Risks & Mitigations

- **Missed inbound path bypassing the gate** — mitigation: gate sits in `pool.deliver`, the single funnel; grep confirms Teams/WhatsApp/scheduler/autopilot/bot-peer all call it.
- **Operator disables master by chat_id accidentally** — mitigated by FR3 master guard (checked against `config.master.chatId`, not slug).
- **Notice loop with bot peers** (disabled project's notice triggers peer bot) — notice is posted by MCD itself via outbound routing, not routed inbound; plus 5-min throttle caps volume.
- **Config reload races** — `deliver()` reads config via `this.opts.getConfig()` per call (already the pattern), so a toggle takes effect on the next message without restart.
