# Tasks: Add WhatsApp support for MCD

**Change:** whatsapp-support
**Created:** 2026-06-14
**Total Tasks:** 6

## Summary

Six tasks across four waves: config foundation → adapter core (connection, inbound, outbound) → server wiring → docs. The adapter is built and unit-tested in isolation (Wave 2) before being wired into `server.ts` (Wave 3), so Discord/Teams paths stay untouched until the final integration. Spec: 10 FRs, 4 NFRs, 6 ACs.

## Tasks

### Wave 1 — Config foundation

- [x] `T1` — Extend config schema + add dependencies
  - Files: `src/channels-config.ts`, `package.json`, `src/channels-config` tests if present
  - Estimate: small
  - Depends: none
  - Notes: Add `'whatsapp'` to the `platform` enum; add optional `whatsappJid` string; `superRefine` so `whatsappJid` is required iff `platform==='whatsapp'`. Add pinned `@whiskeysockets/baileys` and `qrcode` to `package.json`. Satisfies FR1, FR2, AC2.

### Wave 2 — Adapter core (built & tested in isolation)

- [x] `T2` — WhatsAppAdapter connection lifecycle + auth persistence
  - Files: `src/whatsapp-adapter.ts`
  - Estimate: medium
  - Depends: T1
  - Notes: Single Baileys socket via `useMultiFileAuthState(MCD_CHANNELS_DIR/whatsapp-auth)` (0600). Wire `connection.update`: emit QR via `onQr`, reconnect with backoff, detect permanent `loggedOut` → `onNotice` + stop retry. `start()`/`stop()`. Catch all socket errors — never throw to top level (NFR2, NFR3, NFR4, FR3, FR5).

- [x] `T3` — Inbound parsing → InboundEnvelope (+ tests)
  - Files: `src/whatsapp-adapter.ts`, `src/whatsapp-adapter.test.ts`
  - Estimate: medium
  - Depends: T2
  - Notes: `messages.upsert` handler. Build/refresh `jid↔chatId` map from `getConfig()`. Resolve contact JID → chatId; verify sender E.164 ∈ `access.allowFrom`; build `InboundEnvelope` (content, userId=E.164, ts, attachment summaries for media); call `onInbound`. Ignore unbound contacts / denied senders (log only). Tests: envelope shape + mapping (AC3), access denial (AC4). Satisfies FR6, FR7.

- [x] `T4` — Outbound postReply / updateActivity (+ chunking test)
  - Files: `src/whatsapp-adapter.ts`, `src/whatsapp-adapter.test.ts`
  - Estimate: medium
  - Depends: T2
  - Notes: `postReply(chatId, text, replyTo?)` resolves chatId→jid, chunks at WhatsApp limit, returns msg key. `updateActivity(chatId, key, text)` edits in place (`{text, edit:key}`) with send-new fallback on failure. Chunking test against mocked socket (AC5). Satisfies FR8, FR9 (send side).

### Wave 3 — Server wiring

- [x] `T5` — Wire adapter into server.ts (init, inbound, dispatch, QR render)
  - Files: `server.ts`
  - Estimate: medium
  - Depends: T3, T4
  - Notes: Gate init on auth dir / `WHATSAPP_ENABLED`. `handleWhatsAppInbound` mirroring `handleTeamsInbound`. `onQr` → render PNG via `qrcode` → post/update message in master Discord channel; `onNotice` → post text to master channel. Add `else if (platform==='whatsapp' && whatsappAdapter)` branch to `onReply`, `routeNotification`, and `handleToolProgress` (add `handleToolProgressWhatsApp` paralleling the Teams variant). Verify `bun tsc --noEmit` + existing tests pass, no Discord/Teams regression. Satisfies FR4, FR9 (progress dispatch), FR10, NFR1, AC1, AC6.

### Wave 4 — Docs

- [x] `T6` — Documentation + ToS warning
  - Files: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`
  - Estimate: small
  - Depends: T5
  - Notes: WhatsApp setup (QR pairing via master channel), `whatsapp-auth/` in state-file layout, platform list update, prominent unofficial-client ToS/ban warning. Satisfies spec Notes.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
[ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
