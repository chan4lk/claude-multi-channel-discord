# Design: Idle-evict turn guard

**Change:** idle-evict-turn-guard
**Created:** 2026-07-25

## Approach

Two independent guards against false-positive kills, fixed at the layer that owns each signal:

**Guard A (root cause, watchdog path):** `_pendingDeliverAt` in `ClaudeProjectProcess` is set on `deliver()` (`claude-process.ts:707`) and cleared only in `acceptReply()` (`claude-process.ts:1228`). A turn that completes without a reply tool call leaves the flag armed forever, so the pool's watchdog kills a healthy idle session once the transcript goes quiet (observed: hourly heartbeat kill-loop on dstm-apps). Fix at the source: the existing 2s transcript watcher poll already incrementally parses new transcript lines — teach it to recognize `{"type":"system","subtype":"turn_duration","durationMs":N}` events and treat them as end-of-turn:

```ts
// inside the per-line loop, before the `obj.message` guard
if ((rec as any).type === 'system' && (rec as any).subtype === 'turn_duration') {
  this.noteTurnComplete(typeof (rec as any).durationMs === 'number' ? (rec as any).durationMs : null)
  continue
}
```

`noteTurnComplete(durationMs)`: if `_pendingDeliverAt === null` return (already answered via reply); else push `durationMs ?? (Date.now() - _pendingDeliverAt)` into `turnHistory` (capped at `MAX_TURN_HISTORY`), set `_pendingDeliverAt = null`, bump `_lastActivity`, log `turn-complete (no reply)`.

The watcher's early return `if (this.toolProgressHandlers.size === 0 && this.limitHitHandlers.size === 0) return` becomes `if (no handlers && this._pendingDeliverAt === null) return` so detection works with `progressMode: "off"`. The offset-seek-on-path-change behavior already prevents replayed historical `turn_duration` events from clearing a fresh pending deliver.

With Guard A, the pool's watchdog branch needs **no changes**: `pendingDeliverAtMs()` returns null after a completed turn, so the whole stuck block is skipped — no new event kind needed on this path.

**Guard B (idle-evict path):** mirror the watchdog's transcript veto in `evictIdle()` (`project-pool.ts:425`):

```ts
if (proc.lastActivityMs() < idleCutoff) {
  let tMtime: number | null = null
  try { tMtime = typeof proc.transcriptMtimeMs === 'function' ? proc.transcriptMtimeMs() : null } catch { tMtime = null }
  if (tMtime !== null && tMtime >= idleCutoff) {
    this.fireEvent({ kind: 'evict-skip', chatId, slug: proc.slug, sinceActivityMs: now - proc.lastActivityMs(), sinceTranscriptMs: now - tMtime })
    continue
  }
  this.fireEvent({ kind: 'evict', chatId, slug: proc.slug, reason: 'idle-evict' })
  void proc.kill('idle-evict')
}
```

`PoolEvent` union (`project-pool.ts:9`) gains `{ kind: 'evict-skip'; chatId; slug; sinceActivityMs; sinceTranscriptMs }`. `server.ts` pool-event logging is generic JSON, so no dispatch changes needed (verify during build).

## File changes

| File | Change |
|------|--------|
| `src/claude-process.ts` | `noteTurnComplete()` private method; `turn_duration` recognition in watcher loop; relaxed early-return condition |
| `src/project-pool.ts` | `evict-skip` event kind; transcript veto in idle-evict branch |
| `src/project-process.ts` | `MockProjectProcess.completeTurn(durationMs?)` test hook (clears `_pendingDeliverAt`, feeds `turnHistory`) mirroring the real semantics |
| `src/project-pool.test.ts` | New checks: AC1–AC5 |
| `CLAUDE.md`, `ARCHITECTURE.md` | Watchdog + idle-evict sections: document both guards |

## Key decisions

1. **Fix Guard A in the process, not the pool.** The pool could tail-read the transcript for `turn_duration`, but the process already owns transcript parsing (watcher) and the pending flag; clearing at the source keeps `pendingDeliverAtMs()`'s documented contract ("null when no in-flight turn") truthful for all consumers.
2. **`turn_duration` as the completion signal.** Claude Code appends `{"type":"system","subtype":"turn_duration"}` when a turn ends (verified in live transcripts 2026-07-25). If a future CLI version drops it, behavior degrades to today's (kill after threshold) — fail-safe.
3. **Veto compares transcript mtime to `idleCutoff`** (same window as activity) rather than a separate knob — no new config, easy to reason about: "any evidence of life inside the idle window blocks eviction."
4. **No `stuck-skip` event for Guard A** — the flag is cleared before the watchdog ever evaluates, so there is nothing to skip; the process log line (`turn-complete (no reply)`) is the observability hook.

## Risks

- **Transcript format drift** (`turn_duration` shape changes): degrades to current behavior; log line absence makes it diagnosable.
- **2s poll latency**: a turn completing just after a watchdog tick is cleared within 2s — far inside the 5-min threshold; no race of consequence.
- **Perpetually-fresh transcript blocks idle-evict**: accepted trade-off (spec edge case); pool-full LRU eviction is untouched and still reclaims capacity.

## Grounding sources

- `src/claude-process.ts:700-712, 1210-1235` — deliver/acceptReply lifecycle of `_pendingDeliverAt`.
- `src/project-pool.ts:355-432` — watchdog AND-gate + idle-evict branch as shipped in 2da3e63.
- Live transcript `40af2594-…jsonl` (dstm-apps, 2026-07-25): `{"type":"system","subtype":"turn_duration","durationMs":7446}` terminal event for a no-reply turn.
- Server pane log 2026-07-25: repeating `progress-skip` → `stuck` pairs at 3600000ms episode intervals (heartbeat-driven kill-loop evidence).
