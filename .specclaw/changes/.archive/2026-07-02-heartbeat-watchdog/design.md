# Design: Heartbeat Watchdog

## Architecture Overview

```
Scheduler tick (every 60s)
  → interval entry due? → fire → pool.deliver(masterChatId, heartbeatPrompt)
       ↓
  Master Claude subprocess receives prompt
  → calls run_master_command({ command: 'heartbeat' })
       ↓
  handleHeartbeat() — reads transcripts, classifies state
  → returns structured report
       ↓
  Master posts supervised report to Discord
  AND/OR calls mcp__mcd__inject(chatId, nudge) for autonomous channels
       ↓
  mcp__mcd__inject → pool.deliver(targetChatId, syntheticEnvelope)
  → target subprocess wakes and continues
```

---

## File Changes Map

| File | Change |
|------|--------|
| `src/schedules-config.ts` | Add `interval` field to `ScheduleEntrySchema`; add `IntervalSchema`; update `nextFireMs()` + `hasFiredRecently()` |
| `src/scheduler.ts` | Thread interval entries through tick logic |
| `src/master-commands.ts` | Add `handleHeartbeat()`; update `handleSchedule add` to accept `every Xm/Xh`; add `--heartbeat-*` flags to `handleSet` |
| `src/channels-config.ts` | Add optional `heartbeat` field to `ProjectSchema` |
| `src/master-mcp-server.ts` | Add `mcp__mcd__inject` tool |
| `src/heartbeat.ts` | **New file** — `scanChannels()`, `classifyChannel()`, transcript-tail reader |
| `templates/master.CLAUDE.md` | Document heartbeat commands and setup |
| `src/master-commands.test.ts` | Tests for heartbeat verb + new set flags |

---

## Key Design Decisions

### 1. Interval scheduler representation
Add `interval?: string` to `ScheduleEntry` alongside the existing `at?: string`. Exactly one of `at` or `interval` must be set (validated by Zod `.refine()`). `nextFireMs()` branches on which is present:
- `at` path unchanged
- `interval` path: parse `Xm`/`Xh` → duration ms; next fire = `lastRunAt + duration` (or `now` if never run)

`hasFiredToday()` is only meaningful for `at` entries. Interval entries use a new `hasFiredWithin(entry, durationMs)` check.

### 2. `mcp__mcd__inject` placement
Added in `buildServer()` in `src/master-mcp-server.ts` alongside existing tools. Guard: `if (chatId !== masterChatId) throw error`. Uses `pool.deliver(chatId, envelope)` directly — no new delivery path. Synthetic `InboundEnvelope` uses:
```ts
{ messageId: `heartbeat-${Date.now()}`, userId: 'heartbeat', username: 'heartbeat', content: text, ts: new Date().toISOString() }
```

### 3. Heartbeat classification in `src/heartbeat.ts`
`classifyChannel(slug, config)` → `{ state: 'idle'|'stalled', reason: string, snippet: string, ageMins: number }`:
1. Find latest `.jsonl` file under Claude's transcript dir for this project's cwd
2. Read last 200 lines, parse valid JSON entries
3. Check mtime: if < 30s → `{ state: 'idle', reason: 'active' }`
4. Walk entries from tail:
   - Collect `tool_use` ids and `tool_result` ids; if any `tool_use` has no matching result → stalled (reason: `tool-incomplete`)
   - Find last entry with `role: 'assistant'` content containing `?` + no subsequent `role: 'user'` entry → stalled (reason: `question-unanswered`)
5. If age > `staleAfterMinutes` AND one of above → return `stalled`; else → `idle`

### 4. Autonomous nudge generation
`handleHeartbeat` returns a plain-text report. Master Claude (the LLM) reads the report and composes nudges — this is NOT automated in the server code. The scheduled prompt instructs master to: read the report, then for autonomous/in-window channels call `mcp__mcd__inject` with a context-aware message. The LLM intelligence lives in the scheduled prompt, not in server code. This keeps server code simple and lets the operator tune the nudge style by editing the scheduled prompt.

### 5. UTC window check
```ts
function inWindow(window: string): boolean {
  const [start, end] = window.split('-')
  const now = new Date()
  const nowMins = now.getUTCHours() * 60 + now.getUTCMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  return startMins <= endMins
    ? nowMins >= startMins && nowMins < endMins       // normal range
    : nowMins >= startMins || nowMins < endMins       // midnight-spanning
}
```

---

## `handleHeartbeat` output format

```
Heartbeat scan — 2026-06-19T11:00:00Z
✅ idle (12): keyflow, specclaw, ai-core, ...
⏰ stalled (2):
  • agent-nexus — question-unanswered, 3h 12m ago
    snippet: "Should I use the existing API or create a new endpoint?"
  • btg-devops — tool-incomplete, 1h 5m ago
    snippet: tool_use "Bash" id=toolu_01X... has no result
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Inject spam in autonomous mode if classification over-triggers | NFR4 guards: skip if subprocess mtime < 30s; `staleAfterMinutes` default 60 |
| Transcript file path differs between real project and symlinked repo | `encodeProjectCwd()` already realpath-resolves; heartbeat uses same path helper |
| Large transcript files slow scan | NFR2: read only last 200 lines |
| `mcp__mcd__inject` from master to itself | Allowed — loop-safe since master processes it as a new inbound message |
