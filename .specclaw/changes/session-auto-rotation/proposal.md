# Proposal: Session Auto-Rotation Threshold Fix

**Created:** 2026-06-27
**Status:** 🟡 Draft

## Problem

`ClaudeProjectProcess` already has session auto-rotation: if `.session-id` points to a transcript larger than `RESUME_TRANSCRIPT_MAX_BYTES`, it rotates the session ID and starts fresh. But the threshold is 1 MB — too high.

In practice: agent-nexus reached 825 KB (38 resumes, 324 turns). Claude loads the full transcript on every `--resume`, which took >5 minutes, tripping the 5-minute watchdog, which killed and respawned the process into the same oversized session — an infinite kill loop.

There is also no way to configure the threshold per-project in channels.json, so projects with legitimately shorter or longer tolerance can't opt out of the global constant.

## Proposed Solution

Four changes across `src/claude-process.ts`, `src/channels-config.ts`, and `server.ts`:

### 1. Lower the default threshold
`RESUME_TRANSCRIPT_MAX_BYTES`: 1 MB → 512 KB. Based on observed data: 825 KB caused >5 min load + watchdog kills; 512 KB is a safe ceiling for sub-2-min load on Sonnet.

### 2. Per-project configurable threshold
Add `sessionRotateThresholdKB: z.number().int().positive().optional()` to `ProjectSchema` and `DefaultsSchema` in `src/channels-config.ts`. `ClaudeProjectProcess` reads the override at spawn time.

### 3. Context snapshot before rotation — no history lost
Before renaming `.session-id`, extract a brief context snapshot from the old transcript:
- Last 10 user messages (the human turns, stripped of `<channel>` wrappers)
- Last 3 assistant reply texts (first 200 chars each)
- Write to `projects/<slug>/.session-context.md`

On the next spawn (fresh session), read `.session-context.md` and inject it as the first `[auto]` message before the user's real message:
```
[auto] Your session was rotated (prior transcript: <N> KB). Here's context from your last session:

Recent operator messages:
- <last 10 user turns>

Last replies:
- <last 3 assistant snippets>

Continue normally from here.
```
Delete `.session-context.md` after injection (one-time brief).

### 4. Discord rotation notice + MCD memory save
Emit a `session-rotated` event from `ClaudeProjectProcess`. In `server.ts`:
- Post Discord notice: `⚠️ \`<slug>\`: session rotated (<N> KB). Context snapshot injected into fresh session.`
- Call `mcp__mcd__remember` on the master channel's MCP server to save a `channel_summary` memory with the snapshot content, so master Claude also retains the context across the rotation.

## Scope

### In Scope
- `src/claude-process.ts` — lower constant; read per-project override; extract snapshot; inject snapshot on next deliver; emit `session-rotated` event
- `src/channels-config.ts` — add `sessionRotateThresholdKB` to schemas
- `server.ts` — handle `session-rotated` event; Discord notice; save memory

### Out of Scope
- LLM-generated summarisation (uses raw transcript extraction only — no API call)
- Rotation by turn count (bytes only)
- Cross-channel session handoff

## Impact

- **Files affected:** 3 (`src/claude-process.ts`, `src/channels-config.ts`, `server.ts`)
- **Complexity:** medium (snapshot extraction + inject-on-next-deliver state)
- **Risk:** low — rotation already works; snapshot write/delete is idempotent; inject is a single prepend

## Open Questions

1. 10 user turns + 3 assistant snippets — enough context, or too much noise? (Can tune.)
2. Should `.session-context.md` be kept after injection as a permanent record, or deleted? (Recommendation: delete after inject — avoids stale context on future rotations.)

---

**To proceed:** Review this proposal and approve to begin planning.
