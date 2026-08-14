# Tasks: Channel Deletion Watch

**Change:** 030-channel-deletion-watch
**Created:** 2026-08-14
**Total Tasks:** 6

## Summary

Schema fields first, then the two independent feature legs (sweep logic; purge flag) with their tests, then server.ts wiring, then a final verify pass. Wave 2 legs are independent of each other.

## Tasks

### Wave 1 — Schema

- [x] `T1` — Add `channelMissingSince` / `lastMissingAlertAt` to project schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Kind: config
  - Notes: Optional ISO strings, doc comments marking them MCD-maintained (mirror `enabledAt` FR7). No defaults block — built-in grace/re-nag constants live in scheduler.

### Wave 2 — Feature legs (independent)

- [x] `T2` — `registerChannelWatchSweep` / `runChannelWatchSweep` in scheduler
  - Files: `src/scheduler.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: Injected `channelExists(chatId) => Promise<'exists'|'missing'|'unknown'>`, `nowMs`, `onPrompt(slug, chatId)`. Built-ins: grace 90 min, re-nag 7 d, hourly interval (overridable `sweepIntervalMs` for tests). Skip master + non-discord platforms + entries absent on fresh re-read. State transitions per design (missing→set/prompt, exists→clear both, unknown→no-op). Follow `runAutoDisableSweep` structure exactly.

- [x] `T3` — Sweep tests (AC1–AC6, AC10, AC11)
  - Files: `src/scheduler.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T2
  - Notes: Injected probe/clock, in-memory config. Cases: first-missing marks; no prompt pre-grace; prompt post-grace stamps alert + contains `rm <slug> --yes --purge`; no re-prompt <7d, re-prompt >7d; exists clears both fields; unknown is no-op mid-grace; master and whatsapp/teams skipped.

- [x] `T4` — `rm --purge` flag with symlink/realpath guard
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1
  - Notes: In `handleRm`: `--purge` without `--yes` → existing confirm text extended to document both outcomes. With both: lstat `projects/<slug>` — symlink ⇒ `unlinkSync` only; dir ⇒ realpath must sit under realpath of projects dir else refuse; then `rmSync recursive force`. Keep kill-before-rm, config delete, access-group cleanup. Also: `list` `🗑` marker + `show` `channel: missing since …` line (FR8) + help text.

- [x] `T5` — `rm --purge` tests (AC7–AC10)
  - Files: `src/master-commands.test.ts`
  - Estimate: medium
  - Kind: test
  - Depends: T4
  - Notes: Temp-dir fixtures: real dir purged with no `.archive/` copy; symlinked dir → symlink gone, target intact; realpath-escape layout refused, nothing deleted; master refusal unchanged with new flags; plain `--yes` still archives.

### Wave 3 — Wiring + verify

- [x] `T6` — server.ts wiring + full verify
  - Files: `server.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T2, T4
  - Notes: `client.on(Events.ChannelDelete, ...)` early-mark (match project by channel id, set `channelMissingSince` if unset — read-fresh-before-write); `channelExists` probe (10003 ⇒ missing, else unknown; truthy fetch ⇒ exists); register sweep next to auto-disable block with `routeNotification` master prompt per FR4 text. Then `bun tsc --noEmit` + all test suites (AC12).

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
  - Kind: docs | test | config | refactor | impl | migration
  - Depends: <task ids> (if any)
  - Notes: <additional context>
```
