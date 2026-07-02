# Spec: MCD Autonomous Agent Force

**Change:** autonomous-agent-force
**Created:** 2026-06-26
**Status:** 🟡 Draft (refined from real MC data 2026-06-26)

## Fleet Reality (from data scan)

- **18 projects** — 13 Discord, 5 Teams, 1 WhatsApp
- **4 autonomous projects**: keyflow, claude-mcd, academy-videos, bistec-articles
- **Only 2 active schedules** (master heartbeat 30m, academy-videos 1h); several
  high-run loops (200+/74+ runs) are disabled — they ran out of work
- **5 projects with specclaw**: keyflow (105 changes), agent-nexus (49), nexus-dev
  (49), claude-mcd (11), life-month-3-worktree (3)
- **No GOALS.md files exist anywhere** — goals live in BACKLOG.md or specclaw STATUS.md
- **346 MB / 986 .jsonl transcript files** — rich source for pattern mining
- **No watchdog kills** in current epoch — stuck protection is working
- **Models**: sonnet default, opus for keyflow+bistec-articles, MiniMax for
  ai-core+academy-videos

## Overview

Five coupled upgrades that let MCD manage itself with minimal operator input.
Grounded in actual fleet patterns: only 4 autonomous channels need injection;
pattern mining targets only those 4 + any specclaw-active projects; GOALS.md
is introduced fresh (none exist) as a synthesis layer over BACKLOG.md + specclaw
STATUS.md; develop-branch workflow targets keyflow/agent-nexus/claude-mcd which
already have heavy specclaw change histories.

## Requirements

### Functional Requirements

**FR1 — Pattern Mining (targeted scope)**
`src/pattern-mining.ts` analyses `.jsonl` transcripts for a specific slug,
returning per-project metrics: avg turns/day, peak activity hour, token burn
rate, and recommended re-schedule interval in minutes. Scope: only runs for
projects that are (a) autonomous OR (b) have a `.specclaw/` directory — skip
inactive Teams mirrors and bare projects. With 986 .jsonl files across 346 MB,
mining one project must complete in <5s (single-pass, no full file read — use
readline streaming). Safe defaults when no transcripts: interval=480min,
peakHour=10, avgTurns=1.

**FR2 — Pattern-Driven Schedule Interval**
Scheduler entries tagged `autoSchedule: true` in schedules.json use pattern-
mining output as their `interval`. The existing disabled backlog-loop schedules
(s_mqmdkei1_m4wsqa etc.) should be updated to `autoSchedule: true` so they
self-tune instead of requiring manual interval adjustment. Pattern mining runs
lazily per-project on first use and is cached 6h in memory.

**FR3 — Operator Voice Extraction**
`src/behaviour-mirror.ts` exports `extractOperatorVoice(mcdDir)` which reads
operator messages (role=user, not tool_result) from the last 30 days of
transcripts across all projects that have operator activity. Builds a
`VoiceModel` with: vocabulary frequency map, sentence-length distribution,
common opener phrases, escalation triggers. With 986 files available this will
be rich. Returns empty model (safely) if no operator messages found.

**FR4 — Channel-Specific Voice Bias**
`buildInjectionMessage(slug, last10Messages, voiceModel, channelHistory?)`:
- Fleet voice model = baseline weighted 1×
- Channel-specific operator messages (last 50) = weighted 3×
- Produces a short motivational/directive injection ≤500 chars
- Caller prefixes `[auto] ` to the Discord-facing display; raw text (no prefix)
  goes to Claude via PTY

