# Verify Report: claude-ai-connector
**Date:** 2026-07-28
**Verdict:** PASS

## Gate Results

| Gate | Result | Evidence |
|------|--------|----------|
| `bun tsc --noEmit` | PASS | No type errors |
| `cd apps/mission-control && bun run build` | PASS | Next.js build output, 204 pages generated |
| `bun src/master-mcp-server.test.ts` | PASS | "all checks passed" |
| `bun src/master-commands.test.ts` | PASS | 271 PASS lines, "all checks passed" |
| `bun src/project-pool.test.ts` | PASS | passes |
| `bun src/bot-peers.test.ts` | PASS | passes |
| `bun src/scheduler.test.ts` | PASS | passes |

## Acceptance Criteria

- **AC1 — met.** No `externalToken` in config: existing tests (`POST /mcp/<id> without token → 401`, `POST /mcp/<id> with bad token → 401`) pass unmodified. `master-mcp-server.test.ts:41-46` covers both paths; the external-token test block uses a separate server instance and does not interfere with the baseline suite.

- **AC2 — met.** `master-mcp-server.test.ts:1281-1290`: `extList` confirms external token accepted on `EXT_PROJECT` (tools/list returns array); `crossChat` confirms same token rejected with 401 on `EXT_OTHER`. Token scoping enforced in `master-mcp-server.ts:251` — `getConfig?.()?.projects[chatId]?.externalToken` is keyed by the request's chatId.

- **AC3 — met.** `master-mcp-server.test.ts:1292-1294`: `localList` issued with `serverExt.tokenFor(EXT_PROJECT)` (per-boot token) against a project that also has `externalToken` set → tools array returned. Both token paths converge in `tokenSource()` (`master-mcp-server.ts:249-252`) — local checked first, external second.

- **AC4 — met** (401 verified; `rejected` log line present in code — `master-mcp-server.ts:289` — but the wrong-token test asserts status only; minor coverage gap, see Notes).

- **AC5 — met.** `master-mcp-server.test.ts:1301-1306`: external token on `EXT_DISABLED` → 403 with body containing `target project is disabled`; local token on same project → tools/list succeeds. Gate at `master-mcp-server.ts:297-300` checks `disabled` only after `authSource === 'external'` — local requests fall through unchanged.

- **AC6 — met.** `master-mcp-server.test.ts:1285-1286`: `extLogs.some((l) => l.includes('external request') && l.includes(EXT_PROJECT))` asserted. Code at `master-mcp-server.ts:303`.

- **AC7 — met.** `master-commands.test.ts:1178-1207`: `rotate --yes` persists a `[0-9a-f]{64}` token (`randomBytes(32).toString('hex')`, `master-commands.ts:1036`); reply contains the token value and `/mcp/999888777666555444`; second rotate produces a different token.

- **AC8 — met.** `master-commands.test.ts:1148-1162`: `rotate` without `--yes` refused; config unchanged. Gate at `master-commands.ts:805-806`.

- **AC9 — met.** `master-commands.test.ts:1220-1235`: `none` succeeds without `--yes`; field removed from config.

- **AC10 — met.** Two layers: command refusal (`master-commands.ts:800-802`, tested `master-commands.test.ts:1251-1265`) and server-side defense in depth (`master-mcp-server.ts:252` — hand-edited master `externalToken` never authenticates, tested `master-mcp-server.test.ts:1308-1310`).

- **AC11 — deferred (post-deploy, manual).** `README.md:358-404` contains the complete Caddyfile snippet, `MCD_MCP_PORT` usage, and claude.ai connector registration steps. Live registration in the claude.ai UI is a post-deploy operator action per tasks.md — not a gate on this verdict.

## Context Rules Compliance

| Rule | Status |
|------|--------|
| Per-project opt-in reach grants require `--yes` | Respected — `rotate` requires `--yes` (matches `--hermes on`); `none` does not (matches `--bot-peers none`). |
| Gate checks return source discriminators | Respected — `tokenSource()` returns `'local' \| 'external' \| null`. |
| Defense in depth | Respected — `tokenSource()` runs at the single HTTP entry point before tool dispatch; the master guard lives inside it, enforced per request. |
| Operator-owned config in `channels.json` | Respected — `externalToken` on `ProjectSchema`, written via `saveConfig`, reread per request via injected `getConfig`. |

## Notes

- **AC4 log-line assertion gap:** the code emits `rejected /mcp/<chatId>: missing or bad x-mcd-token` on every auth failure, but the wrong-external-token test asserts only the 401 status, not the log. Minor test-coverage gap; the same `log()` wiring is proven by the AC6 assertion on the same server instance.
- **Schema `min(16)` vs 64-char minted token:** intentional — schema tolerates hand-edited shorter tokens; the operator command always mints 64-hex.
- **AC5 shape:** HTTP 403 carrying a JSON-RPC-shaped error body (`target project is disabled`) — satisfies the spec's "JSON-RPC error refusing the request".
- **AC11** remains open until the operator registers the connector post-deploy (watch for 405-on-GET tolerance).
