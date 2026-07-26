# Spec: Project disable switch

**Change:** project-disable-switch
**Created:** 2026-07-26
**Status:** 🟡 Draft

## Overview

Add a per-project `disabled` flag that takes a project channel offline without deleting it. When disabled, inbound messages never reach (or spawn) the project's Claude subprocess; the bot instead posts a throttled notice `project disabled. use master to enable`. Toggled from the master channel via `!project set <slug> --disabled on|off`. Approved decisions: notice throttled to once per 5 minutes per channel; scheduled jobs are skipped (not queued) while disabled; `set` flag only (no sugar verbs).

## Requirements

### Functional Requirements

- **FR1** — `channels.json` supports `projects[*].disabled?: boolean`. Absent or `false` = enabled (no behavior change for existing configs).
- **FR2** — `!project set <chat_id-or-slug> --disabled on|off` toggles the flag. Master-channel only, allowFrom-gated (existing `set` plumbing). No `--yes` required (reversible, grants no reach). Invalid values (anything but `on`/`off`) return a usage error.
- **FR3** — Targeting the master project with `--disabled on` is refused with a warning (master can never be disabled), same pattern as the `--hermes` master guard.
- **FR4** — `ProjectPool.deliver()` short-circuits for disabled projects: no subprocess spawn, no delivery, no dedup recording, no budget/circuit processing. A `disabled-drop` pool event fires instead.
- **FR5** — On a `disabled-drop` event originating from any platform (Discord, Teams, WhatsApp), the server posts `project disabled. use master to enable` to the originating channel, throttled to at most once per 5 minutes per channel (in-memory throttle; resets on server restart).
- **FR6** — `set --disabled on` also stops the project's warm session if one exists (same kill path as `!project stop`). Confirmation message states both actions.
- **FR7** — The scheduler tick skips due schedules whose project is disabled, logging a `skipped` entry (schedule kept, not fired, not deleted). Autopilot and backlog-watch sweeps skip disabled projects.
- **FR8** — `ask_project` targeting a disabled project returns an error result (`target project is disabled`) instead of delivering.
- **FR9** — Bot-peer inbound to a disabled project is dropped via the same pool gate (FR4) and produces the same throttled notice (FR5).
- **FR10** — `!project list` marks disabled projects with `⛔`; `!project show <target>` includes a `disabled: yes` line when set.
- **FR11** — `set --disabled off` re-enables: next inbound message spawns/resumes the session normally (via `.session-id` resume, unchanged).
- **FR12** — Auto-disable sweep: `defaults.autoDisable?: { enabled: boolean, idleDays?: number }` (built-in fallback idleDays 7, clamp <1 → 7). When enabled, an hourly scheduler sweep disables any non-master, not-already-disabled project whose idle time exceeds `idleDays`. Per-project opt-out: `projects[*].autoDisable?: boolean` overrides the default (false = never auto-disable this project).
- **FR13** — Idle signal: mtime of the newest session-transcript `.jsonl` under the project's realpath-encoded transcript dir (same encoding as heartbeat/watchdog). Any activity — human message, schedule fire, autopilot nudge, bot-peer turn — touches the transcript, so active projects self-protect. Projects with no transcript at all are skipped (no measurable signal).
- **FR14** — Each auto-disable posts a master-channel notice: `⛔ auto-disabled <slug> — idle <N>d. re-enable: !project set <slug> --disabled off`.
- **FR15** — Auto-disable writes the same `disabled: true` flag as the manual toggle — re-enable path, gate behavior, and markers identical. One runtime field supports the sweep: `set --disabled off` stamps `projects[*].enabledAt` (ISO timestamp); the sweep computes idle from `max(transcript mtime, enabledAt)` so a re-enabled project gets a fresh idle window. `--disabled on` / auto-disable remove the stamp.

### Non-Functional Requirements

- **NFR1** — Additive, default-off: an unmodified `channels.json` parses and behaves identically.
- **NFR2** — Gate check is O(1) per message (flag read from already-loaded config; no extra IO).
- **NFR3** — Follows existing conventions: zod optional field, injectable deps for tests, pool event + server-side dispatch for notices.

## Acceptance Criteria

- **AC1** — Config with `disabled: true` on a project parses; config without the field parses with prior behavior.
- **AC2** — `deliver()` to a disabled project: MockProjectProcess receives nothing, no spawn occurs, `disabled-drop` event fires with correct chatId/slug.
- **AC3** — `set <slug> --disabled on` persists `disabled: true`, kills a warm session when present, and confirms. `set <slug> --disabled off` removes/falsifies the flag and confirms.
- **AC4** — `set master-slug --disabled on` refused with warning; config unchanged.
- **AC5** — `set <slug> --disabled maybe` returns usage error.
- **AC6** — Scheduler tick with an `isProjectDisabled` dep returning true does not call `pool.deliver` for that schedule and logs status `skipped`; other projects' schedules still fire.
- **AC7** — Autopilot sweep and backlog-watch sweep iterate past disabled projects without action.
- **AC8** — `ask_project` to a disabled target returns an error result; no delivery.
- **AC9** — `list` output contains `⛔` for the disabled project; `show` contains `disabled: yes`.
- **AC10** — Notice throttle: two `disabled-drop` events within 5 min produce one notice; a third after the window produces a second notice.
- **AC11** — `bun tsc --noEmit` clean; all existing test suites pass.
- **AC12** — Sweep with `autoDisable.enabled: true` and a project idle > idleDays: flag persisted, master notice fired. Idle < idleDays: untouched.
- **AC13** — Sweep skips: master, already-disabled projects, projects with `autoDisable: false`, projects with no transcript.
- **AC14** — Sweep disabled (`enabled` absent/false): nothing happens regardless of idleness.
- **AC15** — Auto-disabled project re-enabled via `set --disabled off` behaves exactly like a manually-disabled one.

## Edge Cases

- Disable while a turn is in flight: `killChat` behaves as `!project stop` — session dies, transcript remains, resume on re-enable.
- Disabled project with `monthlyTokenBudget`: gate runs before budget logic, so nothing is queued to the budget queue while disabled.
- Duplicate message IDs during disabled window: dedup intentionally not recorded; a message re-sent after re-enable delivers normally.
- Scheduler without the `isProjectDisabled` dep (older callers/tests): fail-open, schedules fire as before, pool gate still protects.
- WhatsApp/Teams notice delivery: reuse the existing platform-routing outbound path (`routeNotification`), so notices land on the right platform.
- `rm`/`rename` of a disabled project: unaffected — flag lives in the project entry and is archived/renamed with it.
- Auto-disable vs freshly created project: no transcript yet → skipped, never auto-disabled before first use.
- Re-enabled project whose transcript is still >idleDays old would be re-disabled by the next hourly sweep. Fix: `set --disabled off` stamps `enabledAt` (ISO) on the entry; sweep treats idle as `now − max(transcript mtime, enabledAt)`. Manual `--disabled on` and auto-disable both clear the stamp.
- Clock skew / mtime in future: negative idle treated as active.

## Dependencies

None new. Touches existing: zod schema, ProjectPool, Scheduler, MasterMcpServer, master-commands, server.ts outbound routing.

## Notes

Operator decisions (2026-07-26): throttle 5 min OK; schedules skip not queue; no sugar verbs.
