# Design: Teams File Attachment Support

**Change:** teams-file-attachments
**Created:** 2026-07-11

## Technical Approach

All download logic lives inside `TeamsAdapter`. The adapter already holds `getAccessToken()` (cached OAuth2 client-credentials flow) and processes inbound activities. Adding a private `downloadTeamsAttachment()` method keeps the change self-contained.

`server.ts` changes are minimal: pass `inboxDir` and `maxAttachmentBytes` into `TeamsAdapterOpts` when constructing the adapter (two new optional fields with defaults).

## Architecture

```
TeamsAdapter.handleRequest()
  │
  ├─ parse activity.attachments (new BotFrameworkAttachment[] type)
  ├─ for each attachment:
  │    └─ downloadTeamsAttachment(att) → summary string
  │         ├─ size pre-check (contentLength if present)
  │         ├─ getAccessToken() (private, cached)
  │         ├─ fetch(contentUrl, { Authorization: Bearer <token> })
  │         ├─ size post-check (buffer.byteLength)
  │         ├─ mkdirSync(inboxDir, { recursive: true })
  │         ├─ writeFileSync(inboxPath, buffer)
  │         └─ return "name (contentType, sizeKB)"
  │
  ├─ fix text guard: pass if text OR attachments.length > 0
  ├─ synthesize content = text?.trim() || "(attachment)"
  └─ envelope.attachments = summaries (if any)
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/teams-adapter.ts` | Modify | Add `BotFrameworkAttachment` type; add `inboxDir`/`maxAttachmentBytes` to `TeamsAdapterOpts`; add `downloadTeamsAttachment()` private method; fix text guard; populate `envelope.attachments` |
| `server.ts` | Modify | Pass `inboxDir: INBOX_DIR` and `maxAttachmentBytes: MAX_ATTACHMENT_BYTES` in `TeamsAdapterOpts` constructor call |

## Data Model Changes

```typescript
// New type in src/teams-adapter.ts
interface BotFrameworkAttachment {
  contentUrl?: string
  contentType?: string
  name?: string
  thumbnailUrl?: string
  contentLength?: number
  [key: string]: unknown
}

// TeamsActivity — add explicit attachments field
interface TeamsActivity {
  // ... existing fields ...
  attachments?: BotFrameworkAttachment[]
  [key: string]: unknown
}

// TeamsAdapterOpts — two new optional fields
export interface TeamsAdapterOpts {
  appId: string
  appSecret: string
  tenantId?: string
  inboxDir?: string        // default: join(homedir(), '.claude/channels/discord-multi/inbox')
  maxAttachmentBytes?: number  // default: 25 * 1024 * 1024
  onInbound: (chatId: string, env: InboundEnvelope, serviceUrl: string) => void
}
```

## API Changes

None. `onInbound` callback signature unchanged. `InboundEnvelope.attachments?: string[]` already defined.

## Key Decisions

1. **Eager download vs. lazy tool** — Teams CDN requires a live bearer token; URLs can't be stored for later use by Claude. Must download eagerly. (WhatsApp is summary-only for a different reason — Baileys media decryption.)

2. **Self-contained in adapter** — Keeping download logic in `TeamsAdapter` avoids circular imports and keeps server.ts changes to two lines. The adapter already does OAuth2; adding fs writes is a natural extension.

3. **Pass `inboxDir`/`maxAttachmentBytes` via opts** — Avoids importing from server.ts. Defaults inside the adapter match server.ts values. This keeps the adapter independently testable.

4. **Filename for inbox path** — `${Date.now()}-${sanitized-name}`. Sanitize with `/[^a-zA-Z0-9._-]/g` → `_` to prevent path traversal. Check for `..` after sanitization.

5. **Size check order** — Pre-check `contentLength` if present (skip download entirely). Post-check `buffer.byteLength` if `contentLength` was absent (delete file if oversized).

6. **Placeholder content** — `"(attachment)"` when text is empty and attachments present. Matches Discord and WhatsApp patterns in server.ts (line 2004, 2076).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Token reuse across requests | `getAccessToken()` already caches with 60s expiry buffer — safe |
| Large attachments filling disk | 25MB cap + pre-check on contentLength |
| Path traversal via malicious filename | Sanitize to `[a-zA-Z0-9._-]`, reject `..` |
| CDN returning 401 after token cache | Catch error per-attachment, degrade to summary |
| Blocking async download in request handler | `downloadTeamsAttachment()` is async; `handleRequest()` awaits Promise.allSettled — parallel downloads, non-blocking on individual failure |
