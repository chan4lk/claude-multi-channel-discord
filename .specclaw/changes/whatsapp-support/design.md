# Design: Add WhatsApp support for MCD

**Change:** whatsapp-support
**Created:** 2026-06-14

## Technical Approach

Introduce `src/whatsapp-adapter.ts`, a `WhatsAppAdapter` class that owns a single Baileys socket and mirrors the public surface MCD already relies on from `TeamsAdapter`:

- Constructor takes `{ authDir, getConfig, onInbound, onQr, onNotice }`.
- `start()` opens the Baileys connection with `useMultiFileAuthState(authDir)`, wires `connection.update` (QR + reconnect lifecycle) and `messages.upsert` (inbound).
- `postReply(chatId, text, replyTo?) => Promise<MsgKey | null>` — resolve `chatId → whatsappJid`, chunk, send.
- `updateActivity(chatId, msgKey, text)` — edit an existing message in place (Baileys `{ text, edit: key }`).
- `stop()` — clean socket teardown for shutdown.

`server.ts` gains a `whatsappAdapter` singleton, gated like Teams, a `handleWhatsAppInbound` mirroring `handleTeamsInbound`, and a third branch at each of the three dispatch sites.

The QR flow reuses discord.js: the adapter emits the QR string via `onQr`, `server.ts` renders it to a PNG with `qrcode`, and posts/updates it in the master Discord channel.

## Architecture

```
                       ┌─────────────────────────────────────────┐
WhatsApp (phone) ⇄ WSS │ WhatsAppAdapter (single Baileys socket)  │
                       │   • multi-file auth (MCD_CHANNELS_DIR)    │
                       │   • connection.update → onQr / reconnect  │
                       │   • messages.upsert → onInbound           │
                       │   • postReply / updateActivity            │
                       └───────────────┬───────────────┬──────────┘
                          onInbound     │               │ postReply / updateActivity
                                        ▼               ▲
   onQr ──► server.ts renders QR ► master Discord channel
                                        │               │
                                        ▼               │
   handleWhatsAppInbound: JID→chatId, allowFrom check,  │
   build InboundEnvelope ──► ProjectPool.deliver        │
                                        │               │
                                        ▼               │
                              ClaudeProjectProcess ──────┘
                              (onReply / tool-progress / notify
                               dispatched by platform === 'whatsapp')
```

Routing tables (in-adapter): `jid → chatId` (built from config projects where `platform==='whatsapp'`, keyed by `whatsappJid`) and its inverse `chatId → jid`. Rebuilt on each `getConfig()` read so config edits are picked up.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `package.json` | modify | Add pinned `@whiskeysockets/baileys` and `qrcode` deps |
| `src/channels-config.ts` | modify | Add `'whatsapp'` to `platform` enum; add optional `whatsappJid`; refine-validate that `whatsappJid` is present when `platform==='whatsapp'` |
| `src/whatsapp-adapter.ts` | create | `WhatsAppAdapter`: connection lifecycle, auth persistence, inbound parsing, `postReply`/`updateActivity`, chunking, reconnect/teardown |
| `src/whatsapp-adapter.test.ts` | create | Unit tests: inbound envelope + JID→chatId mapping, allowFrom denial, chunking |
| `server.ts` | modify | Init/gate adapter; `handleWhatsAppInbound`; QR→master-channel render; add `whatsapp` branch to `onReply`, `routeNotification`, `handleToolProgress` |
| `README.md` | modify | WhatsApp setup (QR pairing), ToS warning |
| `ARCHITECTURE.md` | modify | Adapter contract + single-socket lifecycle notes |
| `CLAUDE.md` | modify | Platform list, state-file layout (`whatsapp-auth/`), ToS warning |

## Data Model Changes

`channels.json` — `ProjectSchema` gains:

```jsonc
"platform": "whatsapp",          // enum extended
"whatsappJid": "<e164>@s.whatsapp.net"  // new optional; required iff platform==='whatsapp'
```

State files — new `MCD_CHANNELS_DIR/whatsapp-auth/` directory (Baileys multi-file state, mode 0600).

No change to `InboundEnvelope` shape — `userId` carries the sender E.164, `attachments` carries media summaries. (The `messageId` field doc comment is Discord-centric but the field is reused for the WhatsApp message key; update the comment to be platform-neutral.)

## API Changes

Internal only. New `WhatsAppAdapter` class (see Technical Approach). `server.ts` dispatch branches:

```ts
} else if (platform === 'whatsapp' && whatsappAdapter) {
  whatsappAdapter.postReply(reply.chatId, reply.text, reply.replyTo).catch(...)
}
```
at `onReply`, `routeNotification`, and `handleToolProgress` (the last gets a `handleToolProgressWhatsApp` analogous to `handleToolProgressTeams`).

## Key Decisions

- **Baileys over whatsapp-web.js** — pure WebSocket, no Chromium/Puppeteer; fits the headless `bun` server. Pinned to absorb breaking releases.
- **Single socket, multiplexed** — one WhatsApp account; projects keyed by bound contact JID. Simpler lifecycle than a socket per project; matches "per-project routing" decision.
- **Reuse `access.allowFrom`** — no new allowlist; match sender E.164. Consistent with existing access model.
- **QR to master Discord channel** — operator pairs without shell access; reuses discord.js send + `qrcode` PNG.
- **Follow the existing `if/else` dispatch pattern** — do NOT refactor into an adapter registry in this change (Rule 2: simplicity first). The registry is a worthwhile but separate refactor.
- **`whatsappJid` validated by zod `superRefine`** — keeps the required-when-whatsapp rule in the schema, not scattered in runtime checks.

## Risks & Mitigations

- **ToS / number ban (medium-high)** — unofficial client. Mitigation: prominent docs; personal account only; adapter isolated for easy Cloud-API swap later.
- **Baileys version churn (medium)** — frequent breaking releases. Mitigation: pin exact version; isolate all Baileys types/calls inside `whatsapp-adapter.ts`.
- **Second long-lived socket in the tmux subprocess (medium)** — must not destabilize the Discord gateway or trigger a respawn. Mitigation: independent reconnect/backoff; all socket errors caught; `stop()` for clean teardown; never throw to top level.
- **QR rotation spam (low)** — mitigation: update the existing master-channel QR message in place rather than posting new ones.
- **Message-edit unsupported / message deleted (low)** — mitigation: `edit` falls back to a fresh send, mirroring Teams.
