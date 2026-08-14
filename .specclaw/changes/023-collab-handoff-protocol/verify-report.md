# Verify Report: collab-handoff-protocol

**Date:** 2026-07-26
**Verdict:** PASS

## Gate Results

| Gate | Result |
|------|--------|
| `bun tsc --noEmit` | PASS — zero errors |
| `bun src/handoffs.test.ts` | PASS — 44/44 checks |
| `bun src/handoff.test.ts` | PASS — 12/12 checks |
| `bun src/master-mcp-server.test.ts` | PASS — 0 FAIL lines (includes AC1/AC2/AC3 explicit labelled checks) |
| `bun src/master-commands.test.ts` | PASS — 0 FAIL lines (includes AC6/AC7 explicit labelled checks) |
| `bun src/bot-peers.test.ts` | PASS — 0 FAIL lines (includes AC4 ack exemption checks) |
| `bun src/scheduler.test.ts` | PASS — HS1–HS7 all pass (AC5 sweep) |
| `bun src/shared-learnings.test.ts` | PASS |
| `bun src/project-pool.test.ts` | PASS |
| e2e | not configured — no AC depends on browser e2e |

## Acceptance Criteria

- ✅ **AC1:** `handoff` with `target_slug` (internal) creates a pending registry record and the target envelope contains `#h-<id>`. — `master-mcp-server.test.ts`: "AC1: pool.deliver hit target chat", "AC1: envelope content contains #h-<id>", "AC1: registry record pending, kind=project, to.chatId=target" — all PASS.
- ✅ **AC2:** `handoff` with `role: "reviewer"` (role → bot-peer id) posts `<@id> [handoff #h-<id> …]` to the source channel and records `to.kind === 'botPeer'`. — `master-mcp-server.test.ts`: "AC2: mention posted to SOURCE channel" (exact mention text), "AC2: registry record kind=botPeer, to.chatId=source channel" — all PASS.
- ✅ **AC3:** `handoff_complete`: target ok / stranger refused / master ok. — `master-mcp-server.test.ts` AC3 checks all PASS. Defense-in-depth: `handoffCompleteAccess` in listing + record-level `to.chatId` check at call time.
- ✅ **AC4:** Pending `#h-<id>` bot message → done + no consecutive-counter increment; unmatched → normal counting. — `bot-peers.test.ts`: "ack: exemption — counter not incremented", "ack: unmatched message incremented counter → next hits limit" — PASS. Wiring at `server.ts:2248–2302`.
- ✅ **AC5:** Exactly one nag at timeout, one master escalate + `expired` at 2×, sweep idempotent across re-runs. — `scheduler.test.ts` HS1–HS7 PASS (incl. HS3/HS5 no-duplicate re-run checks); `handoffs.test.ts` sweep idempotence suite PASS.
- ✅ **AC6:** `--collab-role reviewer=nosuch` refused; valid slug persists; `none` removes. — `master-commands.test.ts` explicit checks PASS.
- ✅ **AC7:** `collab <slug>` lists roles (stale-marked) + open handoffs; friendly empty states. — `master-commands.test.ts` checks PASS.
- ✅ **AC8:** Registry survives restart — write-then-reload survival checks (all fields incl. `naggedAt`, `botPeer.botId`) PASS in `handoffs.test.ts`.
- ✅ **AC9:** `bun tsc --noEmit` clean; all 9 test suites pass with 0 FAIL lines.

## Edge Cases

| Edge case | Status | Evidence |
|-----------|--------|----------|
| Disabled target → refused, no record | covered | `master-mcp-server.test.ts` disabled-target checks; disabled check precedes `createHandoff` |
| Stale role value → tool errors, verb flags `(stale)` | covered | `master-commands.test.ts` stale-mark check; `channels-config.ts` error names value |
| Duplicate complete → idempotent ok | covered | AC3 duplicate check + `handoffs.test.ts` duplicate suite |
| Corrupt handoffs.json → empty + clean rewrite | covered | `handoffs.test.ts` corruption suite |
| Two pending ids in one message → both closed, single delivery | covered | `bot-peers.test.ts` two-ids checks |
| Roles present, handoff flag off → tool hidden, verb read-only works | covered | `master-commands.test.ts` + `handoff.test.ts` listing checks |

## Context Rules Compliance

- **Defense-in-depth on MCP tool gates:** compliant — `handoffSource()` and `handoffCompleteAccess()` checked in both listing and call handler; record-level ownership enforced at call time.
- **Injectable side effects:** compliant — injectable `nowMs` clock in registry, injected sweep/notify deps in scheduler, tests use temp `MCD_CHANNELS_DIR` + mock pools.
- **Per-project opt-in reach:** compliant — `handoff` off by default; `collab.roles` grants no reach; `handoff_complete` broad listing is safe (no lateral reach) with strict call-time ownership.

## Notes

- **v1 timeout limitation (documented):** the sweep applies `defaults.collab.timeoutMinutes` (built-in 30) for all handoffs; per-project `collab.timeoutMinutes` is schema-valid and honored in tool paths but not consulted by the sweep (`scheduler.ts` comment). Logged as learning L8.
- Bot-peer records store `to.chatId` = source channel by design (peers share the project channel, FR2).
- No e2e configured; no AC requires live-Discord evidence.
