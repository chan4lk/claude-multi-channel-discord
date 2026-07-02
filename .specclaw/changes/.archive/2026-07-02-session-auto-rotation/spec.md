# Spec: Session Auto-Rotation Threshold Fix

**Change:** session-auto-rotation
**Created:** 2026-06-27
**Status:** 🟢 Approved

## Overview

Session auto-rotation already exists in `ClaudeProjectProcess.readSessionId()` but fires at 1 MB — too high. Agent-nexus at 825 KB caused >5-min load times and a watchdog kill loop. This change: lower the default threshold to 512 KB, add per-project configurability, extract a context snapshot before rotation and inject it into the fresh session, and emit a Discord notification.

## Requirements

### Functional Requirements

**FR1 — Lower default threshold:** `RESUME_TRANSCRIPT_MAX_BYTES` lowered from `1_000_000` to `512_000`. Rotation fires when transcript ≥ 512 KB.

**FR2 — Per-project threshold override:** Add `sessionRotateThresholdKB: z.number().int().positive().optional()` to `ProjectSchema` in `channels-config.ts`. When set, this value (× 1024) replaces the global constant for that project. Also add to `DefaultsSchema` for a fleet-wide default override. `ClaudeProjectProcess` reads it via `this.opts`.

**FR3 — Context snapshot extraction:** When rotation triggers, before renaming `.session-id`, parse the old transcript `.jsonl` and extract:
- Last 10 entries where `role === 'user'` and content contains `<channel` (actual operator messages, not injected ones)
- Last 3 entries where `role === 'assistant'` with non-empty text content (first 200 chars each)
Write this as a brief text block to `projects/<slug>/.session-context.md`.

**FR4 — Snapshot injection on fresh session:** On spawn, read `.session-context.md` if it exists. Store content as `rotatedContextText`. On the first `formatPrompt()` call of the new session, prepend the snapshot as a `[auto]` prefix block (similar to how `goalText` is prepended). Delete `.session-context.md` after the first delivery completes (one-time brief).

**FR5 — Rotation Discord notice:** `ClaudeProjectProcess` emits a `session-rotated` pool event containing `{ chatId, slug, transcriptBytes, contextLines }`. `ProjectPool` surfaces this via `fireEvent`. `server.ts` handles it by posting to the channel's Discord: `⚠️ \`<slug>\`: session rotated (<N> KB). Prior context briefed into fresh session.`

**FR6 — Threshold passed to ClaudeProjectProcess:** `ClaudeProjectProcessOptions` gains optional `sessionRotateThresholdBytes?: number`. Callers (project-pool.ts) set this from `resolvedProject.sessionRotateThresholdKB * 1024` if present.

### Non-Functional Requirements

**NFR1 — Snapshot extraction is synchronous and non-blocking:** Uses `readFileSync` + line parsing (same pattern as `readSessionId()`). No async operations. Fails silently — if extraction throws, rotation still proceeds without snapshot.

**NFR2 — Snapshot size cap:** Total snapshot text ≤ 2000 chars to stay within a single Discord message and not bloat the fresh session context.

**NFR3 — No API calls:** Snapshot is raw extracted text, not LLM-summarised.

**NFR4 — Idempotent:** `.session-context.md` deletion after inject is best-effort; if it fails, the next session will see stale context but won't crash.

**NFR5 — Backward compat:** All new config fields optional. Existing channels.json files load without changes.

## Acceptance Criteria

- [ ] AC1: `RESUME_TRANSCRIPT_MAX_BYTES` is `512_000` in `claude-process.ts`.
- [ ] AC2: `ProjectSchema` and `DefaultsSchema` include `sessionRotateThresholdKB: z.number().int().positive().optional()`.
- [ ] AC3: When rotation fires, `.session-context.md` is written to the project dir with last 10 user messages + last 3 assistant snippets.
- [ ] AC4: On fresh spawn after rotation, first `formatPrompt()` call prepends `[auto] Prior session context:\n<snapshot>`.
- [ ] AC5: `.session-context.md` is deleted after first delivery.
- [ ] AC6: A `session-rotated` pool event is emitted and server.ts posts a Discord notice.
- [ ] AC7: `bun tsc --noEmit` passes.
- [ ] AC8: `bun src/project-pool.test.ts` passes (no regressions).

## Edge Cases

- Transcript file not found during snapshot extraction → rotation proceeds, no snapshot written (same as before).
- Snapshot extraction throws → catch, log, proceed with rotation (no snapshot).
- `.session-context.md` already exists (previous rotation didn't inject) → overwrite with new snapshot.
- `sessionRotateThresholdKB` set to 0 or very small → z.number().int().positive() rejects at parse time.
- Project has no Discord channel (Teams/WhatsApp) → Discord notice skipped; pool event still fires.

## Dependencies

- `src/claude-process.ts` — `readSessionId()`, `formatPrompt()`, `ClaudeProjectProcessOptions`
- `src/channels-config.ts` — `ProjectSchema`, `DefaultsSchema`
- `src/project-pool.ts` — `PoolEvent` type, `fireEvent()`
- `server.ts` — pool event handler
