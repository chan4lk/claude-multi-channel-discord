# Design: Actionable Heartbeat — Attention Report Instead of Idle Spam

**Change:** heartbeat-attention-report
**Created:** 2026-07-12

## Technical Approach

All detection logic lives in `src/heartbeat.ts` as pure functions over `(config, deps)`; rendering lives in `handleHeartbeat` in `src/master-commands.ts`. No new state files, no cross-scan persistence — every detector derives from what's already on disk (transcripts, `schedules.json`, specclaw `status.md`) plus one injected read-only dep (circuit states).

`classifyChannel` gains a `detail` field (full question text, ≤ 300 chars, newlines collapsed) alongside the existing `snippet`, and its parsed transcript entries are reused for the new scheduler-origin scan so each channel's transcript is still read exactly once per sweep.

## Architecture

```
handleHeartbeat(rest, ctx)                        src/master-commands.ts
  ├─ parseFlags → --channel, --quiet
  ├─ buildAttentionReport(config, deps)           src/heartbeat.ts
  │    deps = {
  │      getCircuitStates?: ctx.getCircuitStates  (Map<chatId, {circuitOpen,...}>)
  │      loadSchedules                             (default import, injectable for tests)
  │      readSpecclawStatus                        (injectable for tests)
  │    }
  │    per project (try/catch each):
  │      scanOne(slug) → { state: ChannelState, trailingSchedulerMsgs: number }
  │      map to AttentionItem[]:
  │        question-unanswered → 🔴 + detail + "reply in <#chatId>"
  │        tool-incomplete     → 🟡 + "!project stop <slug>"
  │        schedule-wakeup-loop→ 🟡 + "!project stop <slug>"
  │        circuit-open        → 🔴 (from deps.getCircuitStates)
  │        schedule-noop-loop  → 🟡 per enabled schedule w/ trailing ≥ 5
  │        specclaw-idle       → 🔵 (active change + stale transcript)
  │    sort blocked → review → info, stable by slug
  └─ render(items, {quiet, scannedCount})
       0 items + quiet    → "HEARTBEAT_OK"
       0 items            → "✅ all quiet — N channels scanned"
       else               → header + ≤15 item lines + "(+N more)"
```

Scheduler-origin detection: a user-role transcript entry is scheduler-originated when its text content contains `user_id="__mcd_scheduler__"` or a `message_id="sched-` marker (both are present in the injected `<channel>` envelope). Trailing count = consecutive scheduler-originated user entries at the end of the entry list; any other user entry resets it.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/heartbeat.ts` | modify | `detail` on `ChannelState`; `AttentionItem` type; `buildAttentionReport()`; trailing-scheduler-msg counter; specclaw-idle + circuit-open + schedule-noop-loop detectors |
| `src/master-commands.ts` | modify | `handleHeartbeat` rewrite (render + `--quiet`); `getCircuitStates?` on `MasterContext`; help text |
| `server.ts` | modify | wire `getCircuitStates` into both `MasterContext` construction sites (~line 1247, ~line 1999) |
| `src/heartbeat.test.ts` | create | detector matrix with fixture transcripts + fake deps |
| `src/master-commands.test.ts` | modify | rendering, `--quiet`, `--channel`, help-text checks |
| `templates/master.CLAUDE.md` | modify | heartbeat section: `--quiet` + HEARTBEAT_OK suppression guidance |
| `README.md` | modify | heartbeat verb docs |

## Data Model Changes

- `ChannelState` += `detail: string` (empty when n/a). Additive — existing consumers unaffected.
- New exported type `AttentionItem = { slug, chatId, severity: 'blocked'|'review'|'info', kind: 'question-unanswered'|'tool-incomplete'|'schedule-wakeup-loop'|'circuit-open'|'schedule-noop-loop'|'specclaw-idle', summary, action?, detail? }`.
- `MasterContext` += `getCircuitStates?: () => Map<string, { circuitOpen: boolean; backoffUntil?: number }>`.
- No schema/state-file changes.

## API Changes

- `!project heartbeat [--channel <slug>] [--quiet]` — new flag; output format changes (report, not idle dump). `HEARTBEAT_OK` sentinel contract for scheduled prompts.

## Key Decisions

1. **No cross-scan state** for specclaw-idle — "same phase across scans" would need a persisted snapshot; transcript-age ≥ staleAfterMinutes with an active change is an equivalent operational signal and stateless.
2. **Sentinel string over empty reply** — the scheduled path runs through master Claude (it summarizes `run_master_command` output), so suppression must be a contract the prompt can key on: exact token `HEARTBEAT_OK`.
3. **Reuse parsed entries** — schedule-noop-loop counts trailing scheduler messages from the same 200-line parse `classifyChannel` already does, honoring NFR2 (one transcript read per channel per sweep).
4. **Deps injectable, all optional** — `buildAttentionReport(config, deps)` degrades per-detector when a dep is missing; unit tests pass fakes, prod passes real functions.
5. **Idle list dropped from output** — the slug roll-call is the noise being removed; `N channels scanned` keeps proof-of-life.

## Risks & Mitigations

- **Envelope format drift** (scheduler marker strings change) → detector keys on two independent markers (`user_id="__mcd_scheduler__"`, `message_id="sched-`); fixture tests pin the format.
- **False-positive noop-loop when operator watches silently but wants the schedule running** → 🟡 severity (review, not blocked) and action is a suggestion, never auto-pause.
- **Master Claude posts HEARTBEAT_OK anyway** → template guidance states it verbatim ("If the command output is exactly HEARTBEAT_OK, do not post anything"); worst case is one short line, still better than today.
- **classifyChannel refactor regressions** → existing behavior pinned by new fixture tests before rendering rewrite lands (Wave 1 includes tests for the extended `ChannelState`).
