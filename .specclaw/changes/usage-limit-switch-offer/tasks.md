# Tasks: Usage-Limit Detection + Model-Switch Offer

**Change:** usage-limit-switch-offer
**Created:** 2026-06-23
**Total Tasks:** 7

## Summary

Three foundation pieces (config field, pure parse/offer module, event type) land first with no interdependencies, then the wiring (process detection, pool forward, server dispatch) builds on them, and tests + typecheck close it out. Offer-only is the default path; `limitFallback` auto-switch reuses the existing `model`/`provider` config-write + `killProject` plumbing.

## Tasks

### Wave 1 — Foundation (independent)

- [x] `T1` — Add `limitFallback` to project schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Notes: Add `limitFallback: z.array(z.string()).optional()` to `ProjectSchema` (near `stuckThresholdMinutes`, ~line 104). Ordered model names / provider aliases.

- [x] `T2` — Create `src/limit-offer.ts` pure module
  - Files: `src/limit-offer.ts`
  - Estimate: medium
  - Notes: Export `LimitHitEvent` interface; `parseLimitMessage(text) → LimitHitEvent` (regex `/hit your\s+(.+?)\s+limit\b/i` for model, `/resets?\s+(.+?)\s*$/i` for reset, verbatim; miss → nulls but keep `raw`); `computeLimitOffer(config, chatId, slug, limitedModel, env) → { autoSwitch: {kind:'model'|'provider', value:string} | null, offerLines: string[] }`. Subscription candidates `["opus","sonnet"]` minus limited (case-insensitive); provider lines gated on `env[def.apiKeyEnv]`; auto-switch picks first usable `limitFallback` entry. No fs/Discord/tmux imports.

- [x] `T3` — Add `LimitHitEvent` to process interface
  - Files: `src/project-process.ts`
  - Estimate: small
  - Notes: Import/re-export `LimitHitEvent` from `./limit-offer.ts`; add `onLimitHit?(handler: (ev: LimitHitEvent) => void): () => void` to `ProjectProcess`; add no-op `onLimitHit` to `MockProjectProcess`.

### Wave 2 — Wiring (depends on Wave 1)

- [x] `T4` — Detect + fire limit-hit in poll loop
  - Files: `src/claude-process.ts`
  - Estimate: medium
  - Depends: T2, T3
  - Notes: Add `limitHitHandlers` set, `onLimitHit`, `fireLimitHit`, and `lastLimitRaw: string | null` dedupe field. In the existing transcript poll loop (~1000–1068), for each parsed record check `rec.isApiErrorMessage === true && rec.apiErrorStatus === 429`; extract message text; if `raw !== lastLimitRaw`, set `lastLimitRaw` and `fireLimitHit(parseLimitMessage(text))`.

- [x] `T5` — Forward `limit-hit` pool event
  - Files: `src/project-pool.ts`
  - Estimate: small
  - Depends: T3
  - Notes: Add `| { kind:'limit-hit'; chatId: string; slug: string; event: LimitHitEvent }` to `PoolEvent`; in spawn wiring next to `onToolProgress`, subscribe `proc.onLimitHit?.((ev) => this.fireEvent({ kind:'limit-hit', chatId, slug: project.slug, event: ev }))` and track the unsubscribe alongside `offToolProgress`.

- [x] `T6` — Handle `limit-hit` in server (alert + auto-switch)
  - Files: `server.ts`
  - Estimate: medium
  - Depends: T1, T2, T5
  - Notes: In `onEvent`, branch on `evt.kind==='limit-hit'`. Call `computeLimitOffer`. If `autoSwitch`: write `model`/`provider` to the project entry via `saveConfig`, `projectPool.killProject(evt.chatId)`, post "🔄 Auto-switched `<slug>` → `<value>` (`<model>` limited until `<resetsAt>`)". Else post "⚠️ `<slug>` hit the `<model>` usage limit · resets `<resetsAt>`. Agent paused — switch to keep going:" + `offerLines`. Generic wording when `limitedModel`/`resetsAt` are null. Add `mcEmit('limit_hit', { slug, chatId, limitedModel, resetsAt })`.

### Wave 3 — Tests & verify (depends on Wave 2)

- [x] `T7` — Unit tests for `limit-offer`
  - Files: `src/limit-offer.test.ts`
  - Estimate: medium
  - Depends: T2, T6
  - Notes: Cover AC1 (parse Sonnet + reset), AC6 (unparsed → nulls), AC3 (opus model line when Sonnet limited), AC4 (provider line gated on key env set/unset), AC5 (auto-switch selects opus from `limitFallback`), EC1/EC2/EC3 (skip equal-to-limited and unusable entries). Run `bun tsc --noEmit` + existing suites (`bun src/master-commands.test.ts`, `bun src/project-pool.test.ts`, `bun src/master-mcp-server.test.ts`) green (AC7).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed

**Task format:**
```
- [ ] `T<n>` — <title>
  - Files: <files to create/modify>
  - Estimate: small | medium | large
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
