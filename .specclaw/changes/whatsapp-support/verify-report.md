# Verify Report: whatsapp-support

**Verdict:** PASS
**Date:** 2026-06-14

## Acceptance Criteria

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 | PASS* | `bun tsc --noEmit` produced no output (exit 0). All three pre-existing test suites pass. The single failing check in `master-mcp-server.test.ts` (`GET /mcp/abc → 404 (non-numeric chat_id)`) is confirmed pre-existing — `git log --oneline -- src/master-mcp-server.ts src/master-mcp-server.test.ts` shows the last touch was commit `04162f8` (Teams `@`-regex fix), with zero commits from the whatsapp-support branch touching those files. See Notes. |
| AC2 | PASS | `bun -e "..."` against `ChannelsConfigSchema`: (a) `platform:'whatsapp'` + valid `whatsappJid` → `safeParse` returns `success:true`. (b) `platform:'whatsapp'` with no `whatsappJid` → fails with error message `"whatsappJid is required when platform is 'whatsapp'"` at path `projects.<chatId>.whatsappJid`. Schema enforced via `superRefine` at `channels-config.ts:107-113`. |
| AC3 | PASS | Test cases `AC3 text` (8 checks) and `AC3 image` (3 checks) — all 11 PASS in `bun src/whatsapp-adapter.test.ts`. |
| AC4 | PASS | Test case `AC4 blocked sender: onInbound NOT called` — PASS. Adapter's `_handleUpsert` calls `this.opts.isAllowed(e164)`; when it returns `false`, the loop `continue`s without calling `onInbound`. |
| AC5 | PASS | Test cases `AC5 long text: sendMessage called 3 times` (9000/4000 = 3 chunks) and `AC5 short text: sendMessage called once` — both PASS. `WA_CHUNK_SIZE = 4000`. |
| AC6 | PASS | WhatsApp init gated at `server.ts`: `if (existsSync(WHATSAPP_AUTH_DIR) \|\| process.env.WHATSAPP_ENABLED === '1')`. All three dispatch branches are `else if (platform === 'whatsapp' && whatsappAdapter)` after the teams branch; the `&& whatsappAdapter` guard ensures a null adapter never enters the WhatsApp path. Discord/Teams projects never match. |

## Test Evidence

```
bun tsc --noEmit                  → (no output, exit 0)
bun src/whatsapp-adapter.test.ts  → 33/33 checks passed
bun src/master-commands.test.ts   → 51/51 checks passed
bun src/project-pool.test.ts      → 35/35 checks passed
bun src/master-mcp-server.test.ts → 6 pass, 1 FAIL (GET /mcp/abc → 404, PRE-EXISTING)
```

## Notes & Caveats

**Pre-existing `master-mcp-server.test.ts` failure:** `GET /mcp/abc → 404 (non-numeric chat_id)` predates this change. Last commits to touch those files are `04162f8` and older — none of the whatsapp-support commits (`172f700`–`67d3435`) modified them. Not a regression.

**`isAllowed` wiring:** `server.ts` wires `isAllowed` as `(senderId) => loadAccess().allowFrom.includes(senderId)`. The sender E.164 must appear in `access.json`'s `allowFrom` array — operators must add their WhatsApp number there before use.

**Unit-test approach:** `whatsapp-adapter.test.ts` exercises `_handleUpsert` and `postReply`/`updateActivity` directly without a live Baileys socket — correct for unit testing.

## Verdict Rationale

All six acceptance criteria are met by the actual implementation. `bun tsc --noEmit` passes cleanly; schema enforcement, inbound envelope construction, access gating, outbound chunking, and the AC6 server-level guard are all verified against live code and live test output. The single `master-mcp-server.test.ts` failure is confirmed pre-existing and unrelated to this change.
