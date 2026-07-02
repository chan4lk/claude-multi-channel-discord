# Proposal: MCD Autonomous Agent Force

**Created:** 2026-06-26
**Status:** 🟡 Draft

## Problem

MCD currently requires constant operator input to stay productive. Channels drift
idle without messages, specclaw proposals accumulate without prioritisation, PRs
merge directly to main (triggering CI on every small change), and the master
channel has no awareness of what each project needs to stay moving. The operator
(chan4lk) must manually monitor channels, inject messages to keep autonomous
sessions alive, choose what to build next, and decide when features are
big enough to ship. This is unsustainable at fleet scale.

## Proposed Solution

Five tightly-coupled upgrades that together turn MCD into a self-directing agent force:

### 1 — Pattern Mining & Optimal Scheduling
Analyse the last 30 days of transcript data (turn frequency, token burn, tool
usage, session length) across all projects. Derive per-project optimal schedule
windows that stay inside Claude's rate limits. Persist findings in each
project's `GOALS.md` as a `## Scheduling` section. Master's scheduler then uses
these windows instead of fixed cron intervals.

### 2 — Autonomous Channel Injection (Operator Behaviour Mirroring)
Master reads the last 10 messages from each autonomous channel. Behaviour model
is built from operator messages across ALL channels (fleet-wide voice baseline)
but weighted toward that specific channel's history (channel-specific bias).
Master synthesises an injection that mirrors how chan4lk would respond in that
context. A `lastInjectedAt` field in `channels.json` prevents flooding;
maximum 3 injections per channel per hour (conservative default).

### 3 — Spec-Author Gating for Unclear Proposals
Only applies to **large proposals** (complexity heuristic: word count of solution
text ≥300 words OR ≥5 acceptance criteria OR touches ≥4 files). Small/medium
proposals skip gating and enter the pipeline immediately. For large proposals,
master evaluates clarity (problem statement, ACs, scope). If below threshold:
warn operator via Discord with specific gaps, then auto-proceed after 24h with
best-effort spec. If operator engages within 24h, `specclaw:spec-author` runs
interactively and the timer resets.

### 4 — develop Branch Workflow + Batched PR-to-main
Each project gets a per-repo `develop` branch. Specclaw builds target `develop`.
Specclaw pipeline status (all phases green in `status.md`) is checked before any
merge — to `develop` or `main`. When `develop` is "sizable" (BOTH thresholds
must pass: ≥5 merged proposals AND ≥500 line diff vs `main`) master opens a PR
`develop → main`. Both thresholds configurable via `channels.json`
`batchThreshold: { proposals: 5, lines: 500 }`.

### 5 — GOALS.md as Living Proposal Registry
Master rewrites each project's `GOALS.md` to be the canonical specclaw proposal
list for that project. It keeps it sorted by priority, trims completed items,
and adds new proposals automatically from the pattern-mining step. A cron job
reconciles `GOALS.md` ↔ `.specclaw/STATUS.md` every night.

## Scope

### In Scope
- Pattern mining API (`/api/pattern-summary`) over project transcripts
- `GOALS.md` schema extension: scheduling section + proposal list
- Master cron: autonomous injection with behaviour mirroring
- `channels.json` extension: `lastInjectedAt`, `developBranch`, `batchThreshold`
- Spec-author gating hook in specclaw build flow
- `develop` branch lifecycle (`!project branch` verb or auto-create)
- Specclaw pipeline status guard before `git merge` / PR creation
- GOALS.md reconciliation cron

### Out of Scope
- New UI pages for this feature (existing Mission Control views cover monitoring)
- WhatsApp-specific injection logic (handled by existing adapter)
- Cross-project proposal dependencies (separate proposal)
- Full LLM-powered PR description generation (already done by `specclaw:pr`)

## Impact

- **Files affected:** ~12 (estimated)
  - `server.ts`, `src/scheduler.ts`, `src/master-commands.ts`, `src/claude-process.ts`,
    `src/git-ops.ts`, new `src/pattern-mining.ts`, new `src/behaviour-mirror.ts`,
    new `src/spec-clarity.ts`, `templates/master.CLAUDE.md`,
    `apps/mission-control/app/api/pattern-summary/route.ts`, `GOALS.md` (per project)
- **Complexity:** large
- **Risk:** medium — autonomous injection could produce off-topic messages; rate-limit
  logic must be conservative; develop-branch merges could conflict

## Decisions Made

1. **Sizable threshold:** BOTH ≥5 proposals AND ≥500 line diff (configurable).
2. **Spec gating:** large proposals only (≥300w solution OR ≥5 ACs OR ≥4 files); warn + auto-proceed after 24h; timer resets if operator engages.
3. **Behaviour mirroring:** fleet-wide voice baseline + channel-specific bias; 3 injections/hour/channel max.
4. **develop branch:** per-project-repo.
5. **Rate limit:** 3 injections/channel/hour default (operator can override per project).

---

**Status: APPROVED — ready to plan.**
