# Design: MCD Reliability Fixes

**Change:** mcd-reliability-fixes
**Created:** 2026-07-08

## Technical Approach

Four independent, minimally-scoped changes. Each can be reviewed, tested, and committed independently. No shared state between fixes.

---

### Fix 1 — Kill-loop detector + master alert

**Where:** `src/project-pool.ts`

**Mechanism:**
1. Add `lastToolProgressMs: Map<string, number>` to pool — updated whenever a `tool-progress` event fires for a chatId.
2. Add `spawnedAtMs: Map<string, number>` to pool — set to `now()` on every `spawn()` call.
3. Add `nullKillCount: Map<string, { count: number; windowStart: number }>` to pool.
4. Add `killLoopPaused: Set<string>` to pool (runtime state).
5. In `evictIdle()`, before calling `proc.kill('watchdog')`: check if `lastToolProgressMs.get(chatId) < spawnedAtMs.get(chatId)` (or missing). If so, increment `nullKillCount[chatId]`. If count ≥ 3 within 2h window:
   - Set `killLoopPaused.add(chatId)`
   - Write sentinel: `fs.writeFileSync(join(mcdDir, 'projects', slug, 'kill-loop-paused'), new Date().toISOString())`
   - Call `opts.onReply({ kind: 'text', chatId: masterChatId, text: '⚠️ ...' })`
6. In `deliver()`, after project lookup and before spawn: if `killLoopPaused.has(chatId)`, drop message (log to stderr) and return.
7. On pool construction, scan `projects/*/kill-loop-paused` files and pre-populate `killLoopPaused`.
8. In `killChat()` (called by `!project start`), clear `killLoopPaused.delete(chatId)` and remove sentinel file.

**Master chatId access:** `this.opts.getConfig().master.chatId` — already available.

**New `PoolEvent` kinds:**
```ts
| { kind: 'kill-loop-paused'; chatId: string; slug: string; killCount: number }
| { kind: 'kill-loop-resumed'; chatId: string; slug: string }
```

---

### Fix 2 — UUID capture at kill time

**Where:** `src/claude-process.ts`, `kill()` method

**Mechanism:** In `kill('watchdog')`, before `spawnSync('tmux', ['kill-session', ...])`:
```ts
// Attempt best-effort session-id capture before teardown.
if (!this.sessionIdPersisted && this.projectCwd && this.preSpawnSessionIds.size > 0) {
  const sid = findNewSessionId(this.projectCwd, this.preSpawnSessionIds)
  if (sid) {
    const sessionFile = projectSessionFile(this.slug)
    try {
      if (!existsSync(sessionFile)) {
        writeFileSync(sessionFile, sid, { mode: 0o600 })
        this.log(`session-id captured at kill time: ${sid}`)
        this.sessionIdPersisted = true
        this.observedSessionId = sid
      }
    } catch { /* non-fatal */ }
  }
}
```

`findNewSessionId` is already a private function in the same file — just reuse it. No new dependencies.

**Why before teardown:** `findNewSessionId` reads the transcript directory on disk, which claude may have already written to even if TUI-ready never completed. Once tmux session is killed, no new writes occur, but existing files remain. So the capture could technically happen after kill too. However, placing it before is safer and semantically clearer.

---

### Fix 3 — Heartbeat suffix guard

**Where:** `src/behaviour-mirror.ts`, `buildInjectionMessage()`

**Current code (lines 210–217):**
```ts
let msg: string
if (contextSummary) {
  msg = `Keep going with: ${contextSummary}.`
  if (encouragement) msg += ` Stay ${encouragement}.`
} else {
  msg = `Keep making progress.`
  if (encouragement) msg += ` Stay ${encouragement}.`
}
```

**New code:**
```ts
let msg: string
if (contextSummary) {
  msg = `Keep going with: ${contextSummary}.`
  if (encouragement && contextSummary.length >= 20) msg += ` Stay ${encouragement}.`
} else {
  msg = `Keep making progress.`
}
```

Two changes: (a) suffix guard on `contextSummary.length >= 20`, (b) remove suffix from empty-contextSummary path entirely (it was generating pure noise `Keep making progress. Stay left, left.`).

---

### Fix 4 — ScheduleWakeup stall detection

