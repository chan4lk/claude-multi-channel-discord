# Design: Collab handoff protocol

**Change:** collab-handoff-protocol
**Created:** 2026-07-26

## Technical Approach

Layer a persistent registry + lifecycle on the existing `handoff` MCP tool rather than adding a parallel tool. Pure logic lives in a new `src/handoffs.ts` (registry state machine + sweep decisions, injectable clock, file IO isolated in two functions following `src/shared-learnings.ts`). Reach-widening stays behind the existing `handoffEnabled()` gate; role config is a new optional `collab` block on the project schema.

## Architecture

```
mcp__mcd__handoff (extended)          mcp__mcd__handoff_complete (new)
        │                                       │
        ▼                                       ▼
   src/handoffs.ts  ◄──────────────────────────┘
   createHandoff / completeHandoff / sweepHandoffs / loadRegistry
        │ persisted at shared/handoffs.json (atomic tmp+rename)
        │
        ├─ internal target → pool.deliver(envelope with #h-<id>)
        ├─ botPeer target  → onReply post to source channel: <@botId> [handoff #h-<id> from <slug>] task
        │
server.ts bot-peer inbound path
        └─ pending-id match → completeHandoff + skip recordDelivery (exemption)

Scheduler.registerHandoffSweep (follows registerBacklogWatchSweep pattern)
        └─ sweepHandoffs(now) → [{kind:'nag',…},{kind:'escalate',…}] → routeNotification
```

## File Changes Map

| File | Change |
|------|--------|
| `src/handoffs.ts` (new) | Registry: types, `createHandoff`, `completeHandoff`, `matchPendingIds`, `sweepHandoffs` (pure decision, returns actions), `loadRegistry`/`saveRegistry` (atomic IO, fail-open read), pruning (NFR1) |
| `src/handoffs.test.ts` (new) | State machine, sweep idempotence, prune, corrupt-file recovery |
| `src/channels-config.ts` | `CollabSchema = { roles?: Record<string,string>, timeoutMinutes?: number }` on project; `defaults.collab.{timeoutMinutes}` limits-only; `resolveCollabTarget(config, project, roleOrSlug)` helper |
| `src/master-mcp-server.ts` | Extend `handoff` case: role resolution, registry record, botPeer-target branch (post via onReply, no pool.deliver), `#h-<id>` in envelope; new `handoff_complete` case + tool listing (target-or-master gate); listing gains `role` arg description |
| `src/master-commands.ts` | `collab <slug>` verb (roles + open handoffs table); `set --collab-role name=value|none` with validation |
| `server.ts` | Bot-peer inbound: `matchPendingIds` before gate count → complete + exempt; wire `registerHandoffSweep` deps (notify receiver channel / master) |
| `src/scheduler.ts` | `registerHandoffSweep()` — every 5 min tick guard, calls sweep, routes actions |
| `src/master-commands.test.ts`, `src/master-mcp-server.test.ts`, `src/bot-peers.test.ts` | New cases per ACs |
| `CLAUDE.md`, `README.md`, `docs/commands.md`, `templates/master.CLAUDE.md` + project template | Verbs, config keys, addressing protocol + peer-clarify norm (FR8) |

## Key Decisions

1. **Extend `handoff`, don't add a v2 tool.** Existing callers keep working (`target_slug` path just gains an id + record). One tool, one gate.
2. **Separate file `shared/handoffs.json`, not channels.json runtime.** Registry is high-churn state; channels.json is operator-owned config. Follows the learnings-board precedent (open question 3 → resolved).
3. **Timeout policy: nag receiver once at `timeoutMinutes`, escalate + expire at 2×.** No retry loops between bots (open question 1 → resolved).
4. **Reply-detection fallback: exact `#h-<id>` match against *pending ids for that channel only*.** Regex-only detection without a registry lookup would let arbitrary bot text bypass the turn gate (open question 2 → resolved with the loop-safety constraint).
5. **BotPeer handoff posts to the source project's own channel.** Bot peers coexist in the project channel (finaudit model); there is no separate peer channel to deliver to. Mention format satisfies `DISCORD_ALLOW_BOTS=mentions`.
6. **Sweep cadence 5 min** (tick-guarded like backlog-watch's hourly guard but tighter — 30 min default timeout needs finer granularity than hourly).

## Grounding sources

- `.specclaw/context.md`: "features that widen a project Claude's reach … are off by default, enabled per-project … flags that grant reach require `--yes`" → `collab.roles` config itself grants no reach (handoff flag does), so `--collab-role` needs no `--yes`; "Defense in depth on MCP tools — tool listing AND call handler check the same gate" → applied to `handoff_complete`; "Injectable side effects" → clock/deps injection throughout.
- `src/bot-peers.ts:48-56`: built-in status patterns precedent — exemption logic must stay anchored/bounded, hence pending-id-match-only exemption.
- `src/master-mcp-server.ts:611-646`: existing handoff case — extension point, keeps `pool.deliver` envelope shape.
- `src/shared-learnings.ts:92-101`: atomic write + cap pattern reused for the registry.

## Risks

- **Loop risk via exemption** — mitigated: exemption requires a matching *pending* id; each id closes on first match, so an id can exempt at most one message.
- **Registry write races** (tool call + sweep concurrently) — single-process, both paths are synchronous load→mutate→save on the bun event loop; no await between load and save in mutation helpers.
- **Stale roles after project rename** — `collab` verb marks stale entries; `handoff` errors name the stale value.
