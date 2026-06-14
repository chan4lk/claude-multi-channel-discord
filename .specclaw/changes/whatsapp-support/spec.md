# Spec: Add WhatsApp support for MCD

**Change:** whatsapp-support
**Created:** 2026-06-14
**Status:** 🟡 Draft

## Overview

Add WhatsApp as a third messaging platform for MCD projects, alongside the existing Discord and Teams platforms. A project with `platform: 'whatsapp'` is reachable from a normal WhatsApp account: the operator messages a bound contact, MCD routes the text to that project's Claude subprocess, and replies + tool-progress flow back over WhatsApp.

The implementation uses **Baileys** (`@whiskeysockets/baileys`), an unofficial pure-WebSocket WhatsApp Web client, and mirrors the `TeamsAdapter` contract so it slots into the three per-platform dispatch seams already present in `server.ts` (`onReply`, `routeNotification`, `handleToolProgress`).

A **single** Baileys socket serves the whole server and multiplexes all WhatsApp projects. First-run pairing is via a **QR code rendered as an image to the master Discord channel**. Each WhatsApp project binds to one contact JID. Access is gated by the existing `access.allowFrom` list, matched on the sender's E.164 number.

## Requirements

### Functional Requirements

- **FR1** — The `platform` enum in `channels-config.ts` accepts `'whatsapp'` in addition to `'discord'` and `'teams'`. Existing configs (no `platform`, or `discord`/`teams`) continue to validate unchanged.
- **FR2** — A project may set `whatsappJid` (the bound contact's WhatsApp JID, e.g. `<e164>@s.whatsapp.net`). It is required when `platform === 'whatsapp'` and ignored otherwise.
- **FR3** — On server start, if WhatsApp is enabled (auth dir present or `WHATSAPP_ENABLED=1`), a single Baileys socket connects using multi-file auth state persisted under `MCD_CHANNELS_DIR`.
- **FR4** — On first run with no saved session, the adapter renders the Baileys QR string as a PNG image and posts it to the master Discord channel for the operator to scan. On subsequent posts of a new QR (rotation), the latest QR replaces/updates the prior message.
- **FR5** — After successful pairing, the session persists across bot restarts without re-scanning the QR.
- **FR6** — Inbound: on a WhatsApp `messages.upsert` for a bound contact, the adapter resolves the contact JID → project `chatId`, verifies the sender's E.164 number is in `access.allowFrom`, builds an `InboundEnvelope`, and delivers it to the pool via the same callback path as `handleTeamsInbound`.
- **FR7** — Inbound media (images, voice notes, documents) is surfaced as attachment summaries (name/type/size) on the envelope, matching Discord/Teams attachment handling. Media bytes are not parsed.
- **FR8** — Outbound: `postReply(chatId, text, replyTo?)` sends a WhatsApp text message to the project's bound JID, chunked to WhatsApp's per-message limit, returning a message key/id.
- **FR9** — Tool-progress `progressMode` `'post'` and `'edit'` work over WhatsApp with parity to Teams: `'post'` sends one message per tool call; `'edit'` grows one message in place using Baileys message editing. `mcp__mcd__*` calls remain suppressed.
- **FR10** — The three dispatch sites in `server.ts` (`onReply`, `routeNotification`, `handleToolProgress`) route to the WhatsApp adapter when `platform === 'whatsapp'` and the adapter is initialized, falling through to Discord otherwise.

### Non-Functional Requirements

- **NFR1** — Adding WhatsApp must not change Discord or Teams behavior. The new branches are additive; absence of the WhatsApp adapter is a no-op.
- **NFR2** — The Baileys socket runs in the same process as the Discord gateway without blocking it; connection drops auto-reconnect with backoff and never crash or kill the parent tmux subprocess.
- **NFR3** — Auth state files are written mode 0600 under `MCD_CHANNELS_DIR`, consistent with `.env`, `access.json`, and credential files.
- **NFR4** — The implementation tolerates Baileys' frequent breaking releases by pinning the dependency version.

### Configuration & Secrets

- WhatsApp auth state directory: `MCD_CHANNELS_DIR/whatsapp-auth/` (multi-file Baileys state, 0600).
- `WHATSAPP_ENABLED` env (optional) to force-enable when no session exists yet.
- No API keys — pairing is QR-based.

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

- **AC1** — `bun tsc --noEmit` passes; all existing tests (`master-commands`, `project-pool`, `master-mcp-server`) still pass.
- **AC2** — A `channels.json` with a `platform: 'whatsapp'` project and a `whatsappJid` validates; one with `platform: 'whatsapp'` but no `whatsappJid` fails validation with a clear error.
- **AC3** — A unit test feeds a synthetic Baileys `messages.upsert` payload through the adapter and asserts the resulting `InboundEnvelope` (content, userId=E.164, ts, attachment summaries) and the JID→chatId resolution.
- **AC4** — A unit test asserts access denial: a `messages.upsert` from a number not in `access.allowFrom` produces no envelope delivery.
- **AC5** — `postReply` chunks a >limit message into multiple WhatsApp sends (asserted against a mocked socket).
- **AC6** — With Discord/Teams projects only and no WhatsApp config, server start and message flow are byte-for-byte unchanged (no WhatsApp code path entered).

## Edge Cases

- QR rotates before the operator scans → latest QR image updates the master-channel message rather than spamming new ones.
- Baileys socket disconnects mid-turn (network drop / WhatsApp logout) → reconnect with backoff; on permanent logout (e.g. `loggedOut` status) post a notice to the master channel and stop retrying until re-paired.
- Inbound message from a contact not bound to any project → ignored (logged, no delivery).
- Inbound from a bound contact but sender E.164 not in `access.allowFrom` → ignored (logged).
- `edit`-mode progress where the target message was deleted on the phone → fall back to sending a new message (mirrors Teams `updateActivity` catch→post fallback).
- Server shutdown/respawn → socket closes cleanly without killing the parent tmux session.

## Dependencies

- `@whiskeysockets/baileys` (pinned) — WhatsApp Web WebSocket client.
- `qrcode` (pinned) — render the QR string to a PNG buffer for the Discord attachment.
- Existing: discord.js (to post the QR image / notices to master channel), zod (config schema).

## Notes

- **ToS risk (operator-acknowledged):** Baileys drives an unofficial WhatsApp Web session, which can violate WhatsApp's Terms of Service and risks number bans. Acceptable for a personal/self-hosted account; must be documented prominently in README/CLAUDE.md.
- Migrating to the official Cloud API later would swap only the adapter internals, not the dispatch seams or config shape.
- `react`-kind outbound replies are out of scope for WhatsApp in this change.
