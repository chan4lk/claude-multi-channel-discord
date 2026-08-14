# Spec: Channel Deletion Watch

**Change:** 030-channel-deletion-watch
**Created:** 2026-08-14
**Status:** 🟡 Draft

## Overview

Detect when a Discord project's channel has been deleted, confirm the deletion across a grace period, then ask the operator (in the master channel) whether to remove the project — including a new hard-delete path (`rm --purge`) that removes the working tree from disk instead of archiving it. MCD never deletes anything on its own; the operator is the sole trigger.

## Requirements

### Functional Requirements

- **FR1 — Gateway detection:** `server.ts` subscribes to the discord.js `channelDelete` event. When the deleted channel's id matches a registered project (`platform` discord or absent), the project's `channelMissingSince` runtime field is set to the current ISO timestamp (if not already set).
- **FR2 — Hourly existence sweep:** `Scheduler.registerChannelWatchSweep()` runs hourly. For every non-master project on the discord platform it calls an injected `channelExists(chatId)` probe:
  - `'missing'` (definitive Unknown Channel, Discord error code 10003 / HTTP 404) ⇒ set `channelMissingSince` if unset.
  - `'exists'` ⇒ clear `channelMissingSince` and `lastMissingAlertAt` if set.
  - `'unknown'` (rate limit, network error, 5xx, missing-access 50001) ⇒ no state change.
- **FR3 — Grace before prompting:** the master prompt fires only when `channelMissingSince` is set AND at least `graceMinutes` (built-in 90, ≥2 sweep ticks) have elapsed at sweep time. The gateway event alone never prompts — a later sweep must still see the channel missing.
- **FR4 — Operator prompt:** on confirmation the master channel receives:
  `🗑 channel for **<slug>** was deleted — remove project + files? run: !project rm <slug> --yes --purge (or keep archive: !project rm <slug> --yes)`
  `lastMissingAlertAt` is stamped; re-prompt no more than every 7 days while the project remains registered and missing.
- **FR5 — `rm --purge`:** `!project rm <target> --yes --purge` behaves like `rm --yes` except the working dir is hard-deleted instead of moved to `projects/.archive/`:
  - If `projects/<slug>` is a **symlink**, only the symlink is removed — the target is never touched.
  - If a real directory, it must resolve (realpath) to a path under `MCD_CHANNELS_DIR/projects/`; otherwise refuse with an explanatory error and delete nothing.
  - Without `--yes`, the confirmation text documents both archive and purge outcomes.
- **FR6 — Master exclusion & platform scope:** the master project is never probed or prompted. Teams/WhatsApp projects are skipped by the sweep (v1 Discord-only).
- **FR7 — Config schema:** `channelMissingSince` and `lastMissingAlertAt` are optional MCD-maintained ISO string fields on the project entry (zod, documented as not operator-set). Sweep state survives restarts via `channels.json`.
- **FR8 — Visibility:** `!project list` marks confirmed-missing projects with `🗑` (analogous to `⛔` for disabled). `!project show <slug>` includes a `channel: missing since <date>` line when set.

### Non-Functional Requirements

- **NFR1 — No false-positive deletes:** only Discord error code 10003 (Unknown Channel) counts as missing. All other errors are treated as transient. Tests must cover the classification.
- **NFR2 — Injectable side effects:** the probe (`channelExists`), clock (`nowMs`), and notifier are constructor/opts-injected per the project pattern — tests never touch Discord.
- **NFR3 — Read-fresh-before-write:** sweep state writes re-read `channels.json` immediately before saving (same pattern as `runAutoDisableSweep`) to avoid clobbering concurrent mutations.
- **NFR4 — Throttled notifications:** master prompts route through `routeNotification` like other sweep alerts.

## Acceptance Criteria

- **AC1:** `channelDelete` for a registered project's channel sets `channelMissingSince`; for an unregistered channel it is a no-op.
- **AC2:** Sweep with probe returning `'missing'` sets `channelMissingSince` on first tick; no master prompt before `graceMinutes` elapse.
- **AC3:** Sweep after grace elapses posts exactly one master prompt containing the slug and the `rm <slug> --yes --purge` command, and stamps `lastMissingAlertAt`.
- **AC4:** Subsequent sweeps within 7 days do not re-prompt; after 7 days a reminder fires.
- **AC5:** Probe returning `'exists'` clears both runtime fields (channel restored / false alarm) — verified after a prior missing state.
- **AC6:** Probe returning `'unknown'` changes nothing — a project mid-grace stays mid-grace, a clean project stays clean.
- **AC7:** `rm <slug> --yes --purge` on a real directory under `projects/` deletes it (no `.archive/` copy) and removes the project from `channels.json` + access groups.
- **AC8:** `rm --purge` on a symlinked project dir removes only the symlink; the link target survives.
- **AC9:** `rm --purge` refuses when the dir realpath escapes `projects/` (tampered layout), deleting nothing.
- **AC10:** Master project: never probed, never prompted, `rm` still refuses regardless of flags.
- **AC11:** Teams/WhatsApp projects are skipped by the sweep.
- **AC12:** `bun tsc --noEmit` clean; all existing test suites still pass.

## Edge Cases

- Channel deleted while MCD is down → gateway event missed; hourly sweep catches it (FR2 is the source of truth, FR1 is just early marking).
- Channel id reused/restored (rare, or bot re-invited to a recreated channel with same id) → `'exists'` clears state (AC5).
- Bot kicked from guild → fetch yields Missing Access (50001), classified `'unknown'`, no prompt — being kicked is not channel deletion.
- Project already `disabled: true` → still probed and prompted (deletion cleanup is orthogonal to the offline switch).
- `channelMissingSince` set, operator runs plain `rm --yes` → archive path works as today; prompt logic dies with the registry entry.
- Sweep fires while `rm` is mid-flight → read-fresh-before-write means the sweep's save can't resurrect a deleted project (it skips entries absent from the fresh read).

## Dependencies

- discord.js `Client` (already a `server.ts` dependency) — `client.channels.fetch()` and `Events.ChannelDelete`.
- Existing patterns: `registerAutoDisableSweep` (sweep + runtime fields), `routeNotification` (master alerts), `handleRm` (removal flow).

## Notes

- Auto-flagging missing projects as `disabled: true` was considered and rejected for v1: nothing can arrive from a deleted channel anyway, and reusing the disabled flag would tangle the two features' runtime stamps. Open question resolved as "no".
- Transcripts under `~/.claude/projects/` are NOT touched by `--purge` (outside `MCD_CHANNELS_DIR`).
