# Tasks: MCD Autonomous Agent Force

**Change:** autonomous-agent-force
**Created:** 2026-06-26
**Total Tasks:** 12

## Summary

12 tasks across 4 waves. Wave 1 lays the schema + pure utility modules with no
server-side effects. Wave 2 wires the scheduler behaviour. Wave 3 adds git
develop-branch workflow and pipeline guard. Wave 4 wires everything into
server.ts, updates master.CLAUDE.md, and adds GOALS.md reconcile. Each wave
can be built and typechecked independently.

## Tasks

### Wave 1 — Schema + Pure Utilities

- [x] `T1` — Extend channels.json schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Depends: —
  - Notes: Add optional fields to Project zod schema: `lastInjectedAt`, `injectCooldownMinutes` (default 60). Add to Defaults schema: `batchThreshold` (object, defaults proposals:5 lines:500), `injectSweepIntervalMinutes` (default 30). All fields optional for backward compat.

- [x] `T2` — Add `projectGoalsMd(slug)` to paths
  - Files: `src/paths.ts`
  - Estimate: small
  - Depends: —
  - Notes: Returns `path.join(projectDir(slug), 'GOALS.md')`. Follow existing pattern.

- [x] `T3` — Create `src/pattern-mining.ts`
  - Files: `src/pattern-mining.ts` (new)
  - Estimate: medium
  - Depends: `T2`
  - Notes: Export `PatternResult { avgTurnsPerDay, peakHour, tokenBurnPerHour, recommendedIntervalMinutes }` and `minePatterns(slug, mcdDir, days=30): PatternResult`. **Use readline streaming** (not fs.readFileSync) — fleet has 986 .jsonl files / 346 MB, never load whole files into memory. Scan `~/.claude/projects/<encoded>/transcripts/*.jsonl` (use encodeProjectCwd + realpathSync pattern from claude-process.ts). Count genuine user turns (role==='user', content[0].type !== 'tool_result'). Bucket by hour-of-day for peakHour. Sum token usage from assistant messages. recommendedIntervalMinutes = max(60, 1440 / max(1, avgTurnsPerDay)). Return safe defaults on any error. Target: <5s per project.

- [x] `T4` — Create `src/behaviour-mirror.ts`
  - Files: `src/behaviour-mirror.ts` (new)
  - Estimate: medium
  - Depends: —
  - Notes: Export `VoiceModel { sentences: string[], avgLength: number, vocabulary: Set<string> }` and `extractOperatorVoice(mcdDir): VoiceModel` (reads last 200 operator messages across all project transcripts). Export `buildInjectionMessage(slug, last10Messages, voiceModel, channelMsgs?): string`. Message construction: pick 1–3 vocabulary words from voiceModel, build an encouraging prompt sentence matching avgLength, append relevant context from last10. Always ≤500 chars. Returns empty string if voiceModel has no sentences. The `[auto]` prefix is added by the caller (server.ts), NOT inside this function.

- [x] `T5` — Create `src/spec-clarity.ts`
  - Files: `src/spec-clarity.ts` (new)
  - Estimate: small
  - Depends: —
  - Notes: Export `ClarityResult { score: number, gaps: string[], isLarge: boolean }` and `evaluateClarity(proposalText: string): ClarityResult`. isLarge = solution section word count ≥300 OR AC bullet count ≥5 OR filename count ≥4. Score deductions: no "## Problem" section (−30), no "## Acceptance Criteria" or AC bullets (−25), no "## Scope" section (−20), ACs < 3 bullets (−15), solution section < 50 words (−10). gaps is a list of human-readable gap descriptions. Start score at 100.

- [x] `T6` — Create `src/specclaw-guard.ts`
  - Files: `src/specclaw-guard.ts` (new)
  - Estimate: small
  - Depends: —
  - Notes: Export `GuardResult { ok: boolean, blockedBy: string[] }` and `checkPipelineGreen(projectCwd: string): GuardResult`. Read `<projectCwd>/.specclaw/STATUS.md`. Parse all phase rows from the Progress table. A phase is green if its Status cell contains `🟢`. If STATUS.md doesn't exist → return `{ ok: true, blockedBy: [] }`. blockedBy lists phase names that are not green.

### Wave 2 — Scheduler & Injection

- [x] `T7` — Add `gitCreateOrCheckoutDevelop` to git-ops
  - Files: `src/git-ops.ts`
  - Estimate: small
  - Depends: —
  - Notes: Export `gitCreateOrCheckoutDevelop(cwd: string, env?: NodeJS.ProcessEnv): GitResult`. Check `runGit(cwd, ['branch', '--list', 'develop'])`. If empty → `runGit(cwd, ['checkout', '-b', 'develop'])`. If exists → `runGit(cwd, ['checkout', 'develop'])`. Return result of final git call.

