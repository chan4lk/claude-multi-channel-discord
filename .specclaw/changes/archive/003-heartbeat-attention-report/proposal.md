# Proposal: Actionable Heartbeat — Attention Report Instead of Idle Spam

**Created:** 2026-07-12
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The master-channel heartbeat schedule (`s_heartbeat_master`, every 30 min, 1000+ runs) posts a report built from `!project heartbeat` whose primary content is noise: `✅ idle (N): slug, slug, slug...` on every run. Stalled channels are listed with a raw reason code (`tool-incomplete`, `question-unanswered`) and a 40–80 char snippet, but no indication of *what the operator should do about it*, no link to the channel, and no severity ordering. The operator has stopped reading the message — the watchdog exists but produces no operational value.

Concrete failures:
1. **No signal/noise separation** — "all idle" posts look identical to "something is stuck" posts at a glance.
2. **Not actionable** — a stalled entry doesn't say *how* to unblock (reply to the question? restart the session? pause a runaway schedule?), doesn't mention the Discord channel (`<#chatId>`), and truncates the pending question so the operator can't answer it from the master channel.
3. **Blind spots** — the scan only looks at transcript stalls. It misses other attention-worthy states the bot already knows about: schedules that keep firing into a completed backlog (1098 runs of "backlog complete"), disabled-after-failure schedules, circuit-open channels, and specclaw changes stuck in the same phase across scans.

## Proposed Solution

_What are we building? High-level approach._

Replace the flat idle/stalled dump with a structured **attention report** built by a new `buildAttentionReport(config)` in `src/heartbeat.ts`, rendered by `handleHeartbeat`:

1. **Attention items, not states.** Each item: channel slug + Discord mention (`<#chatId>`), severity (`🔴 blocked` / `🟡 review` / `🔵 info`), a one-line human explanation, and a **suggested action** — a copy-pasteable command (`!project stop <slug>`, `!project schedule pause <id>`) or "reply in <#chatId>: …" with the full pending question text (not a 40-char snippet).
2. **New detectors** (all from data already on disk — no new I/O surfaces):
   - `question-unanswered` → include the full question (up to ~300 chars) so the operator can answer directly.
   - `schedule-noop-loop` → an enabled schedule whose last N runs produced replies matching a no-op pattern (e.g. "backlog complete") or that has run > X times since last operator message in the channel; suggest `schedule pause <id>` / `--stop-on-reply`.
   - `circuit-open` → pool circuit breaker open for a channel.
   - `specclaw-phase-stuck` → active change in the same phase with same task count for > staleAfterMinutes; suggest a resume nudge.
3. **Quiet when healthy.** `!project heartbeat --quiet`: when zero attention items, return a single suppressible line (`heartbeat ok — N channels quiet`) that the scheduled prompt can be told to swallow, so the master channel only sees a message when something needs the operator. Default (no flag) keeps a compact summary for manual runs.
4. **Ordering + cap.** Items sorted by severity, capped with `(+N more)` to stay within one Discord message.

The scheduled prompt in `schedules.json` is operator state, not repo code — the PR updates the template guidance in `templates/master.CLAUDE.md` and the README so the operator can update the schedule prompt to use `--quiet`.

## Scope

### In Scope
- `src/heartbeat.ts`: `AttentionItem` type, `buildAttentionReport()`, new detectors (question full-text, schedule-noop-loop, circuit-open hook, specclaw-phase-stuck).
- `src/master-commands.ts`: rewrite `handleHeartbeat` rendering; add `--quiet` flag; help text.
- Plumbing: expose circuit-breaker state + schedule metadata to the heartbeat scan (read-only deps).
- Tests: detector matrix + rendering + `--quiet` in `src/master-commands.test.ts` (or new `heartbeat.test.ts`).
- Docs: `templates/master.CLAUDE.md`, README heartbeat section.

### Out of Scope
- Changing the injection/autonomous path (`mcp__mcd__inject` flow stays as is).
- Editing the operator's live `schedules.json` prompt (operator applies manually).
- New attention sources requiring network calls (open PR checks via `gh` etc.).
- Full cron syntax or schedule redesign.

## Impact

- **Files affected:** ~5 (heartbeat.ts, master-commands.ts, server.ts plumbing, tests, docs)
- **Complexity:** medium
- **Risk:** low — read-only detectors; worst case is a wrong suggestion string. Rendering change is behind the same verb.

## Open Questions

1. `schedule-noop-loop` threshold — propose: enabled schedule with `runCount ≥ 5` whose channel transcript shows no operator (non-scheduler) message since 5 fires ago. Good enough?
2. Should `--quiet` become the default for the scheduled path (detect scheduler user id) instead of a flag?
3. Severity of `question-unanswered` — 🔴 or 🟡? Propose 🔴 since an agent is fully blocked on it.

---

**To proceed:** Review this proposal and approve to begin planning.