**Where:** `src/heartbeat.ts`, `classifyChannel()`

**New stall reason:** `'schedule-wakeup-loop'` added to `ChannelState['reason']` union.

**Detection logic** (added after existing tool-incomplete check, before question-unanswered check):

Scan the last 200 parsed entries for tool_use blocks. Build an ordered sequence of tool names from the most recent tool_use calls backward. Check if the tail of that sequence is ≥3 consecutive `ScheduleWakeup` with no `mcp__mcd__reply` between them. If so, and if `ageMins >= 120` (2 hours), set `stalledReason = 'schedule-wakeup-loop'`.

```
last_tools = reverse-ordered list of tool names from tool_use blocks in entries
count = 0
for tool in last_tools:
  if tool == 'ScheduleWakeup': count++
  elif tool == 'mcp__mcd__reply': break  // hit a reply, not a pure wakeup loop
  else: count = 0; break  // other tool, not a wakeup loop
if count >= 3 and ageMins >= 120: stalledReason = 'schedule-wakeup-loop'
```

The 2-hour threshold (`ageMins >= 120`) ensures legitimate short ScheduleWakeup usage (e.g., "check back in 20min") doesn't false-positive.

---

## Architecture

No architectural changes. All four fixes are local to existing files.

The kill-loop sentinel files are co-located with existing per-project files (`watchdog-kills.jsonl`, `circuit-events.jsonl`), consistent with existing patterns.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/project-pool.ts` | Modify | Kill-loop detector state, deliver gate, spawn tracking, killChat cleanup |
| `src/claude-process.ts` | Modify | Session UUID capture in `kill('watchdog')` path |
| `src/behaviour-mirror.ts` | Modify | Heartbeat suffix guard (3-line change) |
| `src/heartbeat.ts` | Modify | `'schedule-wakeup-loop'` stall reason + detection logic |
| `src/project-pool.test.ts` | Modify | Tests for kill-loop detector and deliver gate |
| `src/master-commands.test.ts` | Modify | Test that `!project start` clears kill-loop pause |

## Data Model Changes

New sentinel file: `projects/<slug>/kill-loop-paused` — plain text, content = ISO timestamp of when pause was set. Presence = paused; absence = not paused. Deleted by `!project start`.

No changes to `channels.json` schema.

## API Changes

Two new `PoolEvent` union members (internal diagnostics):
```ts
| { kind: 'kill-loop-paused'; chatId: string; slug: string; killCount: number }
| { kind: 'kill-loop-resumed'; chatId: string; slug: string }
```

`ChannelState['reason']` gains `'schedule-wakeup-loop'`.

## Key Decisions

- **Fix 1 permanent pause** (not timed): operator must consciously resume. Avoids re-triggering the loop automatically.
- **Fix 1 threshold = 3 kills, 2h window**: 1-2 transient failures are acceptable. 3 failures in 2h signals a systemic issue. Window resets on any successful tool call.
- **Fix 2 sync-only** (no retries at kill time): adding retries would delay the watchdog kill path. The best-effort capture is net-positive even if it only succeeds ~50% of the time.
- **Fix 3 threshold = 20 chars**: matches typical short operator messages ("approved", "done?", "build", "yes") which are all <20 chars. A real contextSummary like "implement the login endpoint" is 28 chars.
- **Fix 4 threshold = 3 consecutive wakeups, 2h age**: 3 wakeups = 45min minimum (at 15min intervals). 2h stale guarantees the operator has been away a while. Together prevents false-positives on quick legitimate polling.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Kill-loop pause triggers on a legitimate slow-start (e.g., first-ever spawn of a large project) | Counter only increments on watchdog kills, not TUI-ready failures (which exit with non-zero code). Also 3-kill threshold gives 45min grace. |
| Fix 2 writes stale UUID if two sessions overlap (unlikely but possible) | `existsSync` check prevents overwrite if `.session-id` already exists. |
| Fix 3 breaks projects that intentionally use short context messages | Threshold only affects the `Stay X, Y` noise suffix, not the main context message. Core message unchanged. |
| Fix 4 false-positive for legitimate ScheduleWakeup usage < 2h | 2h `ageMins` guard prevents this. |