**FR5 — Autonomous Injection Sweep**
Master runs behaviour-mirror sweep every `injectSweepIntervalMinutes` (default
30 min). Targets only `heartbeat.mode === 'autonomous'` projects (currently 4:
keyflow, claude-mcd, academy-videos, bistec-articles). Per-channel checks:
1. Skip if circuit breaker open
2. Skip if `lastInjectedAt` within `injectCooldownMinutes` (default 60 min)
3. Hard cap: ≤3 injections per channel per 60-min rolling window
4. Skip if project was active in the last `stuckThresholdMinutes` (already working)
5. Skip if VoiceModel is empty (no operator history to mirror)
Otherwise: build message → `pool.deliver(chatId, rawText)` → update
`lastInjectedAt` in channels.json.

**FR6 — Injection Rate Fields in channels.json**
Per-project (optional): `lastInjectedAt` (ISO string), `injectCooldownMinutes`
(number, default 60). Defaults-level (optional): `injectSweepIntervalMinutes`
(number, default 30). All backward-compatible.

**FR7 — Spec Clarity Evaluation**
`src/spec-clarity.ts` exports `evaluateClarity(proposalText)` returning
`{ score: 0–100, gaps: string[], isLarge: boolean }`.
Large heuristic: solution section ≥300 words OR ≥5 AC bullet points OR ≥4
filenames mentioned. Score deductions: no problem statement (−30), no ACs
(−25), no scope (−20), ACs non-testable / < 3 bullets (−15), vague solution
< 50 words (−10). Score starts at 100.

**FR8 — Spec Gating (large proposals only)**
When master detects a new pending GOALS.md proposal:
1. `evaluateClarity` → if not large, proceed immediately.
2. If large AND score < 60: post Discord warning with `gaps` list; persist a
   `clarity-pending.json` sidecar.
3. Operator reply within 24h → launch `specclaw:spec-author` interactively;
   reset 24h timer.
4. No reply after 24h → auto-proceed with best-effort spec generation.

**FR9 — develop Branch Lifecycle**
`src/git-ops.ts` adds `gitCreateOrCheckoutDevelop(cwd, env?)` — idempotent.
Per-project flag `developBranch: boolean` in channels.json. New flag on
`!project set --develop-branch on|off`. Primarily useful for keyflow (105
changes) and agent-nexus (49 changes) where batching to main makes sense.

**FR10 — Specclaw Pipeline Guard**
New `src/specclaw-guard.ts`: `checkPipelineGreen(projectCwd)` reads
`.specclaw/STATUS.md`, parses phase table, returns `{ ok, blockedBy }`.
Called before any `git merge develop → main` or `gh pr create`. If STATUS.md
absent (project has no specclaw) → `{ ok: true }`.

**FR11 — Batch PR-to-main Trigger**
After a specclaw build completes on `develop`: evaluate (a) count proposals with
all phases 🟢 in STATUS.md that are not yet in main, (b) `git diff --stat
main...develop` line count. Both must exceed `batchThreshold` (proposals ≥5,
lines ≥500) to trigger PR. Run pipeline guard first; if green, `gh pr create
--base main --head develop`. Notify Discord either way.

**FR12 — GOALS.md Introduction**
No GOALS.md files exist today. Master creates them fresh for each project that
has `.specclaw/STATUS.md` (currently: keyflow, agent-nexus, nexus-dev, claude-mcd,
life-month-3-worktree). For projects with a `BACKLOG.md` (claude-mcd), GOALS.md
also imports a summary of BACKLOG.md completion status. Two sections:
`## Proposals` — checklist sourced from STATUS.md; `## Scheduling` — from
pattern mining output.

**FR13 — GOALS.md Nightly Reconcile**
Nightly cron 02:00 local: for each project with `.specclaw/` or `BACKLOG.md`,
write/update GOALS.md. Adds new STATUS.md entries; marks done items `[x]`;
preserves existing `## Notes` or operator-written sections verbatim.

### Non-Functional Requirements

