# Verify Report: handoff-chains

**Verdict:** PASS

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — 3-step chain fires step 1 with `#h-<id>`, `#c-<id>`, `step 1/3`; returns `{ ok, chain_id, id }`; persists active chain cursor 0 | ✅ Met | `src/master-mcp-server.test.ts:1134-1143` — PASS `AC1: chain create ok with chain_id + step-1 id`, `AC1: envelope tags chain + step + handoff id`, `AC1: chain active, cursor 0` |
| AC2 — `handoff_complete` on step 1 fires step 2 with prior outcome (≤500) + posts `⛓ … 1/3 done` to source | ✅ Met | `src/master-mcp-server.test.ts:1147-1159` — PASS `AC2: cursor advanced to 1`, `AC2: prior outcome carried (≤500)`, `AC2: ⛓ progress posted to source`; truncation via `priorOutcome.slice(0, 500)` in `fireChainStep` |
| AC3 — bot-peer ack path (`acknowledgeHandoffs`) advances identically | ✅ Met | `server.ts:2256-2261` wires `acknowledgeHandoffs(...)` → `masterMcp.advanceChainsForClosed(handoffAckIds)`; advance path exercised via the same public API in `src/master-mcp-server.test.ts:1161-1165` (close-then-advance, simulating the bot-ack flow) |
| AC4 — final close marks chain `done`, posts completion, no further handoff | ✅ Met | `src/master-mcp-server.test.ts:1190-1195` — PASS `AC4: final close completes chain`, `AC4: ✅ completion post to source` |
| AC5 — approve gate: `"rejected: tests fail"` halts + escalates with excerpt; `"Approved — LGTM"` advances | ✅ Met | `src/master-mcp-server.test.ts:1164-1187` — PASS `AC5: gate failure halts chain`, `AC5: master escalation names step + outcome excerpt`, `AC5: no step 3 fired after halt`, `AC5: approve outcome advances gated step`; gate pure in `nextChainAction` (trim/lowercase/startsWith, empty fails) |
| AC6 — over-budget chain refused, nothing written | ✅ Met | `src/master-mcp-server.test.ts:1113-1121` — PASS `AC6: 7-step chain over default budget 6 → isError` ("hop budget" in message), `AC6: refusals wrote nothing`; budget from `effectivePeerLimits(...).maxHops` in `startChain` |
| AC7 — sweep expiry of a chain step expires the chain; master escalation names chain id + step + target | ✅ Met | `server.ts:1697-1704` `onExpired` hook calls `expireChain(record.chainId, …)` and returns `⚠️ chain #<id> expired at step n/N (<target>) — handoff #<id> unanswered`; consumed in `src/scheduler.ts` escalate branch (code-verified; see Issues 2) |
| AC8 — unresolvable mid-chain step halts + escalates; close call still returns ok | ✅ Met | `src/master-mcp-server.test.ts:1197-1207` — PASS `AC8: close call still ok when advance fails`, `AC8: unresolvable step halts chain`, `AC8: master ⚠ names the step`; plus PASS `chain: disabled mid-chain target halts` |
| AC9 — `!project collab` shows chains with per-step glyphs; output unchanged when no chains | ✅ Met | `src/master-commands.test.ts:2096-2099` — PASS `collab chains: active chain row with glyphs` (`[✔▶·] 1/3 done`), `halted chain marked with reason`, `done chain omitted`, `other project chain omitted`; section only appended when `openChains.length > 0` |
| AC10 — legacy bare-array loads; v2 round-trips after first save; corrupt fail-opens empty | ✅ Met | `src/handoffs.test.ts:238-299` — PASS `corrupt file → empty registry`, `migrate: legacy array → handoffs`, `migrate: first save writes v2`, `migrate: v2 round-trips`, `migrate: legacy saveRegistry preserves chains` |
| AC11 — all existing suites pass unchanged; `bun tsc --noEmit` clean | ✅ Met | Ran locally: handoffs, master-mcp-server, master-commands, scheduler, project-pool, bot-peers, shared-learnings, backlog, orphan-sweep all green; tsc clean |

## Non-Functional Requirements

- **NFR1 (registry v2, backward-compat, single atomic file):** Met — `RegistryFileV2` + `loadRegistryFile()` legacy-array migration; `saveRegistryFile` is one tmp+rename write; chain create/advance are single writes (`createChain`, `advanceChainStep`).
- **NFR2 (pure state machine, injectable clock):** Met — `nextChainAction` / `validateChainSteps` pure in `src/handoffs.ts`; `Date.now()` only as default arg; delivery side effects confined to `MasterMcpServer` (`fireChainStep`, `postChainNotice`).
- **NFR3 (single-hop invariant):** Met — `HandoffRecord` gains only optional `chainId?`/`chainStep?`; non-chain path still enforces `message is required`; PASS `NFR3: single hop carries no chain fields`; all pre-existing suites pass unchanged.
- **NFR4 (idempotent transitions):** Met — `stepHandoffIds[cursor] !== closedId` latch in `advanceOneChain`, `nextIndex !== cursor + 1` latch in `advanceChainStep`, active-only `closeChain`; PASS `NFR4: re-advance of stale closed id is a no-op`, `advance: double-advance latch → null`.
- **NFR5 (tests):** Met — 28 new chain checks in `src/handoffs.test.ts`, chain block in `src/master-mcp-server.test.ts:1051-1232`, collab-chain checks in `src/master-commands.test.ts`; all plain bun PASS/FAIL scripts per `.specclaw/context.md`.

## Test/Lint/Build Gates

- `bun src/handoffs.test.ts` — ✅ (incl. 28 chain/migration checks)
- `bun src/master-mcp-server.test.ts` — ✅
- `bun src/master-commands.test.ts` — ✅
- `bun src/scheduler.test.ts` — ✅
- `project-pool`, `bot-peers`, `shared-learnings`, `backlog`, `orphan-sweep` — ✅
- `bun tsc --noEmit` — ✅ clean
- ⚠️ Payload-embedded gates were empty/mis-pointed (changed-files empty because the branch was already merged when evidence was collected; build log was the apps/mission-control Next.js build). All gate evidence above regenerated directly in this repo (read-only).

## Issues Found

1. **Verification payload capture gap (tooling, not implementation)** — vctx changed-files section empty; gates re-run locally against the merged implementation instead.
2. **AC7 has no dedicated automated test** — the sweep→`expireChain`→escalation wiring lives in `server.ts` glue (consistent with the codebase pattern of not unit-testing `server.ts`); `expireChain` itself is tested (`expire: state + reason`). Code-verified; non-blocking.
3. **Cosmetic glyph nuance** — a chain halted at *next-step resolution* (cursor never advanced) renders `✖` on the step that actually completed. Does not violate AC9 (glyphs + halt reason both shown); possible follow-up.

## Notes

- Project rules from `.specclaw/context.md` respected: reach stays behind the per-project `handoff` flag; high-churn chain state lives in `shared/handoffs.json`, never `channels.json`; defense-in-depth gate checked at list and call; injectable clock/loaders (`loadChainRegistry` DI for tests); plain bun test scripts.
- FR10 docs delivered: CLAUDE.md "Handoff chains (work-graph layer)" paragraph, README chains bullet, docs/commands.md collab wording, `handoff` tool description documents `chain`.
- Spec deviations recorded in the spec itself (per-step sweep expiry instead of a whole-chain clock; chain prune mirrors handoff prune) are implemented as documented (`pruneClosedChains`).
