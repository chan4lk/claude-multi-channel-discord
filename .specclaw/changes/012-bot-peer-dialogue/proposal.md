# Proposal: Bot-Peer Dialogue (constrained bot-to-bot messaging)

**Created:** 2026-07-16
**Status:** 🟡 Draft

## Problem

MCD drops every bot-authored Discord message globally (`msg.author.bot` check in `server.ts:messageCreate`). This is a deliberate loop-prevention measure, but it makes agent-to-agent collaboration impossible: hermes (or any other bot) can post into a project channel, yet the project's Claude session never sees it. The operator must manually relay between agents, defeating the point of having two autonomous agents on the same server.

Use cases blocked today:
- Hermes reports an out-of-band ops result (e.g. post-restart status) into a project channel and project Claude reacts to it.
- Two MCD-adjacent bots divide work on one project and hand off via the channel.
- Automated pipelines (CI webhooks posting via a bot) that project Claude should triage.

## Proposed Solution

Per-project opt-in **bot peer allowlist** with hard loop-prevention constraints. The global bot filter stays the default; a project entry may declare:

```jsonc
"projects": {
  "<chat_id>": {
    "slug": "claude-mcd",
    "botPeers": {
      "allow": ["<hermes-bot-user-id>"],   // bot user ids whose messages deliver
      "maxConsecutive": 5,                  // bot-to-bot turns without a human message
      "cooldownSeconds": 30                 // min gap between bot-triggered deliveries
    }
  }
}
```

Behavior:
1. `messageCreate`: if author is a bot, deliver only when the channel's project has `botPeers.allow` containing the author id — otherwise drop (unchanged default).
2. Inbound bot messages are wrapped with `author_type="bot"` in the `<channel>` envelope so the project's Claude knows it is talking to a machine peer.
3. **Loop breaker:** a per-project counter of consecutive bot-authored deliveries. Any allowlisted human message resets it. At `maxConsecutive`, further bot messages are dropped and one notice is posted to the channel ("bot-peer turn limit reached — human message required to resume").
4. **Rate limit:** bot deliveries closer together than `cooldownSeconds` are dropped silently (logged).
5. Master channel never accepts bot peers (hard-coded), so `!project` command surface can't be driven by another bot.
6. `!project set <slug> --bot-peers <id,...>` / `--bot-peers none` to manage from the master channel (destructive expansion of attack surface → requires allowFrom, and adding peers requires `--yes`).

## Scope

### In Scope
- `channels-config.ts`: `botPeers` zod schema on project entries (+ optional `defaults.botPeers` for limits only, not the allowlist)
- `server.ts`: bot-filter branch, envelope `author_type`, loop-breaker + cooldown state, limit-reached notice
- `master-commands.ts`: `set --bot-peers` verb wiring + help text
- Tests: filter matrix (bot allowed / not allowed / master channel / limit hit / cooldown / human reset)
- README + ARCHITECTURE docs

### Out of Scope
- Hermes-side configuration (hermes has its own gateway allowlist; making hermes listen to MCD's bot is a hermes config task, not MCD code)
- Cross-project handoff (`@<slug> ...`) — separate roadmap item
- Bot peers on Teams / WhatsApp platforms (Discord only for v1)
- Any change to outbound replies (Claude already posts as the MCD bot)

## Impact

- **Files affected:** ~5 (estimated)
- **Complexity:** medium
- **Risk:** medium — main risk is token burn from runaway agent-to-agent loops; mitigated by maxConsecutive + cooldown + human-reset semantics. Second risk: prompt injection from a compromised/misbehaving peer bot — mitigated by explicit per-project allowlist, master-channel exclusion, and `author_type="bot"` labeling.

## Open Questions

1. Should the consecutive-turn counter also cap **Claude's replies to bot messages** (i.e., count both directions), or only inbound deliveries? Proposal counts inbound deliveries only — simpler, same effect.
2. Default `maxConsecutive` = 5 and `cooldownSeconds` = 30 — sane?
3. Should limit-reached also DM/notify the master channel, or is the in-channel notice enough?
4. Do we want a `!project set --bot-peers` verb in v1, or is hand-editing channels.json acceptable to keep v1 small?

---

**To proceed:** Review this proposal and approve to begin planning.
