# Proposal: Add WhatsApp support for MCD

**Created:** 2026-06-14
**Status:** 🟢 Approved

## Problem

MCD currently lets an operator drive per-channel Claude projects from **Discord** and **Microsoft Teams**. Each project carries a `platform` field (`'discord' | 'teams'`) and `server.ts` dispatches inbound webhooks and outbound replies per-platform, using `TeamsAdapter` as the template for a non-Discord channel.

WhatsApp is the messaging app the operator actually carries on their phone. Today there is no way to message a project, read replies, or watch tool-progress from WhatsApp. Adding it makes MCD reachable from the device the operator already has in hand, without opening Discord or Teams.

## Proposed Solution

Add a third platform adapter, `whatsapp`, built on **Baileys** (`@whiskeysockets/baileys`) — a pure-WebSocket WhatsApp Web client with no Chromium/Puppeteer dependency, which suits a headless `bun` server far better than `whatsapp-web.js`.

The adapter mirrors the existing `TeamsAdapter` contract so it slots into the established dispatch seams:

- **Inbound:** A **single** Baileys WebSocket serves the whole server. On `messages.upsert`, the adapter maps the WhatsApp chat (contact JID) to a project `chatId` via a per-project `whatsappJid` binding, builds an `InboundEnvelope`, and hands it to the pool — the same path `handleTeamsInbound` uses. First-run pairing is via **QR code** surfaced to the **master Discord channel** (rendered as an image so the operator can scan without shell access), authenticating a normal WhatsApp account.
- **Outbound:** `postReply(chatId, text, replyTo?)` sends a WhatsApp message (chunked to WhatsApp's limit), returning a message id so tool-progress `edit`/`post` modes can update in place — matching `TeamsAdapter.postReply` / `updateActivity`.
- **Auth persistence:** Baileys multi-file auth state is stored under `MCD_CHANNELS_DIR` (mode 0600), so the session survives bot restarts without re-scanning the QR — analogous to how `.session-id` and credentials are persisted today.

Wiring: extend the `platform` zod enum to include `'whatsapp'`, add `else if (platform === 'whatsapp')` branches to the three dispatch sites in `server.ts` (reply, progress, notify), and gate adapter init on a `WHATSAPP_ENABLED`/auth-dir presence check the way Teams gates on `TEAMS_APP_ID`.

> **Note — ToS risk (operator-acknowledged):** Baileys drives an unofficial WhatsApp Web session. This can violate WhatsApp's Terms of Service and risks number bans. Acceptable for a personal/self-hosted operator account; documented prominently. Migrating to the official Cloud API later would only swap the adapter internals, not the dispatch seams.

## Scope

### In Scope
- New `src/whatsapp-adapter.ts` implementing inbound (`messages.upsert` → `InboundEnvelope` → pool) and outbound (`postReply`, `updateActivity`/edit, chunked at WhatsApp limits).
- QR-code pairing flow on first run, **rendered as an image to the master Discord channel**; Baileys multi-file auth persistence under `MCD_CHANNELS_DIR` (mode 0600).
- Extend `platform` enum in `src/channels-config.ts` to `'discord' | 'teams' | 'whatsapp'`, plus a per-project `whatsappJid` binding (the contact this project listens to / replies to).
- Wire the three per-platform dispatch sites in `server.ts` (reply, tool-progress, notify) plus adapter init/gating.
- Per-project routing: each WhatsApp-platform project binds to one contact JID; inbound from that contact routes to that project, replies go back to it.
- Enforce access via the existing `access.allowFrom` list, matching the sender's WhatsApp E.164 number (no separate allowlist).
- `progressMode` (`post`/`edit`) support, parity with Teams.
- `@whiskeysockets/baileys` dependency in `package.json`; docs in `README.md` / `ARCHITECTURE.md` / `CLAUDE.md`.
- Unit tests for the adapter's envelope-building and JID↔chatId mapping (mirroring existing adapter test style).

### Out of Scope
- Official WhatsApp Business Cloud API and Twilio backends (this proposal commits to Baileys; swappable later).
- Inbound media parsing beyond text + attachment summaries (images/voice notes/docs surfaced as summaries only, same as Discord attachments).
- WhatsApp group-chat semantics beyond mapping a chat to one project.
- Refactoring the `if/else` platform dispatch in `server.ts` into a formal adapter registry — tempting, but a separate change; this proposal follows the existing branch pattern.
- Reactions (`OutboundReply` `react` kind) for WhatsApp.

## Impact

- **Files affected:** ~7 (`src/whatsapp-adapter.ts` new, `src/channels-config.ts`, `server.ts`, `package.json`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`)
- **Complexity:** medium
- **Risk:** medium-high (unofficial client ToS / ban risk; Baileys version fragility; QR session lifecycle; new long-lived WebSocket inside the same process as the Discord gateway)

## Resolved Decisions

1. **QR delivery:** Rendered as an image to the **master Discord channel** — operator scans from there, no shell access needed.
2. **Number → project mapping:** **Per-project** — each WhatsApp-platform project binds to one contact JID (`whatsappJid`); inbound from that contact routes to that project.
3. **Access control:** Reuse the existing **`access.allowFrom`** list, matched against the sender's E.164 number. No separate allowlist.
4. **Single vs multi-session:** A **single** Baileys socket for the whole server, multiplexing all WhatsApp projects.

## Open Questions (to settle during planning)

1. **Restart safety:** The bot runs as a tmux subprocess that must never be killed. Adding a second long-lived WebSocket (Baileys) alongside the Discord gateway needs a clean reconnect/teardown path that doesn't interfere with the existing lifecycle — to be designed in `/specclaw:plan`.

---

**To proceed:** Review this proposal and approve to begin planning.
