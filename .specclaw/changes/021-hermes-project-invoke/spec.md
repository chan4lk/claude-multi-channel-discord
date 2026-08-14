# Spec: Hermes invoke from project channels

**Change:** hermes-project-invoke
**Created:** 2026-07-25
**Status:** 🟡 Draft

## Overview

Expose the existing `hermes_run` MCP tool to project-channel Claude sessions via explicit per-project opt-in, so projects like dstm-apps can trigger detached Hermes ops runs (e.g. docker image deploys) without operator relay through the master channel. Report-back routes to the originating channel; master gets an audit notice on every project-initiated launch.

## Requirements

### Functional Requirements

- **FR1** — `channels.json` supports `projects[<chat_id>].hermes: { enabled: boolean }` (optional; absent ⇒ disabled). Zod-validated in `src/channels-config.ts`.
- **FR2** — `hermes_run` appears in a project session's MCP tool list iff `defaults.hermes.enabled === true` AND `project.hermes.enabled === true`. Master channel behavior unchanged (bridge enabled ⇒ tool listed, no per-project flag needed).
- **FR3** — The `hermes_run` call handler enforces the same gate as FR2 (defense in depth — listing and execution are independently checked). Disabled project or disabled bridge ⇒ error result, no spawn.
- **FR4** — Project-initiated runs wrap the prompt with report-back to the **originating channel**: `hermes send --to discord:<project_chat_id> ...`. Master-initiated runs keep reporting to master (existing behavior, no change).
- **FR5** — On a project-initiated launch, the master channel receives an audit notice: `🛰 hermes run <runId> launched by <slug>: "<prompt first 120 chars>"`, delivered via the existing `onReply` outbound path.
- **FR6** — `!project set <target> --hermes on --yes` enables the flag; `--hermes off` disables (no `--yes` needed). `--hermes on` without `--yes` is refused with an explanatory error (widens host-ops reach, mirrors `--bot-peers` rationale). Targeting the master channel with `--hermes on|off` is a warn no-op ("master already has hermes access").
- **FR7** — Run metadata (`<runId>.json`) records the report-back chat id in addition to `masterChatId`.

### Non-Functional Requirements

- **NFR1** — No new dependencies. Pure-logic changes testable without spawning real processes (existing `hermesSpawnFn` injection).
- **NFR2** — Backward compatible: existing `channels.json` files without `hermes` project blocks parse unchanged; master-initiated `hermes_run` behavior byte-identical prompts except unchanged.
- **NFR3** — Per-project Hermes config overrides (binPath/yolo/model/extraArgs) are NOT introduced; `defaults.hermes` remains the only bridge config.

## Acceptance Criteria

- **AC1** — Zod schema accepts `{ hermes: { enabled: true } }` on a project entry and rejects `{ hermes: { enabled: "yes" } }`; absent block parses with no default object injected.
- **AC2** — Tool-list matrix (tests): master+bridge-on ⇒ listed; master+bridge-off ⇒ not listed; project+flag-on+bridge-on ⇒ listed; project+flag-on+bridge-off ⇒ not listed; project+flag-off ⇒ not listed; project+no-block ⇒ not listed.
- **AC3** — Call-gate matrix (tests): same six cases as AC2 — allowed cases spawn (via injected spawnFn) and return `run <id> launched`; denied cases return error result and spawnFn is NOT called.
- **AC4** — Project-initiated run's wrapped prompt contains `hermes send --to discord:<project_chat_id>` and NOT the master chat id as report target; master-initiated run's wrapped prompt still targets master (regression check).
- **AC5** — Project-initiated launch triggers exactly one `onReply` to the master chat id containing the runId, the project slug, and ≤120 chars of the prompt. Master-initiated launch triggers no audit notice.
- **AC6** — `set` command tests: `--hermes on --yes` writes `hermes.enabled: true`; `--hermes on` without `--yes` refused; `--hermes off` removes/disables the block; master target ⇒ warn no-op string; unknown target ⇒ existing not-found error.
- **AC7** — All existing test suites pass (`bun src/*.test.ts`) and `bun tsc --noEmit` is clean.
- **AC8** — Docs updated: CLAUDE.md (config key + verb line), ARCHITECTURE.md (hermes bridge section), README (set verb row).

## Edge Cases

- Project flag on but `defaults.hermes` absent entirely ⇒ tool not listed, call refused with 'hermes bridge not configured/disabled'.
- Prompt shorter than 120 chars ⇒ audit notice shows full prompt, no ellipsis padding.
- Slug lookup for audit notice when project entry vanished mid-call (config edited) ⇒ fall back to chat id in the notice; never throw.
- `--hermes` with a value other than `on|off` ⇒ usage error.
- Non-Discord platform project (teams/whatsapp) with flag on ⇒ tool still listed; report-back uses `discord:<chatId>` today — Hermes send to non-Discord targets is out of scope; note in docs that report lands nowhere useful for teams/whatsapp (acceptable, documented limitation).

## Dependencies

None beyond existing code. Builds on `src/hermes-bridge.ts` (launch/wrap), `src/master-mcp-server.ts` (gating), `src/channels-config.ts` (schema), `src/master-commands.ts` (set verb).

## Notes

Open questions from proposal resolved as proposed defaults: audit launch-notice only (no dual final report), master target warn no-op, 120-char prompt preview. Operator approved option B on 2026-07-25.
