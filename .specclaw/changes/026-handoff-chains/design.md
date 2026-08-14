# Design: Handoff chains (work-graph layer)

**Change:** handoff-chains
**Created:** 2026-07-28

## Technical Approach

Three layers, mirroring how PR #318 split the single-hop feature:

1. **Registry + state machine (`src/handoffs.ts`, pure-ish):** registry file upgraded to a v2 envelope holding both handoffs and chains; chain lifecycle decisions are pure functions with injectable clocks.
2. **Delivery + orchestration (`src/master-mcp-server.ts`):** the existing `handoff` case's delivery code (project envelope vs bot-peer mention) is extracted into a private `fireHandoff(target, body, sourceSlug)` helper. A new public `advanceChainsForClosed(ids)` method runs the state machine for closed step ids and performs next-step delivery, progress posts, and master escalations. Both the `handoff_complete` tool case and the server's bot-ack path call it.
3. **Wiring (`server.ts`, `src/scheduler.ts`):** the bot-ack path passes `acknowledgeHandoffs` results into `advanceChainsForClosed`; the handoff sweep maps expired step records with a `chainId` to chain expiry + a chain-flavored master escalation.

## Architecture

```
handoff({chain:[s1,s2,s3]})
  └─ validateChain (shape, budget, self-target) → createChain + createHandoff(s1) → fireHandoff(s1)
        one atomic registry save: {chain active cursor:0, h1 pending(chainId,step:0)}

close of h1 (either path)
  ├─ handoff_complete tool ──┐
  ├─ acknowledgeHandoffs ────┤→ advanceChainsForClosed([h1.id])
  │   (server.ts bot path)   │     ├─ nextChainAction(chain, h1, outcome)   [pure]
  │                          │     │     'halt-gate' → chain halted, master ⚠️
  │                          │     │     'complete'  → chain done, source ✅
  │                          │     │     'advance'   → resolve s2 (fire-time)
  │                          │     │           ├─ resolve fails → chain halted, master ⚠️
  │                          │     │           └─ ok → createHandoff(s2, chainId, step:1) + fireHandoff
  │                          │     └─ source-channel progress post ⛓
  └─ sweep expiry (scheduler) → record.chainId? → expireChain + master ⚠️ naming step
```

### Registry format v2 (`shared/handoffs.json`)

```ts
interface RegistryFileV2 { version: 2; handoffs: HandoffRecord[]; chains: ChainRecord[] }
// legacy: bare HandoffRecord[] — loadRegistryFile() migrates on read, v2 written on first save

interface ChainStep { role?: string; target?: string; task: string; gate?: 'approve' }
interface ChainRecord {
  id: string                 // "c-<base36ts>-<hex4>"
  from: string               // source slug ('master' allowed, same as handoffs)
  sourceChatId: string       // for progress posts
  steps: ChainStep[]
  cursor: number             // index of the currently-fired step
  stepHandoffIds: string[]   // handoff id per fired step (length = cursor+1 while active)
  state: 'active' | 'done' | 'halted' | 'expired'
  createdAt: string
  closedAt?: string
  closeReason?: string       // gate-failed / resolution error / expired-step detail
}
```

`HandoffRecord` gains optional `chainId?: string; chainStep?: number` — absent on single hops (NFR3).

### Pure decision functions (`src/handoffs.ts`)

