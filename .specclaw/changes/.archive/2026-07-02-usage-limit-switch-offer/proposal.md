# Proposal: Usage-Limit Detection + Model-Switch Offer

**Created:** 2026-06-23
**Status:** ✅ Approved (2026-06-23)

**Approved decisions:** (1) ship offer-only first, `limitFallback` auto-switch is opt-in; (2) hide `--set <provider>` offers when the provider's `apiKeyEnv` is unset in env; (3) keep the CLI reset string verbatim — no Date parsing.

## Problem

When a project's `claude` subprocess hits a plan usage/credit limit, the Discord operator currently sees **nothing**. The agent just goes silent and looks stuck.

The limit-hit is recorded in the project transcript `.jsonl` as a synthetic assistant message:

```json
{"type":"assistant","message":{"role":"assistant","model":"<synthetic>","content":[{"type":"text","text":"You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"}]},"isApiErrorMessage":true,"apiErrorStatus":429}
```

(Confirmed in live transcripts: `apps`/`bistec-articles`, `academy-videos`, etc. — text `"You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"`, `apiErrorStatus:429`, `model:"<synthetic>"`.)

The bot already has everything needed to recover — `!project model <slug> --set NAME` and `!project provider <slug> --set ALIAS` verbs exist and respawn the subprocess — but the operator is never told the limit hit, which model is blocked, when it resets, or that a switch is possible. A Sonnet limit often hits while **Opus is still available** (or a configured `minimax` provider), so recovery is one command away if surfaced.

## Proposed Solution

Detect the 429 limit-hit in the transcript poll loop, surface a clear Discord alert, and auto-offer a ready-to-run switch command.

1. **Detect** — in the existing transcript poll loop (`src/claude-process.ts` ~1000–1068, runs every 2s and already parses each `.jsonl` line for `msg.role === 'assistant'`), add a check for `record.isApiErrorMessage === true && record.apiErrorStatus === 429`. Parse the limited model name and reset time from the synthetic text (`/hit your (\w+) limit · resets (.+?)$/`). Fire once per limit episode (dedupe by reset-time string so the same record isn't re-alerted on every 2s poll).

2. **Emit** — fire a new `LimitHitEvent { chatId, limitedModel, resetsAt, raw }` via a `onLimitHit` handler, forwarded by `ProjectPool` as a `limit-hit` pool event (same wiring shape as the existing `tool-progress` event).

3. **Surface + offer** — `server.ts` handles the pool event and posts a clear, un-chunked Discord alert to the project channel:

   ```
   ⚠️ <slug> hit the Sonnet usage limit · resets Jun 24, 7am (UTC).
   The agent is paused. Switch model to keep going:

   !project model <slug> --set opus           ← Opus still available
   !project provider <slug> --set minimax     ← or route to MiniMax
   ```

   The exact offered commands are computed from what's available: the limited model is excluded; if a `minimax` (or any) provider is configured in `defaults.providers`, it's offered too. Mirrors the actionable-command UX of the voice slash commands.

4. **Optional auto-switch (fallback chain)** — per-project `limitFallback: string[]` in `channels.json` (e.g. `["opus", "minimax"]`). When set, instead of only offering, the bot auto-applies the first entry not currently blocked (model name → `model` set; provider alias → `provider` set), respawns, posts "Auto-switched <slug> → opus (Sonnet limited until …)", and resumes. When unset, offer-only.

## Scope

### In Scope
- 429 limit-hit detection + parse in the transcript poll loop (`claude-process.ts`)
- New `LimitHitEvent` + `onLimitHit` handler on `ClaudeProjectProcess`
- `ProjectPool` forwarding as a `limit-hit` pool event
- `server.ts` handler posting the Discord alert with computed offered commands
- Per-episode dedupe (no repeat alerts every poll tick)
- Optional `limitFallback` config field + auto-switch path
- Unit tests: parse function (model + reset extraction), offered-command computation, dedupe

### Out of Scope
- Mission-control UI surfacing of limit events (could be a follow-up P-series item)
- Detecting non-429 errors (overloaded_error 529, api_error) — separate concern
- Predicting limits before they hit (that's adjacent to P148 stall forecaster)
- Auto-switching back when the limit resets (operator switches back manually)
- WhatsApp/Teams parity beyond what the existing pool-event dispatch already gives

## Impact

- **Files affected:** 4 (estimated) — `src/claude-process.ts`, `src/project-pool.ts`, `server.ts`, `src/channels-config.ts` (optional `limitFallback` schema); + tests
- **Complexity:** medium
- **Risk:** low — detection is read-only on an existing poll loop; alert is additive; auto-switch reuses existing `set` plumbing. Main risk is a brittle text regex if the CLI changes the limit-message wording — mitigated by gating on `isApiErrorMessage`+`apiErrorStatus:429` first and falling back to a generic alert if the regex misses.

## Open Questions

1. **Auto-switch default** — ship offer-only first (safer, operator in control), add `limitFallback` auto-switch as opt-in? Recommend yes.
2. **Provider key availability** — should the offer hide `--set minimax` if `MINIMAX_API_KEY` isn't in env, or always show it and let the existing provider validation reject? Lean toward hiding when the key env is unset.
3. **Reset-time parsing** — keep the CLI's raw reset string verbatim (e.g. "Jun 24, 7am (UTC)") rather than parsing to a Date? Avoids tz bugs; recommend verbatim.
4. **Dedupe scope** — dedupe per `(chatId, resetsAt)` in memory only, or persist so a bot restart mid-limit doesn't re-alert? In-memory likely sufficient.
5. **Should auto-switch also fire if the operator is mid-conversation** vs only when idle? Probably always — the agent is blocked regardless.

---

**To proceed:** Review this proposal and approve to begin planning.
