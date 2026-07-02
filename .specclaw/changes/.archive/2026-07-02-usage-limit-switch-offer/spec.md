# Spec: Usage-Limit Detection + Model-Switch Offer

**Change:** usage-limit-switch-offer
**Created:** 2026-06-23
**Status:** 🟡 Draft

## Overview

When a project's `claude` subprocess hits a plan usage limit, the CLI writes a synthetic assistant record to the transcript and stops producing output. The Discord operator currently sees only silence. This change detects that record in the existing transcript poll loop, posts a clear Discord alert naming the limited model and reset time, and offers ready-to-run `!project` switch commands. An optional per-project `limitFallback` chain auto-switches instead of only offering.

The limit-hit transcript record (confirmed live):

```json
{"type":"assistant",
 "message":{"role":"assistant","model":"<synthetic>",
   "content":[{"type":"text","text":"You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"}]},
 "isApiErrorMessage":true,
 "apiErrorStatus":429}
```

## Requirements

### Functional Requirements

- **FR1** — Detect a limit-hit in the transcript poll loop (`src/claude-process.ts`) when a record has `isApiErrorMessage === true` AND `apiErrorStatus === 429`.
- **FR2** — Parse the limited model name and reset string from the synthetic message text. The model is matched case-insensitively from `hit your <MODEL> limit`; the reset string is everything after `resets` (kept verbatim — no Date parsing). If the regex misses, model and resetsAt are `null` and a generic alert is still sent.
- **FR3** — Fire at most one alert per limit episode. Dedupe in-memory per process keyed by the raw message text (or `resetsAt` when parsed), so the same record polled every 2s does not re-alert.
- **FR4** — Surface the limit-hit as a new `LimitHitEvent` from `ClaudeProjectProcess`, forwarded by `ProjectPool` as a `limit-hit` pool event (same wiring shape as `tool-progress`).
- **FR5** — On `limit-hit`, `server.ts` posts a Discord alert to the project channel stating the slug, the limited model, the reset string, and that the agent is paused.
- **FR6** — The alert includes ready-to-run switch commands computed from availability:
  - A `!project model <slug> --set <other>` line offering a subscription model other than the limited one (limited = Sonnet → offer Opus; limited = Opus → offer Sonnet).
  - One `!project provider <slug> --set <alias>` line per provider in `defaults.providers` **whose `apiKeyEnv` is set in the bot process env** (providers with an unset key are omitted).
- **FR7** — Optional auto-switch: a per-project `limitFallback: string[]` field in `channels.json`. When present and non-empty, instead of only offering, the bot picks the first entry that is currently usable — a model name not equal to the limited model, or a provider alias whose `apiKeyEnv` is set — writes it to config (model name → `model`, provider alias → `provider`), kills the subprocess to respawn, and posts an "Auto-switched" notice instead of the offer. If no entry is usable, fall back to the offer-only alert.

### Non-Functional Requirements

- **NFR1** — Detection adds no new poll loop; it piggybacks on the existing 2s transcript poll. Per-line cost is one extra property check.
- **NFR2** — Parse + offer computation are pure functions in a new `src/limit-offer.ts`, unit-testable without Discord, tmux, or filesystem.
- **NFR3** — `bun tsc --noEmit` passes. Existing tests stay green.
- **NFR4** — A wording change in the CLI limit message degrades gracefully to the generic alert (FR2), never crashes the poll loop.

## Acceptance Criteria

- **AC1** — A transcript record with `isApiErrorMessage:true, apiErrorStatus:429` and text `"You've hit your Sonnet limit · resets Jun 24, 7am (UTC)"` produces exactly one `limit-hit` pool event with `limitedModel: "Sonnet"`, `resetsAt: "Jun 24, 7am (UTC)"`.
- **AC2** — The same record seen on subsequent poll ticks produces no further events.
- **AC3** — The Discord alert names the slug, limited model, and reset string, and includes a `!project model <slug> --set opus` line when Sonnet is limited.
- **AC4** — A provider in `defaults.providers` with its `apiKeyEnv` set yields a `!project provider <slug> --set <alias>` line; a provider whose key is unset yields no line.
- **AC5** — With `limitFallback: ["opus"]` on the project and Sonnet limited, the bot writes `model: "opus"`, kills the subprocess, and posts an "Auto-switched … → opus" notice (no offer block).
- **AC6** — A 429 record whose text does not match the regex still produces one `limit-hit` event with `limitedModel: null` and a generic alert is posted.
- **AC7** — `bun tsc --noEmit` and the existing `bun src/*.test.ts` suites pass; new `src/limit-offer.test.ts` passes.

## Edge Cases

- **EC1** — Limited model already equals the only other subscription model (unknown model name parsed) → offer both opus and sonnet lines except any equal to the parsed limited model.
- **EC2** — `limitFallback` entry references a model equal to the limited one → skip it, try the next entry.
- **EC3** — `limitFallback` entry references a provider alias not in `defaults.providers`, or whose key is unset → skip it.
- **EC4** — No providers configured and no `limitFallback` → alert still posts with only the model-switch line.
- **EC5** — Provider already in use hits a limit routed through that provider (429 from MiniMax) → same detection path; offered switch list excludes the current provider where determinable.
- **EC6** — Multiple distinct limit episodes in one session (Sonnet resets, later Opus limited) → each distinct raw text alerts once.

## Dependencies

- Existing `!project model --set` and `!project provider --set` verbs (already implemented, respawn on switch).
- Existing pool-event dispatch in `server.ts` (`onEvent`) and `routeNotification`.
- Existing transcript poll loop in `src/claude-process.ts`.

## Notes

- Reset string kept verbatim per approved decision #3 — dodges timezone parsing bugs.
- Auto-switch is opt-in per approved decision #1; offer-only is the default.
- Provider offers hidden when key unset per approved decision #2, matching the guard already in `handleProvider`.
- Mission-control `mcEmit('limit_hit', …)` can be added alongside the Discord post for fleet-dashboard visibility (low-cost, consistent with other events).