- [x] `T8` — Wire behaviour-mirror sweep into Scheduler
  - Files: `src/scheduler.ts`
  - Estimate: medium
  - Depends: `T1`, `T4`
  - Notes: Add `registerBehaviourMirrorSweep(pool, config, channels, voiceModelFn)` method. Runs every `injectSweepIntervalMinutes` (from defaults). Per-channel logic: skip if circuit open; skip if `lastInjectedAt` within `injectCooldownMinutes`; hard cap: maintain `Map<chatId, number[]>` of injection timestamps in the last 60 min — skip if count ≥ 3. Call `voiceModelFn()` (returns cached VoiceModel). Build message via `buildInjectionMessage`. Call `pool.deliver(chatId, text)`. Update `lastInjectedAt` in channels.json (atomic write via existing `saveChannels`). Auto-schedule support: if a schedule has `autoSchedule: true`, replace its `interval` with `patternCache.get(slug)?.recommendedIntervalMinutes` before evaluating `isDue()`.

- [x] `T9` — Add develop-branch verb to master-commands + batch PR trigger
  - Files: `src/master-commands.ts`
  - Estimate: medium
  - Depends: `T1`, `T6`, `T7`
  - Notes: (a) Add `--develop-branch on|off` flag to `handleSet`. Toggle `project.developBranch` in channels.json. (b) Add `branch` verb handler `handleBranch(rest[], ctx)`: `!project branch <slug> create` → `gitCreateOrCheckoutDevelop(projectDir(slug), env)` → reply result. (c) Add `evaluateBatchPr(slug, ctx)` function called after any build completion event: run `git diff --stat main...develop` in project cwd → parse line count; count `.specclaw/STATUS.md` proposals with all phases 🟢; if both ≥ thresholds → `checkPipelineGreen(cwd)` → if ok, shell `gh pr create --base main --head develop --title "chore: batch proposals" --body "..."` → notify Discord.

### Wave 3 — GOALS.md Registry

- [x] `T10` — GOALS.md writer + nightly reconcile cron
  - Files: `src/scheduler.ts` (modify), `src/paths.ts` (already done T2)
  - Estimate: medium
  - Depends: `T2`, `T3`, `T8`
  - Notes: Add `registerGoalReconcileCron(channels, mcdDir)` to Scheduler. Fires at 02:00 local daily. Targets projects with `.specclaw/STATUS.md` (keyflow, agent-nexus, nexus-dev, claude-mcd, life-month-3-worktree) plus any with BACKLOG.md. No GOALS.md files exist today — create fresh. Parse STATUS.md change list (change names + phase statuses). Preserve non-Proposals/non-Scheduling sections of existing GOALS.md. Write `## Scheduling` from `minePatterns()`. Write `## Proposals` checklist — `[x]` if all phases 🟢. For claude-mcd: add a summary line "BACKLOG.md: N done / M pending" (don't import individual BACKLOG items). Atomic write via `fs.writeFileSync`.

- [x] `T11` — Spec-clarity gating wired into GOALS.md processing
  - Files: `src/master-commands.ts` (or new `src/goals-processor.ts`)
  - Estimate: small
  - Depends: `T5`, `T10`
  - Notes: When master detects a new `[ ] pending` entry in GOALS.md (reconcile run adds it), call `evaluateClarity(proposalText)`. If `isLarge && score < 60`: post Discord warning via `mcp__mcd__reply` with gaps list; store `clarityWarningAt: ISO` in a sidecar file `.specclaw/changes/<slug>/clarity-pending.json`. On next reconcile tick, check if `clarityWarningAt` is >24h ago with no human reply → proceed. The 24h timer resets if any message arrives in that channel referencing the warning.

### Wave 4 — Integration & Docs

- [x] `T12` — Wire everything in server.ts + update master.CLAUDE.md
  - Files: `server.ts`, `templates/master.CLAUDE.md`
  - Estimate: medium
  - Depends: T1–T11
  - Notes: In server.ts `buildMutator()`: call `minePatterns` for each active project on startup (background, non-blocking); build initial `VoiceModel` via `extractOperatorVoice`; call `scheduler.registerBehaviourMirrorSweep(...)` and `scheduler.registerGoalReconcileCron(...)`. In master.CLAUDE.md: add "## Autonomous Agent Force" section explaining: `[auto]` injection messages (don't reply to them as if human), develop branch workflow (`!project branch <slug> create`), GOALS.md format and how to add proposals, spec-clarity warnings and how to respond.

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
