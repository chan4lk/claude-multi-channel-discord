# Proposal: Teams File Attachment Support

**Created:** 2026-07-11
**Status:** ✅ Approved

## Problem

Teams channels silently drop all file attachments. When a user sends a file (image, document, video) in a Teams channel, the Bot Framework Activity payload carries an `attachments[]` array with `contentUrl`, `contentType`, and `name`. The current `TeamsAdapter` never reads this field — it's absorbed by the `[key: string]: unknown` catch-all and discarded. Additionally, messages that contain only an attachment (no text body) are rejected outright by the `!activity.text?.trim()` guard. Claude never sees that a file was shared.

This matters because Teams users frequently share files as part of their workflow. Other platforms (Discord, WhatsApp) already surface attachment metadata to Claude. Teams is the only platform where attachments are completely invisible.

## Proposed Solution

1. **Type the attachments field** on `TeamsActivity` — add `attachments?: BotFrameworkAttachment[]` with `contentUrl`, `contentType`, `name`, `thumbnailUrl`.
2. **Fix the text guard** — allow messages through when `text` is empty but `attachments` is non-empty.
3. **Download each attachment** via authenticated fetch — Teams CDN requires the bot's OAuth2 Bearer token (`getAccessToken()` already exists). Stream to `MCD_CHANNELS_DIR/inbox/`, identical to Discord's download path.
4. **Build summary strings** — format as `"filename.pdf (application/pdf, 42KB)"` and populate `InboundEnvelope.attachments[]`.
5. **Error isolation** — failed downloads log a warning and surface as `"filename.pdf (download failed)"` rather than blocking the message.

## Scope

### In Scope
- Parse `Activity.attachments[]` from inbound Teams activities
- Authenticate file downloads with OAuth2 Bearer token
- Stream files to `inbox/` directory (same as Discord)
- Build human-readable attachment summaries for Claude
- Handle attachment-only messages (no text body)
- File size limit enforcement (match Discord's limit)
- Unit test for attachment parsing + summary generation

### Out of Scope
- Image vision / OCR (Claude receives file path, can choose to read it)
- Outbound file sending from Claude to Teams
- Thumbnail/preview handling
- WhatsApp attachment download (separate concern)
- Retry logic for transient CDN failures

## Impact

- **Files affected:** 2–3 (`src/teams-adapter.ts`, `server.ts`, possibly `src/paths.ts` for inbox path reuse)
- **Complexity:** Medium
- **Risk:** Low — additive change; existing Teams text flow unchanged. Auth token already implemented.

## Open Questions

1. Should attachment-only messages synthesize a placeholder `content` string (e.g. `"[attachment]"`) or leave `content` empty? Claude Code needs non-empty content to respond usefully.
2. File size limit — match Discord's current cap, or set a Teams-specific limit?
3. Should inline images (content-type `image/*`) be treated differently from documents?

---

**To proceed:** Review this proposal and approve to begin planning.
