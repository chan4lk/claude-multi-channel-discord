# Tasks: Handoff chains (work-graph layer)

**Change:** handoff-chains
**Created:** 2026-07-28
**Total Tasks:** 6

## Summary

Registry + pure state machine first, then MCP-server orchestration, then server/scheduler wiring and collab view, docs last. Waves strictly ordered — each layer's tests gate the next.

## Tasks

### Wave 1 — Registry v2 + chain state machine

- [x] `T1` — `src/handoffs.ts`: v2 envelope + chain records + pure decisions
  - Files: `src/handoffs.ts`
  - Estimate: medium
  - Kind: impl
  - Notes: `RegistryFileV2` load/save with legacy bare-array migration; `loadRegistry`/`saveRegistry` become thin `.handoffs` wrappers (zero caller changes). `ChainRecord`/`ChainStep`, `createChain`, `nextChainAction` (pure, gate = trimmed case-insensitive `approve` prefix), `haltChain`, `expireChain`, chain prune (30d/200 closed). `HandoffRecord` gains optional `chainId`/`chainStep`. Injectable `nowMs` throughout, `Date.now()` only as default arg.

- [x] `T2` — chain state machine + migration tests
  - Files: `src/handoffs.test.ts` (extend existing suite if present, else create)
  - Estimate: medium
  - Kind: test
  - Depends: T1
  - Notes: bun PASS/FAIL. Cover: legacy→v2 migration round-trip + corrupt fail-open (AC10), advance/complete/halt-gate decisions incl. empty-outcome-fails-gate, idempotent re-close no-op, chain prune, 1-step degenerate chain.

### Wave 2 — MCP server orchestration

- [x] `T3` — `handoff` chain arg + `advanceChainsForClosed`
  - Files: `src/master-mcp-server.ts`
  - Estimate: large
  - Kind: impl
  - Depends: T1
  - Notes: validate `chain` (2+ steps allowed, 1 tolerated; exactly one of role/target per step; mutually exclusive with top-level target_slug/role/message; hop budget via `effectivePeerLimits` fallback 6; self-target refusal; nothing persisted on refusal). Extract `fireHandoff(target, body, sourceChatId, sourceSlug)` from the existing case (project envelope + visibility post vs bot-peer mention). Step bodies: step 1 `[chain #c-<id> step 1/N from <slug>] <task> #h-<id>`; later steps add `prior outcome: "<≤500>"`. Public `advanceChainsForClosed(ids)`: nextChainAction → fire-time `resolveCollabTarget`/slug resolution (fail ⇒ haltChain + master ⚠️, FR7/AC8) → createHandoff+fireHandoff or done; progress `⛓`/`✅` posts to `sourceChatId` via onReply; gate halt master escalation with ≤120-char outcome. Call from `handoff_complete` after successful pending→done transition only. Tool description documents `chain`.

- [x] `T4` — MCP server chain tests
  - Files: `src/master-mcp-server.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T3
  - Notes: AC1 (create+fire step 1, tags, return shape), AC2 (advance on complete, prior-outcome carry), AC5 both gate outcomes, AC6 budget refusal writes nothing, AC8 resolution failure halts but tool returns ok, disabled-target halt, double-close no double-advance (NFR4). Mock pool/onReply/config per existing suite patterns.

### Wave 3 — Wiring + collab view + docs

- [x] `T5` — server ack path + sweep chain expiry + collab rows
  - Files: `server.ts`, `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T3
  - Notes: server.ts bot-ack path (`server.ts:2248`) → `await mcpServer.advanceChainsForClosed(handoffAckIds)` (AC3); sweep escalate callback checks `record.chainId` → `expireChain` + chain-flavored master message naming step (AC7) — scheduler.ts untouched per design decision 5. `handleCollab`: open (active/halted) chain rows with per-step glyphs `✔ ▶ · ✖` + age (AC9), injected registry loader keeps tests filesystem-free.

- [x] `T6` — docs
  - Files: `CLAUDE.md`, `README.md`, `docs/commands.md`
  - Estimate: small
  - Kind: docs
  - Depends: T5
  - Notes: chain arg + lifecycle + gate/budget semantics in CLAUDE.md collab section; command docs for collab chain rows; README feature note.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
