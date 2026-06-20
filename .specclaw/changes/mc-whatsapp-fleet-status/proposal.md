# Proposal: WhatsApp Fleet Status

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The dashboard has no visibility into WhatsApp adapter state. When `WHATSAPP_ENABLED` is set (shipped in PR #48), operators cannot see whether the Baileys socket is connected, how many WhatsApp-platform projects are active, or when a QR code pairing event is in progress — without checking tmux logs directly. The Fleet Health Bar has no WhatsApp dimension.

## Proposed Solution

Add a `WhatsAppStatus` indicator to the Fleet Health Bar. The indicator is hidden when WhatsApp is not configured; visible otherwise. A `/api/whatsapp-status` endpoint reads:

1. Whether `whatsapp-auth/` exists under `MCD_CHANNELS_DIR` (to determine if WhatsApp is enabled)
2. The `channels.json` project list filtered to `platform: "whatsapp"` entries (to count active projects)
3. The MCD event stream for recent `whatsapp:connected`, `whatsapp:disconnected`, and `whatsapp:qr` events (to determine connection state)

**States:**
- 🟢 Connected — socket live, last heartbeat < 60s
- 🔴 Disconnected — socket dropped or no recent heartbeat
- 🟡 Pairing — `whatsapp:qr` event seen in last 90s; renders a banner with "Scan QR within Xs" countdown

**QR banner:** when a QR event is detected, a dismissible banner appears at the top of the feed section with a "scan now" timer.

### Architecture

- `apps/mission-control/app/api/whatsapp-status/route.ts` — checks filesystem + recent events DB
- Fleet Health Bar extended with WhatsApp badge (only rendered when WhatsApp enabled)
- QR banner injected into `app/page.tsx` when `qrPending` state true

## Acceptance Criteria

- AC1: WhatsApp badge visible in header only when `whatsapp-auth/` dir exists or `WHATSAPP_ENABLED=1` env set
- AC2: Badge shows: connected (green) / disconnected (red) / pairing (amber pulsing)
- AC3: Active WhatsApp project count shown on badge; clicking filters Instance Grid to WA projects
- AC4: QR code event renders a banner with a 60s countdown timer; dismissible
- AC5: Badge hidden (zero space) when WhatsApp not configured
- AC6: Status updates every 15s
