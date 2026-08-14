# Tasks: Teams File Attachment Support

**Change:** teams-file-attachments
**Created:** 2026-07-11
**Total Tasks:** 3

## Summary

Two waves. Wave 1 implements all attachment logic in `TeamsAdapter` (type, download, guard fix, envelope population). Wave 2 wires the new opts in `server.ts` and verifies end-to-end with a unit test.

## Tasks

### Wave 1 — Core adapter changes

- [x] `T1` — Add `BotFrameworkAttachment` type, fix text guard, download method, envelope population
  - Files: `src/teams-adapter.ts`
  - Estimate: medium
  - Depends: —
  - Notes:
    1. Add `BotFrameworkAttachment` interface (contentUrl, contentType, name, contentLength, [key: string]: unknown).
    2. Add `attachments?: BotFrameworkAttachment[]` to `TeamsActivity`.
    3. Add `inboxDir?: string` and `maxAttachmentBytes?: number` to `TeamsAdapterOpts`; resolve defaults in constructor.
    4. Add private `downloadTeamsAttachment(att: BotFrameworkAttachment): Promise<string>`:
       - Return `"(no download URL)"` summary if `contentUrl` absent.
       - Pre-check `att.contentLength` vs `maxAttachmentBytes` — return oversized summary if too large.
       - Call `this.getAccessToken()`, fetch with Bearer header.
       - Post-check `buffer.byteLength` — delete and return oversized summary if over limit.
       - Sanitize filename: `/[^a-zA-Z0-9._-]/g` → `_`, reject `..` → use `"attachment"` fallback.
       - `mkdirSync(this.inboxDir, { recursive: true })`, `writeFileSync(path, buffer)`.
       - Return `"name (contentType, sizeKB)"`.
       - Catch all errors → return `"name (download failed)"`.
    5. Fix text guard (line 144): change to `activity.type !== 'message' || (!activity.text?.trim() && !activity.attachments?.length)`.
    6. After guard, parse `activity.attachments ?? []`; call `downloadTeamsAttachment` for each via `Promise.allSettled`.
    7. Set `envelope.content = activity.text?.trim() || "(attachment)"`.
    8. Set `envelope.attachments = summaries` (omit field if empty array).
    9. Add `import { mkdirSync, writeFileSync } from 'node:fs'` and `import { join, extname } from 'node:path'` at top.

### Wave 2 — Wire server.ts + unit test

- [x] `T2` — Pass inboxDir and maxAttachmentBytes in TeamsAdapterOpts constructor call in server.ts
  - Files: `server.ts`
  - Estimate: small
  - Depends: T1
  - Notes: Find the `new TeamsAdapter({...})` call (around line 107). Add `inboxDir: INBOX_DIR, maxAttachmentBytes: MAX_ATTACHMENT_BYTES` to the opts object. Both constants already defined in server.ts.

- [x] `T3` — Unit tests for attachment parsing, download, guard fix
  - Files: `src/teams-adapter.test.ts` (new file)
  - Estimate: medium
  - Depends: T1
  - Notes:
    - Test 1: message with text + attachment → envelope.content = text, envelope.attachments = ["name (type, sizeKB)"], file written to temp inbox.
    - Test 2: attachment-only message (no text) → envelope.content = "(attachment)", envelope.attachments populated.
    - Test 3: oversized attachment (contentLength > max) → not downloaded, summary = "name (too large: XMB, max 25MB)".
    - Test 4: download failure (mock fetch throws) → summary = "name (download failed)", envelope delivered.
    - Test 5: text-only message (no attachments) → unchanged behavior.
    - Mock `getAccessToken` via subclass or inject a fetch stub. Use a temp dir for inboxDir.
    - Run with `bun src/teams-adapter.test.ts`.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