- NFR1: Pattern mining streams `.jsonl` line-by-line (readline); no full file load into memory; <5s per project.
- NFR2: Injection Discord-display prefixed `[auto] `; PTY injection is clean text.
- NFR3: No injection when circuit breaker open.
- NFR4: All new channels.json fields optional; zero breaking changes to existing configs.
- NFR5: develop branch ops never force-push; git errors surface to Discord.
- NFR6: Injection sweep is fire-and-forget async; never delays message delivery.
- NFR7: Fleet-wide voice model built in background on server startup; injection sweep waits for it if not ready (≤2s timeout → skip).

## Acceptance Criteria

- AC1: `minePatterns(slug, mcdDir)` returns well-typed `PatternResult` with all fields for a slug with transcripts; returns safe defaults for a slug with no transcripts.
- AC2: `minePatterns` completes in <5s for a project with 10+ `.jsonl` files (verified in test with real data).
- AC3: A schedule with `autoSchedule: true` uses `recommendedIntervalMinutes` from pattern cache on next Scheduler tick.
- AC4: `extractOperatorVoice` returns non-empty VoiceModel when any project has operator messages; returns `{ baseline: [], channelMsgs: {} }` when none exist.
- AC5: `buildInjectionMessage` output is ≤500 chars and caller-prefixed `[auto] ` on Discord; raw text delivered to PTY.
- AC6: Sweep skips a channel if `lastInjectedAt` + `injectCooldownMinutes` > now.
- AC7: Hard cap: a channel cannot receive >3 injections in any rolling 60-min window; 4th attempt within window is silently skipped.
- AC8: `evaluateClarity` correctly classifies isLarge (≥5 ACs → large; ≤2 ACs → not large) and returns gap descriptions.
- AC9: Master posts Discord warning with specific gaps when large proposal scores < 60; proceeds after 24h with no reply.
- AC10: `gitCreateOrCheckoutDevelop` creates `develop` when absent; switches to it when present; idempotent on consecutive calls.
- AC11: `checkPipelineGreen` returns `{ ok: false, blockedBy: ['Build', 'Verify'] }` for STATUS.md with non-green build/verify phases; returns `{ ok: true }` for all-green or missing file.
- AC12: Batch PR fires only when BOTH proposal count AND line diff thresholds are met; notifies Discord if either threshold alone is met (progress update).
- AC13: Nightly reconcile creates GOALS.md for keyflow + agent-nexus + claude-mcd with `## Proposals` and `## Scheduling` sections; does not overwrite operator-written content.

## Edge Cases

- Project has no `.jsonl` files → `minePatterns` returns safe defaults; sweep still targets it if `heartbeat.mode === 'autonomous'`.
- All 986 `.jsonl` files exist but only 4 autonomous projects receive injections — pattern mining for non-autonomous projects is read-only for GOALS.md purposes only.
- `develop` branch ahead of `main`, not all specclaw phases green → pipeline guard blocks PR; notifies Discord: "Blocked: Build, Verify not green for change X".
- `gh` not authenticated → batch PR skips with Discord notification; re-evaluates on next build completion.
- Duplicate entry in GOALS.md (same slug twice) → reconciler deduplicates on write by slug.
- VoiceModel empty (no operator messages in fleet) → sweep skips all channels; no injection.
- `BACKLOG.md` exists (claude-mcd) → GOALS.md Proposals section imports done/pending counts from BACKLOG.md as a summary line, does not duplicate individual entries.

## Dependencies

- No new npm packages.
- `gh` CLI in PATH for FR11 (graceful skip if missing).
- Node.js `readline` (built-in) for streaming `.jsonl`.

## Notes

- `[auto]` prefix: Discord display only; PTY delivery is clean text.
- Pattern mining cache is in-process memory; server restart re-mines (fast, acceptable).
- `batchThreshold` lives in `defaults`; per-project override deferred.
- The 4 current autonomous projects (keyflow, claude-mcd, academy-videos, bistec-articles) are the primary injection targets. As more projects move to autonomous mode they are picked up automatically.
- keyflow (105 changes, opus model) and agent-nexus (49 changes) are the primary develop-branch targets.
