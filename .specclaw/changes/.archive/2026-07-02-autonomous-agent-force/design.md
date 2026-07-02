# Design: MCD Autonomous Agent Force

**Change:** autonomous-agent-force
**Created:** 2026-06-26

## Technical Approach

Five new modules wired together via the existing scheduler and server startup
hook. No new external dependencies. All state lives in the existing channels.json
and on-disk transcript files. The behaviour mirror is a pure TypeScript function
— no LLM call; it uses statistical text analysis (sentence length distribution,
vocabulary frequency) to synthesise a style-consistent message given the last 10
turns as context. Pattern mining is a streaming single-pass `.jsonl` scan
(readline, never loads whole file) — critical given 986 files / 346 MB.

**Injection targets are bounded**: only 4 projects currently have
`heartbeat.mode === 'autonomous'` (keyflow, claude-mcd, academy-videos,
bistec-articles). Sweep iterates those 4 only, not all 18 projects.

**No GOALS.md files exist today** — they are created fresh by the nightly
reconcile cron, sourced from `.specclaw/STATUS.md` per project. Projects with
`BACKLOG.md` (claude-mcd) get a summary import line, not a full copy.

**develop-branch workflow** is opt-in per project (`developBranch: true`).
Primary candidates: keyflow (105 specclaw changes), agent-nexus (49),
claude-mcd (11).

## Architecture

```
server.ts (startup)
  ├─ minePatterns() → PatternCache (6h TTL)
  ├─ extractOperatorVoice() → VoiceModel (1h TTL)
  ├─ Scheduler.registerBehaviourMirrorSweep(30m)
  └─ Scheduler.registerGoalReconcileCron(02:00)

Scheduler (tick 60s)
  ├─ autoSchedule jobs → use PatternCache.recommendedIntervalMinutes
  ├─ behaviourMirrorSweep() [async, non-blocking]
  │    ├─ for each autonomous channel:
  │    │    skip: circuit open / lastInjectedAt < cooldown / active
  │    │    buildInjectionMessage(slug, last10, voiceModel)
  │    │    pool.deliver(chatId, "[auto] " + msg)    ← tag for Discord display only
  │    │    update channels.json: lastInjectedAt
  │    └─ hard cap: track per-channel injection timestamps in memory (60m window)
  └─ goalReconcileCron() [nightly 02:00]
       ├─ for each project: read .specclaw/STATUS.md
       └─ write GOALS.md (## Proposals + ## Scheduling sections)

src/spec-clarity.ts
  └─ evaluateClarity(text) → { score, gaps, isLarge }
       used by: master command handler when a new GOALS.md proposal is detected

src/pattern-mining.ts
  └─ minePatterns(slug, mcdDir, days=30) → PatternResult
       reads: ~/.claude/projects/<encoded>/transcripts/*.jsonl

src/behaviour-mirror.ts
  ├─ extractOperatorVoice(mcdDir) → VoiceModel
  └─ buildInjectionMessage(slug, last10, voiceModel, channelMsgs?) → string

src/git-ops.ts  [additive]
  └─ gitCreateOrCheckoutDevelop(cwd, env?) → GitResult

Specclaw pipeline guard (inline in master-commands.ts or new src/specclaw-guard.ts)
  └─ checkPipelineGreen(projectCwd) → { ok, blockedBy }
       reads: .specclaw/STATUS.md

Batch PR trigger (inline in master-commands.ts handleBuildComplete or new helper)
  └─ evaluateBatchPr(slug, mcdDir, config) → void
       git diff --stat main...develop → line count
       count proposals in .specclaw/STATUS.md with phase=Verify 🟢
       if both thresholds met: checkPipelineGreen → gh pr create
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/pattern-mining.ts` | CREATE | `minePatterns()`, `PatternResult` type, 6h in-memory cache |
| `src/behaviour-mirror.ts` | CREATE | `extractOperatorVoice()`, `VoiceModel`, `buildInjectionMessage()` |
| `src/spec-clarity.ts` | CREATE | `evaluateClarity()`, `ClarityResult`, large-proposal heuristic |
| `src/specclaw-guard.ts` | CREATE | `checkPipelineGreen()` — reads STATUS.md, returns ok/blockedBy |
| `src/git-ops.ts` | MODIFY | Add `gitCreateOrCheckoutDevelop()` |
| `src/scheduler.ts` | MODIFY | Add `registerBehaviourMirrorSweep()`, `registerGoalReconcileCron()`, auto-schedule interval logic |
| `src/master-commands.ts` | MODIFY | Add `branch` verb; wire spec-clarity on new GOALS.md proposal; wire batch-PR trigger after build; add `--develop-branch` flag to `set` |
| `src/channels-config.ts` | MODIFY | Add `lastInjectedAt?`, `injectCooldownMinutes?`, `developBranch?` to Project; add `batchThreshold?`, `injectSweepIntervalMinutes?` to Defaults |
| `src/paths.ts` | MODIFY | Add `projectGoalsMd(slug)` |
| `templates/master.CLAUDE.md` | MODIFY | Add Autonomous Agent Force section (injection tagging, GOALS.md format, develop branch workflow) |
| `server.ts` | MODIFY | Wire pattern mining, voice extraction, behaviour-mirror sweep, goal reconcile on startup |

