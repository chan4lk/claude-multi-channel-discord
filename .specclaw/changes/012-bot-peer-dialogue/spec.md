# Spec: Bot-Peer Dialogue (constrained bot-to-bot messaging)

**Change:** bot-peer-dialogue
**Created:** 2026-07-16
**Status:** 🟡 Draft

## Overview

Punch a controlled hole in MCD's global bot-message drop (`if (msg.author.bot) return` in `server.ts:messageCreate`) so an explicitly allowlisted external bot (e.g. hermes) can deliver messages into a specific project's Claude session, with hard loop-prevention: consecutive-turn limit, cooldown, human-reset semantics, and master-channel exclusion. Everything else about the bot filter stays exactly as-is.

## Requirements

### Functional Requirements

- **FR1 — Config.** `ProjectSchema` gains optional `botPeers: { allow: string[] (Discord user ids), maxConsecutive?: number, cooldownSeconds?: number }`. `DefaultsSchema` gains limits-only `botPeers: { maxConsecutive?, cooldownSeconds? }` (no `allow` default — allowlists are always explicit per project). Effective limits: project → defaults → built-in (`maxConsecutive: 5`, `cooldownSeconds: 30`). Allow entries validated as Discord snowflakes (`/^\d{17,20}$/`).
- **FR2 — Inbound bot branch.** `messageCreate` routes bot-authored messages to a dedicated handler instead of dropping, which delivers to the pool only when ALL hold: channel is a registered project; project has `botPeers.allow` containing the author's user id; channel is not the master channel (hard-coded exclusion); loop-gate (FR3/FR4) permits. Any other bot message is dropped exactly as today. The human path is unchanged (gate/pairing/allowFrom untouched).
- **FR3 — Consecutive-turn limit.** Per-project counter of bot-authored deliveries since the last allowlisted human message in that channel. When a bot message would exceed effective `maxConsecutive`, it is dropped and **one** notice is posted to the channel ("🚫 bot-peer turn limit (N) reached — send a message to resume"); further over-limit messages are dropped silently until a human message resets the counter (and the notice latch).
- **FR4 — Cooldown.** Bot deliveries to the same project closer together than effective `cooldownSeconds` are dropped silently (logged to stderr, no notice, no counter increment).
- **FR5 — Envelope labeling.** `InboundEnvelope` gains optional `authorType?: 'bot'`; `formatPrompt` renders `author_type="bot"` in the `<channel>` tag so the session knows it is talking to a machine peer. Absent for human messages (no envelope change for the existing path).
- **FR6 — Human reset.** Any message delivered via the existing human path to that project resets its consecutive counter and notice latch.
- **FR7 — Master verb.** `!project set <slug> --bot-peers <id,id,...>` replaces `botPeers.allow`; `--bot-peers none` removes the block. **Adding/replacing ids requires `--yes`** (expands inbound attack surface); `none` does not. Standard allowFrom authorization applies. Ids validated per FR1; master slug rejected as target.
- **FR8 — No ack side-effects for bot messages.** Bot deliveries skip `sendTyping` and `ackReaction` (those exist for human UX); they do emit the `message_received` metric with the bot's user id.

### Non-Functional Requirements

- **NFR1** — Loop-gate logic lives in a dedicated module (`src/bot-peers.ts`) as an injectable-clock class so it is unit-testable without Discord; `server.ts` only wires it.
- **NFR2** — Gate state is in-memory (process lifetime); restart resets counters — acceptable, documented.
- **NFR3** — No change to outbound replies, upstream single-session fallback, or non-Discord platforms (Teams/WhatsApp inbound paths unaffected).
- **NFR4** — `bun tsc --noEmit` clean; existing tests pass.

## Acceptance Criteria

- **AC1** — Bot message in a channel with no project, or a project without `botPeers`, or author id not in `allow` → dropped (no pool delivery). Human messages behave exactly as before in all cases.
- **AC2** — Allowlisted bot message delivers: pool receives envelope with the bot's `userId`/`username`, `authorType: 'bot'`, and `formatPrompt` output contains `author_type="bot"`.
- **AC3** — Master channel: bot message from an allowlisted id is still dropped (hard exclusion wins over config).
- **AC4** — With `maxConsecutive: 2`: deliveries 1–2 pass, 3rd is dropped with exactly one channel notice, 4th dropped with no second notice; a human-path message resets; next bot message delivers.
- **AC5** — Two bot messages within `cooldownSeconds` (fake clock): second dropped silently, counter not incremented; after the window it delivers.
- **AC6** — `set <slug> --bot-peers <valid-id> --yes` persists to channels.json; without `--yes` → refusal message; `--bot-peers none` (no `--yes`) removes block; malformed id → usage error; master target → error.
- **AC7** — Bot delivery skips typing/ack-reaction calls (assert via mocks) and emits `message_received`.
- **AC8** — Full gate: `bun tsc --noEmit` + all existing test files + new `src/bot-peers.test.ts` pass.

## Edge Cases

- Bot edits/embeds-only messages (`msg.content` empty, attachments present) → same `(attachment)` fallback as humans.
- Webhook messages (`msg.author.bot` true, webhook ids are snowflakes) — work if explicitly allowlisted; otherwise dropped as today.
- MCD's own bot user id in `allow` → self-messages are possible in theory; MCD never posts inbound-triggering content to its own filter (its posts are outbound), and if the operator allowlists MCD itself the consecutive limit still bounds any accidental loop.
- Config edited live (`set --bot-peers`) → checks read live config per message, no respawn needed; in-flight counters keep their values.
- `maxConsecutive` lowered below the current counter value → next bot message hits the limit immediately (counter compares ≥).
- Project evicted/circuit-open → `pool.deliver` handles as it does human messages (queue/reject); gate counts only messages actually handed to `pool.deliver`.

## Dependencies

- Existing: `messageCreate` handler + project-pool intercept (`server.ts`), `InboundEnvelope`/`formatPrompt` (`src/project-process.ts`, `src/claude-process.ts`), `parseFlags`/`handleSet` (`src/master-commands.ts`), zod config schema.
- Related change: `cross-project-dialogue` (internal MCD↔MCD routing — no code overlap except both add a ProjectSchema block; land config schema changes without conflict by keeping blocks independent).
- Hermes-side: making hermes *listen* to MCD's messages is hermes gateway config, out of scope.

## Notes

Operator-approved defaults (from proposal open questions): turn limit counts inbound bot deliveries only; `maxConsecutive` 5 / `cooldownSeconds` 30; limit notice in-channel only (no master ping); `set --bot-peers` verb included in v1.
