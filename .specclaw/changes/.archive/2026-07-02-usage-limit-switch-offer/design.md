# Design: Usage-Limit Detection + Model-Switch Offer

**Change:** usage-limit-switch-offer
**Created:** 2026-06-23

## Technical Approach

Reuse the existing transcript poll loop and pool-event pipeline end to end. Detection is one extra branch in the per-line loop at `src/claude-process.ts:1000–1068`. The event travels the same path as `tool-progress`: `ClaudeProjectProcess` fires → `ProjectPool` forwards as a `PoolEvent` → `server.ts onEvent` dispatches to Discord. All parsing and command-offer logic lives in a new pure module `src/limit-offer.ts` so it is unit-testable without tmux/Discord/fs.

## Architecture

```
claude-process.ts poll loop (every 2s)
  └─ per .jsonl line: if isApiErrorMessage && apiErrorStatus===429
       └─ parseLimitMessage(text)  [src/limit-offer.ts]  → { limitedModel, resetsAt, raw }
       └─ dedupe vs this.lastLimitRaw
       └─ fireLimitHit({ limitedModel, resetsAt, raw })
project-pool.ts
  └─ proc.onLimitHit(ev) → fireEvent({ kind:'limit-hit', chatId, slug, event: ev })
server.ts onEvent
  └─ if evt.kind==='limit-hit':
       computeLimitOffer(config, chatId, slug, limitedModel, env)  [src/limit-offer.ts]
         → { autoSwitch: {kind:'model'|'provider', value} | null, offerLines: string[] }
       if autoSwitch: saveConfig(...) + projectPool.killProject(chatId) + post "Auto-switched…"
       else:          routeNotification(post alert with offerLines)
       mcEmit('limit_hit', {...})
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/limit-offer.ts` | create | `parseLimitMessage(text)` + `computeLimitOffer(config, chatId, slug, limitedModel, env)` pure functions; `LimitHitEvent` re-used type |
| `src/limit-offer.test.ts` | create | Unit tests for parse (model/reset extraction, miss → null) and offer (model line, provider key gating, auto-switch selection, edge cases) |
| `src/project-process.ts` | modify | Add `LimitHitEvent` type; add `onLimitHit?(handler)` to `ProjectProcess` interface; add no-op `onLimitHit` to `MockProjectProcess` |
| `src/claude-process.ts` | modify | Add `limitHitHandlers` set, `onLimitHit`, `fireLimitHit`, `lastLimitRaw` dedupe field; detect 429 in poll loop and fire |
| `src/project-pool.ts` | modify | Add `{ kind:'limit-hit'; chatId; slug; event: LimitHitEvent }` to `PoolEvent`; subscribe `proc.onLimitHit` in spawn wiring next to `onToolProgress` |
| `src/channels-config.ts` | modify | Add `limitFallback: z.array(z.string()).optional()` to `ProjectSchema` |
| `server.ts` | modify | Handle `limit-hit` in `onEvent`: compute offer, auto-switch or post alert, `mcEmit('limit_hit', …)` |

## Data Model Changes

`ProjectSchema` (channels.json project entry) gains:

```ts
limitFallback: z.array(z.string()).optional()
// ordered list of model names and/or provider aliases to try on a usage limit,
// e.g. ["opus", "minimax"]. Absent/empty → offer-only (no auto-switch).
```

New event type (exported from `src/limit-offer.ts`, imported by process/pool):

```ts
export interface LimitHitEvent {
  limitedModel: string | null   // e.g. "Sonnet"; null if unparsed
  resetsAt: string | null       // verbatim, e.g. "Jun 24, 7am (UTC)"; null if unparsed
  raw: string                   // full synthetic message text (dedupe key)
}
```

## API Changes

No HTTP/MCP API changes. New internal pool event `limit-hit`. New `!project` verbs are **not** added — the existing `model`/`provider` verbs are reused.

`parseLimitMessage`:
```ts
// "You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"
//   → { limitedModel: "Sonnet", resetsAt: "Jun 24, 7am (UTC)", raw }
// regex: /hit your\s+(.+?)\s+limit\b/i  and  /resets?\s+(.+?)\s*$/i
```

`computeLimitOffer(config, chatId, slug, limitedModel, env)`:
- Candidate subscription models = `["opus","sonnet"]` minus any case-insensitive match to `limitedModel`; emit one `!project model <slug> --set <m>` per remaining.
- Provider lines = for each alias in `defaults.providers` where `env[def.apiKeyEnv]` is set → `!project provider <slug> --set <alias>`.
- Auto-switch (only if `project.limitFallback?.length`): first entry that is either a model name ≠ limitedModel, or a provider alias present in `defaults.providers` with `env[apiKeyEnv]` set. Returns `{ kind, value }` or `null`.

## Key Decisions

- **D1** — Parse/offer logic isolated in `src/limit-offer.ts` (pure) for testability; the poll loop and server only call it. (NFR2)
- **D2** — Dedupe by raw message text in-memory per process. A bot restart mid-limit may re-alert once — acceptable (open-question #4 resolved: in-memory).
- **D3** — Reuse `model`/`provider` config write + `killProject` for auto-switch rather than adding new verbs or a new respawn path. Server handler calls `saveConfig` + `projectPool.killProject` directly (same effect as the verb handlers).
- **D4** — Gate on `isApiErrorMessage && apiErrorStatus===429` first; regex is best-effort. Wording drift → generic alert, never a crash. (NFR4, FR2)
- **D5** — Provider offers gated on key presence, matching the existing `handleProvider` guard, so offered commands never fail validation.

## Risks & Mitigations

- **R1 — CLI changes the limit-message wording.** Mitigation: gate on structured fields (`isApiErrorMessage`, `apiErrorStatus`) not text; regex miss → generic alert (FR2/D4).
- **R2 — False positive: a 429 that is a transient overload, not a plan limit.** Mitigation: `<synthetic>` model + `isApiErrorMessage` is specifically the plan-limit record; transient 429s retry inside the CLI and are not written as synthetic assistant messages. Alert wording stays advisory ("agent paused — switch to keep going").
- **R3 — Auto-switch loops** (fallback target also limited). Mitigation: dedupe is per-raw-text, so a *different* limit message on the new model alerts once more; `limitFallback` is operator-chosen and ordered. No automatic re-switch beyond the single chain step per episode.
- **R4 — Re-alert on bot restart.** Mitigation: accepted (D2); low frequency, advisory message.
