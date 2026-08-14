# Proposal: Channel Deletion Watch

**Created:** 2026-08-14
**Status:** 🟡 Draft

## Problem

_What problem are we solving? Why does it matter?_

The master heartbeat report lists stale projects but offers no follow-up action. Worse, when a project's Discord channel is deleted outright, the project lingers indefinitely: its entry stays in `channels.json`, its working tree stays on disk, and it keeps showing up as heartbeat noise. Nothing distinguishes "channel deleted, project is dead" from "channel exists, project merely idle" — the auto-disable sweep only sees transcript idleness, so orphaned projects accumulate as dead config and disk weight with no path to cleanup.

Observed trigger: operator deletes Discord channels for finished experiments; the corresponding MCD projects survive forever unless hand-removed.

## Proposed Solution

_What are we building? High-level approach._

Detect deleted Discord channels and route a removal decision to the operator — MCD never auto-deletes.

1. **Detection, two paths:**
   - **Gateway event:** subscribe to discord.js `channelDelete`; when the deleted channel id matches a project, mark the project's runtime state `channelMissingSince` immediately.
   - **Hourly sweep:** `Scheduler.registerChannelExistenceSweep()` fetches each Discord project's channel via the REST API. A 404 (`Unknown Channel`, code 10003) marks `channelMissingSince`; transient errors (rate limit, network, 5xx) are ignored — only a definitive 404 counts.
2. **Grace period:** a project must be missing on **2 consecutive sweep checks** (or gateway event + 1 sweep confirm) before any prompt fires. Any successful fetch clears `channelMissingSince`.
3. **Operator prompt:** after confirmation, master channel gets:
   `🗑 channel for **<slug>** was deleted — remove project + files? run: !project rm <slug> --yes --purge` — asked once, re-nagged at most weekly (`lastMissingAlertAt` runtime stamp).
4. **New `--purge` flag on `rm`:** today `rm --yes` soft-deletes to `projects/.archive/<slug>-<ts>`. `rm --yes --purge` hard-deletes the project directory (realpath-guarded: refuses to purge if the project dir is a symlink pointing outside `MCD_CHANNELS_DIR` — symlinked repos get the symlink removed, never the target). Double-gated: both flags required, allowFrom-gated like all destructive verbs.
5. While confirmed-missing, the project is treated as disabled for delivery purposes (nothing can arrive from a deleted channel anyway; scheduler/autopilot skips log honestly).

## Scope

### In Scope
- discord.js `channelDelete` handler + hourly existence sweep (`src/scheduler.ts`, `server.ts`)
- Runtime fields `channelMissingSince` / `lastMissingAlertAt` on project entries (`src/channels-config.ts`)
- Master notification with exact removal command
- `--purge` flag on `!project rm` (`src/master-commands.ts`) with symlink guard
- Tests for sweep decision logic, 404-vs-transient classification, purge path guard

### Out of Scope
- Teams / WhatsApp channel-existence checks (v1 is Discord-only)
- Auto-removal without operator confirmation (never)
- Stale-but-existing channel cleanup policy (auto-disable sweep already covers idleness)
- Archive retention/GC for `.archive/` (separate concern)

## Impact

- **Files affected:** ~5 (estimated) — `server.ts`, `src/scheduler.ts`, `src/master-commands.ts`, `src/channels-config.ts`, tests
- **Complexity:** medium (small / medium / large)
- **Risk:** medium (low / medium / high) — worst case is a false "channel deleted" prompt; mitigated by 404-only classification, 2-check grace, and the operator being the sole trigger for deletion. Purge itself is the only destructive surface and is double-gated + symlink-guarded.

## Open Questions

- Should a confirmed-missing project be auto-flagged `disabled: true` (reusing the existing switch) instead of a bespoke delivery skip?
- Should `rm --purge` also delete the project's session transcripts under `~/.claude/projects/`? (Default: no — transcripts are outside `MCD_CHANNELS_DIR`.)
- Weekly re-nag cadence OK, or prefer single-ask-then-silent?

---

**To proceed:** Review this proposal and approve to begin planning.
