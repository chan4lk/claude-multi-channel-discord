# Spec: Schedule Auto-Pause on Reply Pattern (stopOnReply)

**Change:** schedule-stop-on-reply
**Created:** 2026-07-12
**Status:** 🟡 Draft

## Overview

Interval schedules keep firing after their goal is met (observed: 74/200/107 post-completion runs across three loop schedules), each wasted fire burning a full Claude turn to conclude "backlog complete". This change adds an opt-in `stopOnReply` regex to the schedule schema: when a project's outbound reply matches the pattern, the scheduler deterministically disables the schedule, persists, and posts a one-line notice to the master channel. The model no longer has to be trusted to "pause this schedule" itself.

## Requirements

### Functional Requirements

- **FR1** — `Schedule` schema accepts optional `stopOnReply: string`. Validation rejects strings that do not compile via `new RegExp(pattern, 'i')`. Existing `schedules.json` files load unchanged.
- **FR2** — `Scheduler.noteReply(chatId, text)`: for every enabled schedule targeting `chatId` with `stopOnReply` set and at least one prior fire (`lastRunAt != null`), test `text` against the pattern case-insensitively. On match: set `enabled: false`, persist via `saveSchedules`, log a diag line, and invoke `deps.onAutoPause?.(schedule, pattern)`.
- **FR3** — Window semantics (resolves the proposal's open question): any reply after any fire matches — i.e. eligibility is `enabled && stopOnReply && lastRunAt != null`. No timer bookkeeping.
- **FR4** — `server.ts` taps the pool's outbound reply path: for `reply.kind === 'text'`, call `scheduler?.noteReply(reply.chatId, reply.text)` regardless of platform (Discord/Teams/WhatsApp).
- **FR5** — `onAutoPause` is wired in `server.ts` to post `⏸ schedule <id> (<slug>) auto-paused — reply matched /<pattern>/` to the master channel.
- **FR6** — `!project schedule add` accepts `--stop-on-reply "<pattern>"`; invalid regex → usage error, nothing persisted. Confirmation output mentions the pattern.
- **FR7** — `schedule list` shows `⏹ stop-on-reply /<pattern>/` for schedules carrying the field.
- **FR8** — An invalid regex that somehow reaches `noteReply` (e.g. hand-edited schedules.json) must not throw — the schedule is skipped with a diag log line.

### Non-Functional Requirements

- **NFR1** — `noteReply` is cheap on the hot reply path: loads schedules only when at least one reply arrives; skips instantly when no schedule for that chatId has `stopOnReply`. No regex compilation per reply for non-participating chats.
- **NFR2** — Opt-in only: zero behavior change for schedules without the field.
- **NFR3** — Deterministic: pause happens in scheduler code, not agent behavior.

## Acceptance Criteria

- **AC1** — Schema: `stopOnReply: "backlog complete"` round-trips through save/load; a legacy file without the field parses; `stopOnReply: "("` (invalid regex) is rejected by the schema.
- **AC2** — `noteReply` match: fired schedule + reply "Backlog complete — nothing to do" (case differs) → `enabled` becomes false, persisted to disk, `onAutoPause` called once with the schedule.
- **AC3** — `noteReply` no-match: reply "still working" → schedule unchanged, `onAutoPause` not called.
- **AC4** — Never-fired schedule (`lastRunAt: null`) → not matched even when text matches.
- **AC5** — Already-disabled schedule → not re-processed (no duplicate `onAutoPause`).
- **AC6** — `schedule add <slug> --interval "every 30m" --prompt "x" --stop-on-reply "backlog complete"` persists the field; `--stop-on-reply "("` returns an error and persists nothing; `schedule list` shows `stop-on-reply`.
- **AC7** — `bun tsc --noEmit` clean; all existing suites stay green.

## Edge Cases

- Multiple schedules on the same chatId with different patterns: each evaluated independently; one reply can pause several.
- Reply from a chat with no schedules: `noteReply` returns after a cheap scan, no persist.
- Regex with user-hostile complexity: patterns come from the operator (allowlisted master channel), not untrusted input — no ReDoS mitigation beyond that trust boundary.
- Chunked replies (2000-char Discord split) happen after the tap — `noteReply` sees the full text once.
- `onAutoPause` dep absent (tests/embedders) → pause still happens, notice skipped.

## Dependencies

- Pool outbound reply path (`server.ts` pool `onReply`, `src/project-pool.ts:534` fan-out) — exists.
- `saveSchedules` atomic persist — exists.

## Notes

Complements P302 (`onlyWhenIdle`): idle-gating stops mid-flight pile-ups; stopOnReply stops post-completion burn. Together they make unattended loop schedules self-terminating.
