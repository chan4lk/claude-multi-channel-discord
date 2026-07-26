# Proposal: Project disable switch

**Created:** 2026-07-26
**Status:** 🟡 Draft

## Problem

There is no way to temporarily take a project channel offline. Every inbound message to a registered project spawns (or wakes) its Claude subprocess and burns a turn — even when the operator wants the channel paused (misbehaving project, cost control, maintenance, noisy channel). Today the only options are destructive (`rm`) or partial (`stop`, which kills the warm session but the very next message respawns it).

## Proposed Solution

Add a per-project `disabled: boolean` flag (default `false`) to the project entry in `channels.json`, toggled from the master channel.

Behavior when `disabled: true`:

- **Inbound short-circuit:** `handleInbound` (and the WhatsApp/Teams inbound paths) checks the flag *before* `projectPool.deliver()`. Instead of routing to Claude, the bot replies in-channel: `project disabled. use master to enable` (throttled — e.g. at most once per N minutes per channel, so a chatty user doesn't produce a wall of notices).
- **No spawn:** the pool never spawns a subprocess for a disabled project. If a warm session exists at disable time, it is stopped (same path as `!project stop`).
- **Peripheral suppression:** scheduler jobs targeting the project are skipped (job kept, not fired), autopilot/backlog-watch sweeps skip it, `ask_project` from peers returns a "project disabled" error, bot-peer inbound is dropped with the same notice.
- **Master immune:** the master channel can never be disabled (refuse with a warning, same pattern as autopilot/hermes master guards).

Toggle UX (master channel, allowFrom-gated):

- `!project set <slug> --disabled on|off` — fits the existing `set` flag pattern (like `--hermes on|off`). No `--yes` needed: reversible, no privilege escalation.
- `!project list` / `show` render a `⛔ disabled` marker so state is visible at a glance.

## Scope

### In Scope
- `channels.json` schema: `projects[*].disabled?: boolean` (zod, default false)
- `!project set <slug> --disabled on|off` verb flag + help text
- Inbound gate in `server.ts` (Discord) + WhatsApp adapter path + Teams path
- Auto-stop of warm session on disable
- Throttled in-channel notice: `project disabled. use master to enable`
- Scheduler / autopilot / backlog-watch / bot-peer / `ask_project` skip for disabled projects
- `list`/`show` status marker
- Tests in `master-commands.test.ts` + `project-pool.test.ts`
- CLAUDE.md / README docs

### Out of Scope
- Auto-disable policies (e.g. disable on error budget breach) — future work
- Per-user disable (this is whole-channel)
- Disabling the master channel
- Timed re-enable (`--for 2h`)

## Impact

- **Files affected:** ~7 (`src/channels-config.ts`, `src/master-commands.ts`, `server.ts`, `src/project-pool.ts`, `src/scheduler.ts`, `src/whatsapp-adapter.ts`, tests + docs)
- **Complexity:** small–medium
- **Risk:** low — pure additive flag, default-off, no behavior change for existing configs

## Open Questions

1. Notice throttle window — once per 5 min per channel reasonable? Or reply to every message?
2. Should `disable` also pause scheduled jobs (proposed: yes, skip-not-delete) or let them queue?
3. Dedicated verbs `!project disable <slug>` / `enable <slug>` as sugar on top of `set --disabled`, or `set` flag only? (Proposed: `set` flag only, matches `--hermes` precedent.)

---

**To proceed:** Review this proposal and approve to begin planning.
