# Tasks: Bot-Peer Dialogue (constrained bot-to-bot messaging)

**Change:** bot-peer-dialogue
**Created:** 2026-07-16
**Total Tasks:** 5

## Summary

Gate module, config schema, and envelope labeling are independent (Wave 1); server + verb wiring builds on them (Wave 2); docs + full gate close (Wave 3). Repo: `/home/openclaw/dev/multi-channel-discord`.

## Tasks

### Wave 1 — Foundations (parallel-safe)

- [x] `T1` — `botPeers` config schema + effective limits
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Notes: `BotPeersSchema { allow: z.array(z.string().regex(/^\d{17,20}$/)), maxConsecutive?: positive int, cooldownSeconds?: positive int }` on ProjectSchema; limits-only variant on DefaultsSchema. FR1.

- [x] `T2` — `src/bot-peers.ts` gate module + unit tests
  - Files: `src/bot-peers.ts`, `src/bot-peers.test.ts`
  - Estimate: medium
  - Notes: `BotPeerGate` (injectable clock; consecutive Map, lastDeliveryMs Map, notice latch Set; `check`/`recordDelivery`/`recordHuman`) + `effectiveBotPeerLimits(config, project)` fallback 5/30. Cover: counter progression, latch fires once, cooldown drop doesn't increment counter, human reset, limit-lowered-below-counter edge. AC4/AC5 core.

- [x] `T3` — Envelope `authorType` labeling
  - Files: `src/project-process.ts`, `src/claude-process.ts`
  - Estimate: small
  - Notes: Optional `authorType?: 'bot'` on `InboundEnvelope`; `formatPrompt` appends `author_type="bot"` attr when present. Keep attr-escaping pattern. AC2 (envelope half).

### Wave 2 — Wiring

- [x] `T4` — server bot branch + `set --bot-peers` verb + tests
  - Files: `server.ts`, `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: large
  - Depends: T1, T2, T3
  - Notes: Replace `if (msg.author.bot) return` with `handleBotInbound(msg)` per design (allow check → master exclusion → gate → pool.deliver with `authorType:'bot'`, skip typing/ack, mcEmit, limit notice post); call `gate.recordHuman(chatId)` in the human pool-delivery block. Verb: `--bot-peers <csv>` requires `--yes`, `none` doesn't; snowflake + master-target validation; help text. AC1–AC3, AC6, AC7 (verb + gate assertions via module tests; server wiring asserted by targeted review since server.ts has no test harness — note in verify report).

### Wave 3 — Docs + gate

- [x] `T5` — Docs + full gate
  - Files: `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`
  - Estimate: small
  - Depends: T4
  - Notes: Document botPeers config, limits, human-reset semantics, in-memory state reset on restart, cost caution. Run `bun tsc --noEmit` + all test files (AC8).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
