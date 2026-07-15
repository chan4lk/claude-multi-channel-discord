# Tasks: Hermes Agent Bridge — out-of-band ops executor for MCD

**Change:** hermes-agent-bridge
**Created:** 2026-07-15
**Total Tasks:** 5

## Summary

Wave 1 builds the standalone bridge module + config plumbing (no MCD surface changes, independently testable). Wave 2 exposes it via the master verb and MCP tool. Wave 3 documents and runs the full gate.

## Tasks

### Wave 1 — Bridge core (config, paths, module, unit tests)

- [x] `T1` — Config schema + paths helper
  - Files: `src/channels-config.ts`, `src/paths.ts`
  - Estimate: small
  - Notes: `HermesConfigSchema { enabled: bool default false, binPath: string default 'hermes', yolo: bool default true, extraArgs: string[] default [] }`; optional `hermes` in `DefaultsSchema` (pattern: `memory` at channels-config.ts:205). `hermesRunsDir()` in paths.ts following lazy-env pattern.

- [x] `T2` — `src/hermes-bridge.ts` + `src/hermes-bridge.test.ts`
  - Files: `src/hermes-bridge.ts`, `src/hermes-bridge.test.ts`
  - Estimate: medium
  - Depends: T1
  - Notes: `newRunId()`, `wrapHermesPrompt(rawPrompt, runId, masterChatId, {report})`, `buildHermesArgv(cfg, wrapped, {model})` → `[binPath is separate; argv = ['-z', wrapped, ...(yolo?['--yolo']:[]), ...(model?['-m',model]:[]), ...extraArgs]`, `launchHermesRun({prompt, cfg, masterChatId, model?, report?, spawnFn?})` — mkdir hermes-runs, open log fd, spawn detached+unref, write `<id>.json` meta, return `{runId, logPath}`; spawn error → thrown Error with binPath in message. `tailHermesRun(runId, lines=40)`, `listRecentRuns(n=10)`. Tests per AC4/AC5/AC7 + hostile prompt + disabled cfg + tail not-found.

### Wave 2 — MCD surfaces (verb, MCP tool, wiring, tests)

- [x] `T3` — `!project hermes` verb
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Depends: T2
  - Notes: add to `MUTATION_VERBS` (:82), dispatch case (:146-193), `handleHermes(rest, ctx)`: `--tail <id>` mode → tail; else positional[0] = prompt (require non-empty), flags `--model`, `--no-report`, `--lines`; config gate → disabled guidance when `!ctx.config.defaults.hermes?.enabled`. Help text line (:204-245). Tests: launch reply contains run id + log path, disabled message, `--tail` unknown id lists recent, empty prompt usage error. Mock spawnFn via bridge injection.

- [x] `T4` — `hermes_run` MCP tool (master-only)
  - Files: `src/master-mcp-server.ts`, `src/master-mcp-server.test.ts`
  - Estimate: small
  - Depends: T2
  - Notes: tool list push gated `this.getMasterChatId() === chatId && hermesEnabled` (mirror `run_master_command` :336); schema `{prompt: string required, model?: string}`; handler calls bridge, returns okResult with run id + log path; errorResult on spawn failure. Test: listed only for master chat when enabled; absent when disabled/non-master.

### Wave 3 — Docs + verification gate

- [x] `T5` — Docs + full gate
  - Files: `CLAUDE.md`, `README.md`
  - Estimate: small
  - Depends: T3, T4
  - Notes: bridge section — config example, verb usage, restart-MCD recipe (prompt template incl. wait-5s + `hermes send` report), security warning (`--yolo` on host), manual-kill recipe for hung runs. Then run all test files + `bun tsc --noEmit` (AC8).

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
