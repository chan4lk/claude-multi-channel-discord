# Design: Subagent-aware stuck-watchdog

**Change:** watchdog-subagent-aware
**Created:** 2026-05-13

## Technical Approach

Two-signal kill gate. The watchdog still uses `pendingDeliverAtMs` as the primary "is the agent late?" signal. Before firing `stuck`, it consults `transcriptMtimeMs()` as a secondary "is the agent doing anything?" signal. The kill happens only when both signals point at a dead process.

The transcript `.jsonl` is the source of truth for in-process activity: every assistant turn, every tool_use, every tool_result, every subagent message is appended. Mtime advancement is a perfect heartbeat that requires no instrumentation inside the agent itself.

## Architecture

```
                ┌──────────────────────────────────────┐
                │ ProjectPool.evictIdle() (every 30s)  │
                └──────────────┬───────────────────────┘
                               │
                               ▼
                   pendingAt = proc.pendingDeliverAtMs()
                               │
              pendingAt = null │ pendingAt != null
                               │
              skip stuck check │ sincePending = now − pendingAt
                               │
                               ▼
                  sincePending > STUCK_THRESHOLD_MS ?
                               │
                          no   │   yes
                               │
                       skip    │   mtime = proc.transcriptMtimeMs?.()
                               │
                               │   mtime != null AND
                               │   (now − mtime) < STUCK_THRESHOLD_MS ?
                               │
                          yes  │  no
                               │
                fireEvent      │  fireEvent('stuck')
                ('progress-    │  proc.kill('requested')
                  skip')       │
                continue       │  continue
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/project-process.ts` | edit | Add optional `transcriptMtimeMs?(): number \| null` on `ProjectProcess`; null impl in `MockProjectProcess` |
| `src/claude-process.ts` | edit | Add `transcriptMtimeMs()` method on `ClaudeProjectProcess`; reuses sessionId + transcriptPath computation already in `readSessionId()` |
| `src/project-pool.ts` | edit | Insert transcript-mtime gate inside the `sincePending > STUCK_THRESHOLD_MS` branch (lines 178–184); add `progress-skip` event kind to the `PoolEvent` union |
| `src/project-pool.test.ts` | edit | Three new cases under §7 stuck-watchdog (mtime-fresh skips, mtime-null kills, mtime-stale kills) |

## Data Model Changes

`PoolEvent` union (in `src/project-pool.ts:9` area) gains:

```ts
| { kind: 'progress-skip'; chatId: string; slug: string; sinceLastReplyMs: number; sinceTranscriptMs: number }
```

No persisted-state changes. No migrations.

## API Changes

`ProjectProcess` interface:

```ts
/**
 * Wall-clock ms of the most recent write to the session transcript .jsonl.
 * Returns null when unknown (session id not yet captured, file missing,
 * stat fails). Used by the pool's stuck-watchdog to distinguish a hung
 * process from one doing long internal work (subagents, big bash). Optional —
 * backends that don't implement it leave the watchdog in pre-existing
 * pendingDeliver-only mode.
 */
transcriptMtimeMs?(): number | null
```

Public method only — no breaking change.

## Key Decisions

1. **mtime vs. size** — mtime is monotonic per write, doesn't reset on truncation, and is one syscall. Size would also work but flips false on idle no-op turns. Chose mtime.
2. **AND-gate not OR-gate** — the original `pendingDeliverAtMs` check stays as the trigger ("agent is late"). Transcript freshness is a *veto*, not a *trigger*. Prevents accidentally extending kills when the agent is healthy but slow.
3. **Skip → continue, not skip → fall through to idle-evict** — when the watchdog vetoes a kill, we explicitly `continue` the loop so the same tick doesn't then idle-evict the process. (Idle-evict uses `lastActivityMs`, which would also be old in this scenario; we don't want a double-edged sword.)
4. **No threshold for transcript-mtime separately** — reuse `STUCK_THRESHOLD_MS`. Adding a second knob now invites bikeshedding without evidence either knob is wrong.
5. **`progress-skip` event** — give operators visibility into false-positives-prevented without changing kill semantics. Single-line log; no metric.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Truly hung claude process still writes to transcript via background TUI flush ⇒ watchdog never kills | low | medium | TUI flush only happens on actual writes; a hung process doesn't write. Documented in EC4. Operator can manually `!project restart`. |
| Disk slow ⇒ healthy agent's mtime updates lag 5 min | very low | medium | Observable via `progress-skip` absence; add per-project threshold later if seen. |
| `transcriptMtimeMs()` throws unhandled in some backend impl | low | low | Wrap call in try/catch in pool; treat throw as null. |
| Behavioral change masks real bugs that the old false-positive kill was inadvertently mitigating | low | low | Watch `progress-skip` event rate post-deploy for 48h before assuming success. |