- `nextChainAction(chain, closedStepIndex, outcome)` → `{ kind: 'halt-gate' } | { kind: 'complete' } | { kind: 'advance', nextStep, nextIndex }` — gate check: `outcome?.trim().toLowerCase().startsWith('approve')`.
- `loadRegistryFile(): RegistryFileV2` / `saveRegistryFile(file, nowMs)` — supersede the bare-array load/save internally; existing `loadRegistry()`/`saveRegistry()` stay as thin wrappers over `.handoffs` so every current caller (master-commands `handleCollab`, matchers, sweep) compiles untouched.
- Chain prune inside save: closed chains share the 30-day/200-entry policy.
- `sweepHandoffs` unchanged in signature; expired records now carry `chainId` through the returned action so the caller can expire the owning chain via new `expireChain(chainId, reason, nowMs)`.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/handoffs.ts` | modify | v2 file envelope + migration, `ChainRecord`/`ChainStep`, `createChain`, `nextChainAction`, `expireChain`, `haltChain`, `completeChainStep` helpers; wrappers keep old API |
| `src/handoffs.test.ts` (or existing suite location) | modify/create | state machine, migration, prune, idempotency tests |
| `src/master-mcp-server.ts` | modify | `chain` arg validation on `handoff`; extract `fireHandoff`; new `advanceChainsForClosed(ids)`; call it from `handoff_complete`; tool description update |
| `src/master-mcp-server.test.ts` | modify | chain creation, advance-on-complete, gate halt, fire-time resolution failure, budget refusal |
| `server.ts` | modify | bot-ack path: pass `acknowledgeHandoffs` ids into `advanceChainsForClosed`; sweep escalate callback: chain-flavored message when `record.chainId` |
| `src/scheduler.ts` | modify | pass-through only: sweep action already carries the record; add `expireChain` call + chain escalation text (or delegate both to the server callback — see decision 5) |
| `src/master-commands.ts` | modify | `handleCollab`: open-chain rows with per-step glyphs |
| `src/master-commands.test.ts` | modify | collab chain rendering via injected registry loader |
| `CLAUDE.md`, `README.md`, `docs/commands.md` | modify | chain docs |

## Data Model Changes

- `shared/handoffs.json`: bare array → `{ version: 2, handoffs, chains }`; read-compatible with legacy, one-way upgrade on first save. High-churn runtime state stays out of `channels.json` (context.md rule).
- No `channels.json` schema changes.

## API Changes

- `mcp__mcd__handoff`: new optional `chain` input (array of step objects). Mutually exclusive with `target_slug`/`role`/`message`. Return adds `chain_id` when chained.
- `mcp__mcd__handoff_complete`: unchanged surface; side effect may now advance a chain.
- `MasterMcpServer.advanceChainsForClosed(ids: string[]): Promise<void>` — new public method for `server.ts`'s ack path.

## Key Decisions

1. **One file, one atomic write per transition.** Close-step + create-next + move-cursor persists as a single tmp+rename of the v2 envelope — a crash can leave a step pending (sweep recovers with a nag) but never a half-advanced chain. Follows `src/handoffs.ts` header contract: "Writes are atomic (tmp + rename)".
2. **Old API preserved as wrappers.** `loadRegistry()`/`saveRegistry()` keep returning/taking `HandoffRecord[]`; every #318 caller and test compiles unchanged — the cheapest way to honor NFR3.
3. **Fire-time resolution, creation-time validation.** Steps are shape-validated and budget-checked at creation (fail fast, nothing persisted on refusal — AC6), but `role`/`target` resolve when the step actually fires: config may legitimately change mid-chain, and stale resolution must halt-and-escalate (FR7), not deliver to a renamed target. Mirrors how `resolveCollabTarget` is the single resolution authority (context.md defense-in-depth pattern).
4. **Advance lives in `MasterMcpServer`, not `handoffs.ts`.** Delivery needs pool, discord client, `onReply`, config — all server-owned. `handoffs.ts` stays IO-to-its-own-file only; the state machine is pure. Matches the #318 split (registry vs tool wiring).
5. **Sweep chain handling in the server callback, not `sweepHandoffs`.** `sweepHandoffs` signature stays; the escalate callback in `server.ts` (already receiving the record) checks `record.chainId`, calls `expireChain`, and swaps in the chain-flavored master message. Keeps scheduler generic — it already only forwards actions (see `registerHandoffSweep`, `src/scheduler.ts:766-824`).
6. **Cooldown bypass for auto-advance (FR9).** Chain deliveries are registry-driven machine turns; routing them through `BotPeerGate` would let a cooldown silently stall a tracked chain — the exact silent-death failure the feature kills. The bounded loop protection is the hop budget + gate + sweep, per the proposal.
7. **Progress posts via `onReply` to `sourceChatId`.** Stored on the chain at creation so posts survive slug renames; same outbound path as the existing bot-peer mention post (`src/master-mcp-server.ts:702-706`).

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Registry format migration corrupts existing pending handoffs | Migration is read-side only + round-trip test (AC10); corrupt file keeps existing fail-open-empty behavior |
| Advance recursion (ack message itself contains next `#h-id`) | Impossible: next id doesn't exist until advance creates it; `matchPendingIds` only matches pending ids addressed to that chat |
| Double-advance on duplicate close (tool + ack race) | `completeHandoff` idempotency latch: only the call that transitions pending→done triggers advance; already-closed returns early (NFR4) |
| Mid-chain delivery failure (pool down, discord error) | `fireHandoff` failure → halt chain + master escalation (same path as FR7), never a throw into the closer's tool result |
| Gate string matching too loose/strict | Documented contract: trimmed, case-insensitive `approve` prefix; tested both ways (AC5) |

## Grounding sources

- `src/handoffs.ts:1-22` header — "Writes are atomic (tmp + rename)", "Reads are fail-open", "Decision logic takes an injectable clock (`nowMs` param)" → decisions 1, migration behavior, NFR2 clock discipline.
- `.specclaw/context.md` — "High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json` (operator-owned config)" → chains live in the shared registry file; "Defense in depth on MCP tools: tool listing AND call handler check the same gate independently" → `chain` arg reuses the existing `handoffSource` gate on the call path; "Injectable side effects … so tests never launch real processes" → NFR2/NFR5 test seams.
- `src/master-mcp-server.ts:630-708` — existing dual delivery paths (project `pool.deliver` envelope at :675-683, bot-peer mention via `onReply` at :702-706) → extracted `fireHandoff` helper reuses, not duplicates.
- `src/scheduler.ts:798-801` — "v1 simplification: sweepHandoffs takes a single timeout" → chain expiry keeps that single-timeout model (spec Notes deviation).
- `CLAUDE.md` collab section — auto-close exemption "only fires on a matching *pending* id, each id spends on first match" → recursion risk analysis above.

