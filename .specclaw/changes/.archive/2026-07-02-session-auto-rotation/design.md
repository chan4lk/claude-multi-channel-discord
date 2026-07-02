# Design: Session Auto-Rotation Threshold Fix

**Change:** session-auto-rotation
**Created:** 2026-06-27

## Technical Approach

Extend the existing `readSessionId()` rotation gate in `ClaudeProjectProcess`:
1. Lower the threshold constant
2. Read a per-project override from opts
3. Before renaming `.session-id`, extract context snapshot from the old transcript and write `.session-context.md`
4. On fresh spawn's `start()`, load `.session-context.md` → `rotatedContextText`
5. `formatPrompt()` prepends it on the first delivery (same pattern as `goalText`)
6. Emit a `session-rotated` callback → pool wraps as `PoolEvent` → server.ts posts Discord notice

No new files. No async in the hot path. Snapshot extraction is synchronous and fail-silent.

## Architecture

```
readSessionId()
  size > threshold?
    ├─ extractContextSnapshot(transcriptPath, size)  ← NEW
    │    └─ write .session-context.md
    ├─ renameSync(.session-id → .session-id.rotated-<ts>)
    ├─ opts.onSessionRotated?.({ slug, chatId, transcriptBytes: size })  ← NEW
    └─ return undefined

start()
  ├─ [existing] read GOAL.md → goalText
  └─ [NEW] read .session-context.md → rotatedContextText

formatPrompt(envelope)
  ├─ [existing] if !firstMessageSent && goalText → prepend <goal>
  └─ [NEW] if !firstMessageSent && rotatedContextText → prepend [auto] context block
         then delete .session-context.md (best-effort)

ProjectPool.spawnProject()
  └─ pass onSessionRotated: (info) => fireEvent({ kind: 'session-rotated', ...info })

server.ts pool onEvent
  └─ if evt.kind === 'session-rotated' → post Discord notice to evt.chatId
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | Modify | Add `sessionRotateThresholdKB` to `ProjectSchema` + `DefaultsSchema` |
| `src/claude-process.ts` | Modify | Lower constant; add `sessionRotateThresholdBytes` to opts; add snapshot fields + `extractContextSnapshot()`; load `.session-context.md` in `start()`; inject in `formatPrompt()`; add `onSessionRotated` callback to opts |
| `src/project-pool.ts` | Modify | Add `session-rotated` to `PoolEvent` union; pass `onSessionRotated` + `sessionRotateThresholdBytes` when spawning |
| `server.ts` | Modify | Handle `session-rotated` pool event, post Discord notice |

## Data Model Changes

`channels-config.ts` — `ProjectSchema` and `DefaultsSchema` each gain:
```typescript
sessionRotateThresholdKB: z.number().int().positive().optional()
```

`ClaudeProjectProcessOptions` gains:
```typescript
/** Override bytes threshold for session rotation. Falls back to RESUME_TRANSCRIPT_MAX_BYTES. */
sessionRotateThresholdBytes?: number
/** Called when session is auto-rotated due to oversized transcript. */
onSessionRotated?: (info: { slug: string; chatId: string; transcriptBytes: number }) => void
```

`PoolEvent` union gains:
```typescript
| { kind: 'session-rotated'; chatId: string; slug: string; transcriptBytes: number }
```

## Snapshot Extraction Algorithm

```
lines = readFileSync(transcriptPath, 'utf8').split('\n')
iterate reversed, accumulate:
  role='user' content has <channel ...>...</channel>:
    strip outer <channel> tag, keep inner text → up to 10 entries
  role='assistant' content is text:
    first 200 chars → up to 3 entries
format:
  [auto] Prior session context (rotated at <N> KB):

  Recent operator messages:
  - <msg 1>
  ...

  Last assistant replies:
  - <snippet 1>
  ...
total capped at 2000 chars
write to projects/<slug>/.session-context.md
```

Content extraction from JSONL entries:
- User: `d.content` is a string containing `<channel ...>...</channel>` → strip outer tag
- Assistant: `d.message.content` is array of `{type:'text', text:'...'}` items → join first item text

## Key Decisions

**Decision 1 — Snapshot stored in `.session-context.md`, not in memory.**
Allows recovery even if the server restarts between rotation and next deliver. The file is the source of truth; `rotatedContextText` is just the in-memory cache loaded at `start()`.

**Decision 2 — Snapshot deleted after first delivery, not after first `formatPrompt()` call.**
`formatPrompt()` runs before send-keys. Deletion runs after the send completes (after `sleep(500)` + C-m). If the server crashes between format and send, the file persists and gets re-loaded on the next spawn — better than losing it too early.

**Decision 3 — `onSessionRotated` callback, not EventEmitter.**
`ClaudeProjectProcess` uses the callback pattern throughout (`onReply`, `onExit`, etc.). Consistent with existing design. Pool wraps the callback to emit a `PoolEvent`.

**Decision 4 — Discord notice goes to project channel, not master.**
The operator monitoring the project channel sees the notice inline. Master channel is already noisy; project-channel notice is more contextual.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Snapshot extraction fails (corrupt JSONL, encoding error) | Entire `extractContextSnapshot` is wrapped in try/catch; rotation proceeds without snapshot |
| `.session-context.md` deletion fails | Logged, non-fatal; next spawn reads stale snapshot and overwrites it |
| Snapshot too large for inject | Capped at 2000 chars before write |
| Per-project threshold set unreasonably low | `z.number().int().positive()` validates > 0; minimum practical value is operator's choice |