## Data Model Changes

### channels.json — Project level (all optional, backward compatible)

```typescript
// Added to ChannelsConfig.Project
lastInjectedAt?: string          // ISO timestamp of last autonomous injection
injectCooldownMinutes?: number   // default: 60
developBranch?: boolean          // default: false; create/use develop branch
```

### channels.json — Defaults level (all optional)

```typescript
// Added to ChannelsConfig.Defaults
batchThreshold?: {
  proposals: number   // default: 5
  lines: number       // default: 500
}
injectSweepIntervalMinutes?: number  // default: 30
```

### GOALS.md schema (per-project file, managed by master)

```markdown
# Goals: <slug>

## Scheduling
- **Recommended interval:** 120 min
- **Peak hour:** 14:00 UTC
- **Avg turns/day:** 8.3
- **Last updated:** 2026-06-26T02:00:00Z

## Proposals
- [ ] P1 — Add dark mode (`pending`) — [spec](.specclaw/changes/dark-mode/spec.md)
- [x] P0 — Initial setup (`done`) — [spec](.specclaw/changes/init/spec.md)
```

## API Changes

No HTTP API changes. New internal TypeScript exports only.

## Key Decisions

1. **No LLM for injection messages.** Template-based mirroring using statistical
   analysis of operator message vocabulary, sentence structure, and phrasing
   patterns. Avoids LLM API calls, latency, and cost in the hot path. If the
   mirrored message is low quality the operator can adjust by replying manually —
   those replies feed back into the voice model over time.

2. **Pattern mining is read-only, local-only.** Reads existing `.jsonl` transcripts.
   No writes. No network. Fast.

3. **Behaviour-mirror sweep is fire-and-forget.** `pool.deliver()` is async;
   the sweep does not await Claude's response. This prevents sweep latency from
   blocking the scheduler tick.

4. **`develop` branch is per-project-repo, not per-worktree.** Simpler — existing
   `gitCreateOrCheckoutDevelop` targets the project's working directory directly.
   No additional worktree management complexity.

5. **Pipeline guard reads STATUS.md directly** rather than calling
   `specclaw-validate-change` binary (which validates prerequisites, not completion).
   STATUS.md phase rows are parsed for `🟢` symbols. This is more reliable than
   shelling out to a binary for a read-only check.

6. **GOALS.md is master-written, human-readable.** Master owns writes; operator
   and project Claude can read it. Project Claude must NOT write to GOALS.md —
   that would create write conflicts. GOALS.md is co-located in the project cwd,
   not in a special path.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Injection produces off-topic or confusing messages | Medium | `[auto]` tag visible to operator; cooldown prevents flood; operator can `!project set --develop-branch off` to suppress for a channel |
| Pattern mining reads stale/partial transcripts | Low | Default to safe interval (480 min) on parse errors; cache TTL prevents repeat errors flooding logs |
| `develop` merge conflicts when multiple proposals land simultaneously | Medium | Guard checks pipeline status; conflicts surfaced to Discord; operator resolves manually — no auto-rebase |
| `gh` CLI not available or not authenticated | Medium | Graceful skip with Discord notification; batch threshold check retries next build completion |
| GOALS.md reconcile overwrites manual operator edits | Low | Reconciler only adds/updates proposal rows in `## Proposals` section; `## Notes` or other sections are preserved verbatim |
