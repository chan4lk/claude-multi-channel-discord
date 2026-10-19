# Tasks: Codex Project Runner for MCD Channels

**Change:** 032-codex-project-runner
**Created:** 2026-10-19
**Total Tasks:** 7

## Summary

Add explicit Codex selection, implement the app-server adapter, wire it into the existing pool, then document and verify the operator flow. Tests use a fake app-server process and do not require paid inference.

## Tasks

### Wave 1 — Selection and configuration

- [x] `T1` — Add Codex runner config and provider/create/clone/show/model switching (AC-1, AC-2)
  - Files: `src/channels-config.ts`, `src/channels-config.test.ts`, `src/master-commands.ts`, `src/master-commands.test.ts`, `src/provider-command.ts`
  - Estimate: large
  - Kind: impl
  - Notes: Reserve `codex`; preserve MiniMax aliases and existing config. Fix the create path as well as clone, show, slash command, and model display. Switching kills only the target project.

### Wave 2 — Codex process and pool wiring

- [x] `T2` — Implement the Codex app-server ProjectProcess with fake-protocol tests (AC-3, AC-4, AC-5, AC-7)
  - Files: `src/codex-process.ts`, `src/codex-process.test.ts`, `src/paths.ts`
  - Estimate: large
  - Kind: impl
  - Depends: T1
  - Notes: Inject spawn; use per-chat MCP token via child environment, project prompt, serial turns, atomic thread-ID persistence/resume, explicit reply and final fallback, redacted failures, and idempotent teardown. Check the installed CLI's generated app-server schema before fixing request/event names.
- [x] `T3` — Select Codex in the server factory and prove pool lifecycle behavior (AC-4, AC-5, AC-6, AC-7)
  - Files: `server.ts`, `src/project-process.ts`, `src/project-pool.ts`, `src/project-pool.test.ts`, `src/codex-process.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1, T2
  - Notes: Keep Claude factory path intact. Cover two channels, pending/progress events, idle/watchdog/exit/switch handling, and late-reply suppression. Change the shared interface/pool only where Codex needs a runner-neutral seam.

### Wave 3 — Operator guidance and completion checks

- [x] `T4` — Document Codex setup and verify the selected-runner flow (AC-1–AC-8)
  - Files: `docs/project-channels.md`, `docs/git-credentials.md`, `docs/commands.md`, `templates/master.CLAUDE.md`, `ARCHITECTURE.md`, `README.md`, `src/channels-config.test.ts`, `src/master-commands.test.ts`, `src/codex-process.test.ts`, `src/project-pool.test.ts`
  - Estimate: medium
  - Kind: docs
  - Depends: T3
  - Notes: Include service-account login/API-key instructions, a create/switch/clear example, sandbox and approval defaults, Codex telemetry limits. Run focused Bun tests and `bun tsc --noEmit`; address only failures caused by this change.

### Wave 4 — Verification remediation

- [x] `T5` — Close reply threading and interrupted-turn gaps found in verify (AC-2, AC-5, AC-6)
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`, `src/codex-commands.test.ts`, `src/codex-process.ts`, `src/codex-process.test.ts`, `src/project-pool.test.ts`, `docs/project-channels.md`
  - Estimate: medium
  - Kind: impl
  - Depends: T4
  - Notes: Show Codex in clone output; inherit the active message ID for an explicit reply without `reply_to`; notify users for accepted turns interrupted by process exit or watchdog; test Codex item progress and pool lifecycle with fake protocol events. Add a focused command suite because the broad master-command script has unrelated heartbeat failures. Keep paid inference out of tests.

### Wave 5 — Live deployment remediation

- [x] `T6` — Permit the chat-scoped MCD MCP tools under noninteractive Codex approval and preserve a visible result when a completed turn has no reply (AC-3, AC-5, AC-6)
  - Files: `src/codex-process.ts`, `src/codex-process.test.ts`, `docs/project-channels.md`
  - Estimate: small
  - Kind: impl
  - Depends: T5
  - Notes: Live deployment exposed `MCP tool call requires approval, but approval policy is never`; its completed turn carried no Discord reply. Set the MCD MCP server tool approval mode explicitly, cover this in fake protocol tests, and run a real isolated app-server smoke test against a local MCD MCP endpoint before redeploying.

### Wave 6 — First-turn persistence

- [x] `T7` — Persist a new Codex thread only after its first turn starts (AC-4, AC-7)
  - Files: `src/codex-process.ts`, `src/codex-process.test.ts`
  - Estimate: small
  - Kind: impl
  - Depends: T6
  - Notes: The installed app-server returns a thread ID before creating its rollout; a restart before the first turn leaves an ID that `thread/resume` rejects with `no rollout found`. Save the ID after a successful `turn/start` and test a start/stop before delivery followed by a fresh thread.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
- `[>]` Deferred — correctly blocked on a sibling change, not incomplete through any fault of its own; excluded from the incomplete-task count that gates `verify`
