# Spec: Teams File Attachment Support

**Change:** teams-file-attachments
**Created:** 2026-07-11
**Status:** 🟡 Draft

## Overview

Add file attachment ingestion to the Teams adapter. When a Teams user shares a file, the bot must parse the Bot Framework `Activity.attachments[]` array, download each file (Teams CDN requires OAuth2 bearer auth), stream to the local `inbox/` directory, and surface human-readable summaries in `InboundEnvelope.attachments[]` so Claude sees the files. Attachment-only messages (no text body) must also be accepted.

## Requirements

### Functional Requirements

- **FR1** — Parse `Activity.attachments[]` from inbound Teams `message` activities. Each attachment has `contentUrl` (download URL), `contentType` (MIME), `name` (filename), and optionally `thumbnailUrl`.
- **FR2** — Download each attachment to `inbox/` using `getAccessToken()` bearer token in the `Authorization` header. Teams CDN requires auth; unauthenticated fetch returns 401.
- **FR3** — Enforce file size limit of 25MB (matching `MAX_ATTACHMENT_BYTES` in server.ts). Attachments over the limit are skipped with a warning summary instead of downloaded.
- **FR4** — Build summary strings in the format `"name.ext (content-type, 42KB)"` for successful downloads; `"name.ext (download failed)"` for failures.
- **FR5** — Populate `InboundEnvelope.attachments[]` with the summary strings from FR4.
- **FR6** — Fix the text guard (`!activity.text?.trim()`) to also pass through messages that have attachments even when text is empty. Synthesize `"(attachment)"` as `content` when text is absent.
- **FR7** — Sanitize filenames used in summary strings — strip `[\r\n;]` characters (matching `safeAttName()` pattern in server.ts) to prevent delimiter injection in the `<channel>` tag attributes.
- **FR8** — The size check for FR3 must be done before attempting download. Bot Framework `Activity.attachments[]` carries a `contentLength` property when available; fall back to checking after download if absent.

### Non-Functional Requirements

- **NFR1** — Failed downloads must not block message delivery. Errors are logged, degraded summary produced, message still delivered.
- **NFR2** — Download logic is self-contained in `TeamsAdapter` (no new server.ts dependency). The adapter already holds `getAccessToken()`.
- **NFR3** — `getAccessToken()` is already private and cached. The download method calls it internally — no change to the method's visibility.
- **NFR4** — Inbox directory creation uses `mkdirSync(..., { recursive: true })` — idempotent, matches Discord pattern.

## Acceptance Criteria

1. A Teams message containing a file attachment is received, the file is downloaded to `inbox/`, and `InboundEnvelope.attachments` contains `["filename.pdf (application/pdf, 42KB)"]`.
2. A Teams message with only an attachment (no text body) is delivered to the pool with `content: "(attachment)"` instead of being silently dropped.
3. A Teams message with text + attachment delivers both: `content` = original text, `attachments` = summary array.
4. An attachment exceeding 25MB is not downloaded; summary reads `"bigfile.zip (too large: 30.0MB, max 25MB)"`.
5. A download that fails (network error, 4xx, 5xx from CDN) logs an error and produces summary `"file.pdf (download failed)"` without blocking message delivery.
6. Filename sanitization strips `[\r\n;]` from attachment names in summaries.
7. TypeScript compiles with `bun tsc --noEmit` with no new errors.
8. Existing Teams text-only message flow is unchanged.

## Edge Cases

- **Message with text + multiple attachments** — all are downloaded; all appear in `attachments[]`; `content` = original text.
- **`contentUrl` is absent or empty** — skip download, produce `"name (no download URL)"` summary.
- **`name` is absent** — use `"attachment"` as fallback filename in summary.
- **`contentType` is absent** — use `"unknown"` in summary.
- **`contentLength` absent** — download proceeds; if downloaded buffer exceeds limit, delete the file and produce oversized summary.
- **getAccessToken() throws** — caught per-attachment; produces `"name (download failed)"` summary.
- **Attachment-only message, zero attachments parsed** — fall through to existing empty-text guard (returns 200 silently), not delivered.

## Dependencies

- `getAccessToken()` — private method on `TeamsAdapter`, already implemented. No signature change.
- `node:fs` — `mkdirSync`, `writeFileSync` — already used in server.ts; must be imported in teams-adapter.ts.
- `node:path` — `join`, `extname` — for inbox path construction.
- `INBOX_DIR` / `MAX_ATTACHMENT_BYTES` — defined in server.ts. Must be passed into `TeamsAdapter` via opts or resolved from env/paths independently. **Decision:** pass `inboxDir` and `maxAttachmentBytes` in `TeamsAdapterOpts` so the adapter has no import dependency on server.ts. Defaults: `join(STATE_DIR, 'inbox')` and `25 * 1024 * 1024`.

## Notes

- Teams CDN attachment URLs are scoped to the bot's token — they cannot be surfaced to Claude as clickable links for later download. Eager download at inbound time is the only viable pattern.
- WhatsApp does summary-only (no download) because Baileys handles media decryption separately. Teams does not have this constraint.
- `getAccessToken()` remains private — it is called by the new internal `downloadTeamsAttachment()` method within the same class.
