# Proposal: Backlog autopilot

**Created:** 2026-07-18
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The operator's standard working pattern — "create a backlog for this project, then loop through all items" — is an entirely manual ritual today: ask the project's Claude to write `BACKLOG.md`, then repeatedly nudge "continue" (or set up an ad-hoc schedule by hand) until every item is done. MCD already has every ingredient of an autonomous work loop shipped separately — idle-gated schedules, `stopOnReply`, specclaw halt-gating with master-channel escalation (`src/scheduler.ts:84-199`), heartbeat autonomous mode with active windows, and the specclaw lifecycle itself — but no verb ties them into "drive this project through its backlog until it's empty." Each new project means re-assembling the loop by hand, and the operator is the scheduler.

## Proposed Solution

_What are we building? High-level approach._

A per-project **autopilot mode** that makes MCD the loop driver:

- **`!project set <slug> --autopilot on|off`** — persisted as `autopilot: { enabled, file?, intervalMinutes?, window? }` on the project entry in `channels.json`.
- **Backlog source, two flavors (auto-detected):**
  1. *Specclaw project* (`.specclaw/` present): backlog = pending proposals + active changes with incomplete tasks, read from `STATUS.md`/`tasks.md`. Nudge drives the lifecycle: plan approved proposals, `/specclaw:loop` through build→verify, stop at PR.
  2. *Plain project*: backlog = markdown checkboxes in `BACKLOG.md` (path overridable). Nudge = "work the next unchecked item, check it off when done."
- **Loop mechanics — reuse, don't rebuild:** autopilot materializes as a managed scheduler job (interval, `idleGate: true`, `stopOnReply` semantics inverted — keep firing while items remain). Existing specclaw halt probe + `onEscalate` hook already suspend the loop and ping the master channel when verify goes red or tasks fail.
- **Progress + termination:** checkbox/task count snapshot per fire; N consecutive fires with zero delta → halt + escalate ("backlog stalled at X/Y"). All items done → autopilot announces completion to the channel + master, disables its job (config flag stays on, re-arms when new items appear).
- **Backlog creation is MCD's job (core, not stretch):** enabling autopilot on a project with no backlog triggers the **seed phase** — MCD injects a one-shot backlog-authoring prompt (`!project set <slug> --autopilot on --seed "<goal>"`; without `--seed`, the prompt derives the goal from the project's CLAUDE.md). The project's Claude drafts `BACKLOG.md` (checkbox format, prioritized) or specclaw proposals; MCD verifies the file/changes appeared before arming the loop, and escalates to master if the seed turn produced nothing. Autopilot state machine: `seeding → running → (idle-gated | halted | complete)`.
- **`!project backlog <slug>`** — status verb: source file, X/Y done, last progress time, autopilot state (seeding / running / idle-gated / halted / complete).

## Scope

### In Scope
- `src/channels-config.ts`: `autopilot` schema on project + defaults
- `src/master-commands.ts`: `--autopilot` set flag + `backlog` verb + help text
- `src/backlog.ts` (new): backlog discovery/parsing (checkboxes + specclaw status), seed-prompt builder + seed verification, progress snapshots, nudge-prompt builder
- `src/scheduler.ts` / `server.ts`: managed autopilot job wiring (create/remove on toggle), no-progress halt + escalation, completion announcement
- Tests for parsing, toggle round-trip, stall detection, specclaw-vs-plain detection

### Out of Scope
- Changing the specclaw plugin itself (its `/specclaw:loop` and halt semantics are consumed as-is)
- Cross-project backlog orchestration (one autopilot per project)
- Auto-merge of PRs — loop stops at PR-open; merging stays human (or bot-peer reviewer)
- Backlog content quality — what Claude writes into BACKLOG.md is the project prompt's job

## Impact

- **Files affected:** 6-7 (estimated) — 1 new module, 4-5 touched, tests
- **Complexity:** medium
- **Risk:** medium — an unattended injection loop can burn tokens on a stuck project; mitigated by existing idle gate, halt probe, no-progress stall detection, heartbeat window reuse, and master-channel escalation on every halt path

## Open Questions

- Default interval: 30 min? And should autopilot respect the project's `heartbeat.window` by default so it sleeps overnight?
- No-progress threshold: 3 consecutive zero-delta fires?
- Seed timeout: how long to wait for BACKLOG.md to appear before escalating (one turn? 15 min)?
- When both `BACKLOG.md` and `.specclaw/` exist, specclaw wins — acceptable, or explicit `file:` override required?

---

**To proceed:** Review this proposal and approve to begin planning.
