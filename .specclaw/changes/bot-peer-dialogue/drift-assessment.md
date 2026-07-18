# Drift Assessment: bot-peer-dialogue (2026-07-18)

Planned 2026-07-16; status.md claimed Build ⏳ Pending. Ground truth (P311's exact stale-status disease): **all 5 tasks were built, merged, and deployed on 2026-07-16** — the finaudit↔dHermes production session ran on this code.

| FR | Shipped evidence |
|----|------------------|
| FR1 config schema | `src/channels-config.ts` BotPeersSchema + BotPeerLimitsSchema (snowflake regex, limits fallback) |
| FR2 inbound branch | `server.ts` handleBotInbound (allow → master exclusion → gate → deliver) |
| FR3/FR4 gate | `src/bot-peers.ts` BotPeerGate (counter, latch, cooldown) |
| FR5 envelope | `src/project-process.ts:24` authorType; `src/claude-process.ts:1043-1044` author_type="bot" |
| FR6 human reset | `server.ts:2284` recordHuman |
| FR7 verb | `src/master-commands.ts` --bot-peers csv/--yes/none + tests at master-commands.test.ts:967+ |
| FR8 no ack | handleBotInbound skips sendTyping/ackReaction, emits message_received |
| Docs | README.md:247+, ARCHITECTURE.md:198+, CLAUDE.md |

**No remaining tasks.** Post-ship evolution already landed on top: P310 status-post exemption (2026-07-18) extends this gate. Disposition: mark verified/complete — nothing to build, nothing superseded.
