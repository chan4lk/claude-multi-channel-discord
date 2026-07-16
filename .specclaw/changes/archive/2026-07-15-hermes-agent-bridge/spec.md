# Spec: Hermes Agent Bridge — out-of-band ops executor for MCD

**Change:** hermes-agent-bridge
**Created:** 2026-07-15
**Status:** 🟡 Draft

## Overview

MCD gains the ability to delegate host-level ops tasks (restart MCD itself, deploy prod apps, service maintenance) to the locally installed **hermes-agent** CLI. MCD spawns a **detached one-shot Hermes run** (`hermes -z "<prompt>" --yolo`) that survives MCD's own death. Hermes reports its result back to the master Discord channel using its own credentials (`hermes send`), so the loop closes even while MCD is down mid-restart.

Two injection surfaces: a `!project hermes` master-command verb and a `hermes_run` MCP tool (master session only).

## Requirements

### Functional Requirements

- **FR1** — `!project hermes "<prompt>" [--model <m>] [--no-report]` launches a detached Hermes run and immediately replies with the run id and log path. Master channel only; sender must be in `access.allowFrom` (existing gate).
- **FR2** — `mcp__mcd__hermes_run { prompt: string, model?: string }` MCP tool, registered **only** for the master chat_id (same gating pattern as `run_master_command`), launches the same detached run and returns run id + log path.
- **FR3** — The bridge wraps the operator prompt before injection: prefix identifying the run (`MCD bridge run <run-id>`), the task text verbatim, and — unless `--no-report` — an appended instruction telling Hermes to report the outcome via `hermes send --to discord:<master-chat-id> "[hermes:<run-id>] <outcome>"` when finished.
- **FR4** — The Hermes process is spawned **detached** (`detached: true` + `unref()`, stdout/stderr redirected to a per-run log file). It must survive MCD server death/restart. Prompt is passed as a single argv element — no shell interpolation.
- **FR5** — Per-run artifacts live under `<MCD_CHANNELS_DIR>/hermes-runs/`: `<run-id>.log` (combined output) and `<run-id>.json` (metadata: prompt, argv, pid, startedAt).
- **FR6** — `!project hermes --tail <run-id> [--lines <n>]` returns the last N lines (default 40) of a run's log for post-hoc inspection.
- **FR7** — Feature is **opt-in** via `channels.json`: `defaults.hermes.{enabled, binPath, yolo, extraArgs}`. When absent or `enabled: false`, verb and MCP tool both refuse with a clear "hermes bridge disabled" message; the MCP tool is not listed.
- **FR8** — `--yolo` is passed by default (headless one-shot would otherwise hang on approval prompts) but can be disabled via config `yolo: false`.
- **FR9** — `--model <m>` maps to `hermes -m <m>`; `defaults.hermes.extraArgs` (string array) is appended verbatim to the argv.
- **FR10** — Help text (`!project help`) documents the new verb.

### Non-Functional Requirements

- **NFR1 — Security:** prompt reaches Hermes via argv array only (no `shell: true` anywhere). Verb reachable only from master channel by allowFrom users; MCP tool only in master session. Config disabled by default.
- **NFR2 — Resilience:** spawn failure (missing binary, unwritable log dir) returns an actionable error to Discord instead of throwing. Detached runs are never killed by MCD (no timeout-kill in v1 — a restarted MCD has no ownership of the pid).
- **NFR3 — No new dependencies:** Node `child_process.spawn` + existing `fs` only.
- **NFR4 — Testability:** spawn is injectable (mockable) so tests exercise argv construction, prompt wrapping, gating, and metadata writes without launching Hermes.

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

- **AC1** — With `defaults.hermes.enabled: true`, `!project hermes "echo hi"` from an authorized user returns a reply containing a run id and log path, and `hermes-runs/<run-id>.json` exists with the wrapped prompt and argv.
- **AC2** — With hermes config absent, the verb replies "disabled"-style guidance and `hermes_run` does not appear in the master session tool list.
- **AC3** — `hermes_run` MCP tool is absent from non-master project sessions' tool lists.
- **AC4** — Constructed argv for `!project hermes "deploy app" --model MiniMax-M3` equals `[binPath, '-z', <wrapped prompt>, '--yolo', '-m', 'MiniMax-M3', ...extraArgs]` (order: fixed args, yolo, model, extraArgs), with the raw prompt embedded verbatim inside the wrapped prompt.
- **AC5** — Wrapped prompt contains the report-back `hermes send --to discord:<master-chat-id>` instruction with the run id; with `--no-report` it does not.
- **AC6** — `!project hermes --tail <run-id>` returns log tail; unknown run id returns a not-found message listing recent run ids.
- **AC7** — Spawned child is detached and unref'd; MCD exit does not reap it (verified by unit test on spawn options: `detached: true`, stdio `['ignore', fd, fd]`).
- **AC8** — All existing tests plus new tests pass (`bun src/*.test.ts`), `bun tsc --noEmit` clean.
- **AC9** — Live smoke (manual, post-merge): operator runs `!project hermes "run hermes send --to discord:#claude-mcd 'bridge smoke ok'"` and the message arrives from Hermes.

## Edge Cases

- Hermes binary missing / not executable → spawn error captured, reply names the configured `binPath` and how to fix.
- `hermes-runs/` dir missing → created on demand (`mkdir -p` semantics).
- Prompt containing quotes/newlines/`$()` — safe by construction (argv element, no shell); test includes a hostile-looking prompt.
- Concurrent runs — run ids are unique (`h-<timestamp36>-<rand4>`); no serialization needed, runs are independent.
- `--tail` on a run still executing — returns current partial log (valid).
- Empty prompt → usage error, nothing spawned.
- MCD restarted between launch and Hermes completion → report still arrives (Hermes-side `hermes send`); `--tail` still works since log path derives from disk, not memory.
- Hermes hangs forever → no MCD-side kill; operator inspects with `--tail` and kills manually. Documented.

## Dependencies

- `hermes` CLI installed and configured on the host (Discord credentials for `hermes send`, provider auth). Operator-owned; MCD only validates the binary exists at spawn time.
- No new npm/bun packages.

## Notes

Resolved open questions (defaults chosen, operator approved proposal without overrides):

1. **yolo:** default on via config `yolo: true` (headless run would hang otherwise); config-disableable.
2. **Result relay:** Hermes-side self-report (`hermes send`) appended to every prompt unless `--no-report` — uniform, survives MCD restarts. MCD does not tail logs proactively; `--tail` verb covers inspection.
3. **Timeout:** no MCD-side kill of detached runs in v1.
4. **Model:** Hermes default (MiniMax-M3); `--model` per-run passthrough.
