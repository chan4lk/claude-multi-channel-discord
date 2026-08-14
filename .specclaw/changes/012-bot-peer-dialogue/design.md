# Design: Bot-Peer Dialogue (constrained bot-to-bot messaging)

**Change:** bot-peer-dialogue
**Created:** 2026-07-16

## Technical Approach

Keep the global bot drop as the default; add one narrow, testable branch. All decision logic (allowlist check, consecutive counter, cooldown, notice latch) lives in a new `BotPeerGate` class in `src/bot-peers.ts` with an injectable clock — `server.ts` gains only a thin `handleBotInbound(msg)` that consults the gate and reuses the existing pool-delivery block. Envelope labeling is a two-line addition (`authorType` field + `author_type` attr).

## Architecture

```
client.on('messageCreate')
  ├─ msg.author.bot?
  │    └─ handleBotInbound(msg)
  │         ├─ cfg.projects[channelId]?.botPeers?.allow includes author id?  ── no → drop
  │         ├─ channelId === master.chatId?                                  ── yes → drop
  │         ├─ botPeerGate.check(channelId, limits, now)
  │         │     ├─ 'cooldown'  → drop silent (stderr log)
  │         │     ├─ 'limit'     → drop; post notice once (latch)
  │         │     └─ 'deliver'   → pool.deliver({...envelope, authorType:'bot'}); counter++
  │         └─ (skip sendTyping / ackReaction; mcEmit message_received)
  └─ human path (unchanged) ── on project-pool delivery → botPeerGate.recordHuman(channelId)
```

`BotPeerGate` state (in-memory):
- `consecutive: Map<chatId, number>`
- `lastDeliveryMs: Map<chatId, number>`
- `noticeSent: Set<chatId>` (latched until `recordHuman`)

API:
```ts
class BotPeerGate {
  constructor(now: () => number = Date.now)
  check(chatId: string, limits: { maxConsecutive: number; cooldownSeconds: number }):
    { action: 'deliver' } | { action: 'drop-cooldown' } | { action: 'limit'; notify: boolean }
  recordDelivery(chatId: string): void
  recordHuman(chatId: string): void
}
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/bot-peers.ts` | create | `BotPeerGate` + `effectiveBotPeerLimits(config, project)` (fallback 5 / 30) |
| `src/bot-peers.test.ts` | create | Unit: counter, latch, cooldown, human reset, limit-lowered edge (AC4, AC5 core) |
| `src/channels-config.ts` | modify | `BotPeersSchema { allow: snowflake[], maxConsecutive?, cooldownSeconds? }` on ProjectSchema; limits-only on DefaultsSchema |
| `src/project-process.ts` | modify | `InboundEnvelope.authorType?: 'bot'` |
| `src/claude-process.ts` | modify | `formatPrompt`: emit `author_type="bot"` attr when set |
| `server.ts` | modify | Replace unconditional bot drop with `handleBotInbound`; call `recordHuman` in the human pool-delivery block; single shared `BotPeerGate` instance |
| `src/master-commands.ts` | modify | `handleSet`: `--bot-peers <csv|none>` (+`--yes` for non-none); help text |
| `src/master-commands.test.ts` | modify | AC6 |
| `src/project-pool.test.ts` or `src/claude-process` test surface | modify | AC2 envelope assertion (formatPrompt is on ClaudeProjectProcess — test via MockProjectProcess envelope pass-through + a direct formatPrompt unit if exported) |
| `README.md`, `ARCHITECTURE.md`, `CLAUDE.md` | modify | Document botPeers, limits, ToS-adjacent caution about loop cost |

## Data Model Changes

`channels.json`:
```jsonc
"projects": { "<chat_id>": { "botPeers": { "allow": ["123456789012345678"], "maxConsecutive": 5, "cooldownSeconds": 30 } } }
"defaults": { "botPeers": { "maxConsecutive": 5, "cooldownSeconds": 30 } }   // limits only
```

## API Changes

- `<channel ...>` envelope: new optional attr `author_type="bot"`.
- New master verb flag: `!project set <slug> --bot-peers <id,...> --yes` / `--bot-peers none`.
- No MCP tool changes.

## Key Decisions

1. **Gate logic in its own module, not server.ts.** server.ts has no test file; a pure class with injected clock gets real coverage and keeps the entry point diff ~30 lines.
2. **Silent cooldown drops vs noticed limit drops.** Cooldown is expected steady-state throttling (noisy to announce); the consecutive limit is a safety stop the operator must know about — one latched notice, mirroring how `budget-alert` fires once per threshold.
3. **Counter counts deliveries, not attempts.** Cooldown-dropped messages don't consume turn budget — otherwise a chatty bot could lock itself out without any message landing.
4. **Live-config checks per message.** Same pattern as the human project intercept (`loadChannelsConfig()` per message); `set --bot-peers` takes effect immediately.
5. **`--yes` on add, not on remove.** Expanding inbound reach is the dangerous direction; consistent with destructive-verb convention (`rm`, `rename`).
6. **Master exclusion hard-coded in the handler** (not just schema docs) — config alone must never be able to point a bot at the command surface.

## Risks & Mitigations

- **Two-bot infinite loop (MCD replies → peer bot replies → …)** → consecutive limit halts after N inbound turns regardless of what the peer does; cooldown bounds burst rate; human-reset makes resumption a deliberate operator act.
- **Prompt injection from peer bot** → explicit per-project id allowlist, `author_type="bot"` labeling (project CLAUDE.md can instruct caution), master exclusion, existing envelope escaping (`formatPrompt` attr/body escaping already neutralizes forged `<channel>` tags).
- **Operator allowlists a busy public bot** → cooldown caps delivery rate at 2/min by default; docs call out cost.
- **Schema merge conflict with cross-project-dialogue** → both add independent optional blocks to ProjectSchema; whichever lands second rebases trivially.
