# Tasks: Session Auto-Rotation Threshold Fix

**Change:** session-auto-rotation
**Created:** 2026-06-27
**Total Tasks:** 3

## Summary

3 tasks, 2 waves. Wave 1 touches `channels-config.ts` and all of `claude-process.ts` (threshold + snapshot extraction + injection). Wave 2 wires the pool event and server.ts handler. Wave 1 tasks can run in parallel; Wave 2 depends on both.

## Tasks

### Wave 1 — Core Logic

- [x] `T1` — Lower threshold, add per-project override, snapshot extraction + injection (`claude-process.ts` + `channels-config.ts`)
  - Files: `src/claude-process.ts`, `src/channels-config.ts`
  - Estimate: medium
  - Depends: —
  - Notes:
    **(a) `channels-config.ts`:** Add `sessionRotateThresholdKB: z.number().int().positive().optional()` to both `ProjectSchema` (line ~75) and `DefaultsSchema` (line ~170). Follow the existing pattern for optional fields.

    **(b) `claude-process.ts` — constant:**
    Change `export const RESUME_TRANSCRIPT_MAX_BYTES = 1_000_000` to `512_000`. Update the jsdoc comment above it to reflect 512 KB threshold and mention per-project override.

    **(c) `claude-process.ts` — options:**
    Add to `ClaudeProjectProcessOptions` interface (after line 289):
    ```typescript
    /** Per-project transcript size threshold in bytes. Falls back to RESUME_TRANSCRIPT_MAX_BYTES. */
    sessionRotateThresholdBytes?: number
    /** Called when session is auto-rotated due to oversized transcript. */
    onSessionRotated?: (info: { slug: string; chatId: string; transcriptBytes: number }) => void
    ```

    **(d) `claude-process.ts` — fields:**
    Add after `private firstMessageSent = false` (line 348):
    ```typescript
    /** Context snapshot from prior rotated session; injected on first deliver. */
    private rotatedContextText: string | null = null
    /** Path to .session-context.md; deleted after first delivery. */
    private contextSnapshotPath: string | null = null
    ```

    **(e) `claude-process.ts` — `start()` method:**
    After the `goalText` loading block (after line 382), add:
    ```typescript
    // Load prior-session context snapshot if rotation happened before this spawn.
    const snapshotPath = join(projectDir(this.slug), '.session-context.md')
    try {
      if (existsSync(snapshotPath)) {
        this.rotatedContextText = readFileSync(snapshotPath, 'utf8').trim() || null
        this.contextSnapshotPath = snapshotPath
        if (this.rotatedContextText) this.log(`context snapshot loaded: ${this.rotatedContextText.length} chars`)
      }
    } catch {
      // Non-fatal.
    }
    ```

    **(f) `claude-process.ts` — `readSessionId()` — threshold + snapshot:**
    Replace the `if (size > RESUME_TRANSCRIPT_MAX_BYTES)` block (lines 1329–1338) with:
    ```typescript
    const threshold = this.opts.sessionRotateThresholdBytes ?? RESUME_TRANSCRIPT_MAX_BYTES
    if (size > threshold) {
      this.extractContextSnapshot(transcriptPath, size)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const rotated = `${path}.rotated-${stamp}`
      try {
        renameSync(path, rotated)
        this.log(`resume refused: transcript ${size} bytes > ${threshold}; rotated .session-id → ${rotated}`)
      } catch (err) {
        this.log(`resume refused but rotate failed: ${(err as Error).message}`)
      }
      this.opts.onSessionRotated?.({ slug: this.slug, chatId: this.chatId, transcriptBytes: size })
      return undefined
    }
    ```

    **(g) `claude-process.ts` — add `extractContextSnapshot()` private method:**
    Add before the closing `}` of the class (before line 1342):
    ```typescript
    private extractContextSnapshot(transcriptPath: string, sizeBytes: number): void {
      try {
        const raw = readFileSync(transcriptPath, 'utf8')
        const lines = raw.split('\n').filter(l => l.trim())
        const userMsgs: string[] = []
        const assistantSnippets: string[] = []
        for (let i = lines.length - 1; i >= 0; i--) {
          if (userMsgs.length >= 10 && assistantSnippets.length >= 3) break
          try {
            const d = JSON.parse(lines[i])
            const role = d.role ?? d.message?.role
            const content = d.message?.content ?? d.content
            if (role === 'user' && userMsgs.length < 10 && typeof content === 'string') {
              // Strip outer <channel ...>...</channel> wrapper
              const inner = content.replace(/^<channel[^>]*>/, '').replace(/<\/channel>$/, '').trim()
              if (inner) userMsgs.unshift(inner.slice(0, 150))
            } else if (role === 'assistant' && assistantSnippets.length < 3) {
              const arr = Array.isArray(content) ? content : []
              const text = arr.find((c: {type?: string}) => c?.type === 'text')?.text ?? ''
              if (text) assistantSnippets.unshift(text.slice(0, 200))
            }
          } catch { /* skip malformed line */ }
        }
        if (userMsgs.length === 0 && assistantSnippets.length === 0) return
        const parts = [
          `[auto] Prior session context (rotated at ${Math.round(sizeBytes / 1024)} KB):`,
          '',
          'Recent operator messages:',
          ...userMsgs.map(m => `- ${m}`),
          '',
          'Last assistant replies:',
          ...assistantSnippets.map(s => `- ${s}`),
        ]
        const snapshot = parts.join('\n').slice(0, 2000)
        const snapshotPath = join(projectDir(this.slug), '.session-context.md')
        writeFileSync(snapshotPath, snapshot)
        this.rotatedContextText = snapshot
        this.contextSnapshotPath = snapshotPath
        this.log(`context snapshot written: ${snapshot.length} chars`)
      } catch (err) {
        this.log(`context snapshot extraction failed: ${(err as Error).message}`)
      }
    }
    ```

    **(h) `claude-process.ts` — `formatPrompt()` — inject snapshot:**
    After the existing `goalText` block (lines 997–1003), modify to handle both goal and snapshot. The snapshot goes AFTER the goal (or standalone if no goal). Append before `return channelMsg`:
    ```typescript
    if (!this.firstMessageSent && this.rotatedContextText) {
      this.firstMessageSent = true
      // Delete snapshot file best-effort after queueing for delivery
      const snapshotPath = this.contextSnapshotPath
      if (snapshotPath) {
        try { unlinkSync(snapshotPath) } catch { /* non-fatal */ }
        this.contextSnapshotPath = null
        this.rotatedContextText = null
      }
      return `${this.rotatedContextText ?? ''}\n${channelMsg}`
    }
    ```
    Note: `rotatedContextText` must be captured before clearing it. Adjust the code to capture first, then clear, then use. Also add `unlinkSync` to the existing imports from `'node:fs'`.
    
    The final order in `formatPrompt`: goal injection runs first (lines 998–1001), then check for snapshot (only if `!firstMessageSent` still — which won't be true if goal fired). To handle both: combine into a single block. If both `goalText` and `rotatedContextText` exist, prepend both. Simplest approach: replace the two separate checks with one combined check:
    ```typescript
    if (!this.firstMessageSent) {
      this.firstMessageSent = true
      const prefix: string[] = []
      if (this.goalText) prefix.push(`<goal>${this.goalText}</goal>`)
      if (this.rotatedContextText) {
        prefix.push(this.rotatedContextText)
        if (this.contextSnapshotPath) {
          try { unlinkSync(this.contextSnapshotPath) } catch { /* non-fatal */ }
          this.contextSnapshotPath = null
        }
        this.rotatedContextText = null
      }
      if (prefix.length > 0) return `${prefix.join('\n')}\n${channelMsg}`
    }
    ```

### Wave 2 — Pool Event + Discord Notice

- [x] `T2` — Add `session-rotated` PoolEvent, wire in pool + server.ts
  - Files: `src/project-pool.ts`, `server.ts`
  - Estimate: small
  - Depends: `T1`
  - Notes:
    **(a) `project-pool.ts` — `PoolEvent` type (lines 7–14):**
    Add to the union:
    ```typescript
    | { kind: 'session-rotated'; chatId: string; slug: string; transcriptBytes: number }
    ```

    **(b) `project-pool.ts` — `spawnProject()` — pass threshold + callback:**
    Find where `ClaudeProjectProcess` is constructed (search for `new ClaudeProjectProcess`). Pass two additional opts:
    ```typescript
    sessionRotateThresholdBytes: resolvedProject.sessionRotateThresholdKB
      ? resolvedProject.sessionRotateThresholdKB * 1024
      : undefined,
    onSessionRotated: (info) => this.fireEvent({ kind: 'session-rotated', ...info }),
    ```
    `resolvedProject` is the merged config from `loadChannelsConfig()`. Read `sessionRotateThresholdKB` from the project entry (falls back to defaults via `resolveProject()`). Check how other per-project fields like `stuckThresholdMinutes` are passed to see the exact pattern.

    **(c) `server.ts` — pool event handler:**
    Find the `onEvent` callback block (around line 1436–1453). Add before the `tool-progress` block:
    ```typescript
    if (evt.kind === 'session-rotated') {
      const kb = Math.round(evt.transcriptBytes / 1024)
      const notice: OutboundReply = {
        kind: 'text',
        chatId: evt.chatId,
        text: `⚠️ \`${evt.slug}\`: session rotated (${kb} KB transcript). Prior context briefed into fresh session.`,
      }
      void routeNotification(loadChannelsConfig(), notice, 'session-rotated').catch(() => {})
    }
    ```

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
