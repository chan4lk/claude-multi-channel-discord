# Verification — Codex Project Runner

**Verdict:** PASS

Verified at `f556435`. The first live deployment found that Codex's noninteractive approval policy denied `mcd.reply`; its completed turn carried no final answer, so the channel stayed silent. T6 fixed that failure. A subsequent live probe found that Codex cannot resume a thread before its first turn; T7 now waits for `turn/start` before persisting the thread ID. The configured gate and focused tests pass.

- AC-1: pass — legacy configuration and Claude selection remain valid; focused commands cover MiniMax create, clone, and switching.
- AC-2: pass — focused commands cover Codex create, clone, show, model, provider set/clear, `/provider`, reserved alias, unknown alias, and target-only restart. Clone output identifies `Runner: codex`.
- AC-3: pass — fake app-server tests check initialization, project cwd, selected or omitted model, sandbox/approval policy, instructions, and a chat-scoped MCD MCP URL with token supplied through the child environment. The `mcd` server's tools are explicitly approved for noninteractive use.
- AC-4: pass — protocol tests check serial turns, persistence after the first turn starts, unused-thread restart, resumed threads in `.codex-thread-id`, distinct channel threads and tokens, and separate Claude session state. A live two-turn smoke test resumed a persisted thread successfully.
- AC-5: pass — a live isolated app-server turn made one `mcd.reply` call, which produced one correctly targeted MCD reply. Fake tests cover reply threading, one final-message fallback, failed-turn notices, and a visible notice if a completed turn has no reply or final text.
- AC-6: pass — item events drive tool progress and liveness; active and queued messages receive threaded interruption notices on exit or watchdog stop; a killed process cannot emit a late reply. A Codex process is exercised through the real pool watchdog.
- AC-7: pass — fake failure tests cover missing CLI/key, invalid saved thread, and MCP failure with sanitized diagnostics and fresh-thread recovery guidance.
- AC-8: pass — operator documentation covers configuration, auth, sandbox, approval, model, switching, and unsupported Claude telemetry; focused tests and typecheck pass.

## Commands and limits

- `MC_DB_PATH=:memory: specclaw-verify collect .specclaw 032-codex-project-runner` — exit 0; configured `bun tsc --noEmit` and `cd apps/mission-control && bun run build` passed. In-memory SQLite was used only for build-time page collection.
- `bun /private/tmp/mcd-codex-live-smoke.ts` — exit 0 with `mcp_reply_calls 2 channel_replies 2 reply_targets [ "smoke-1", "smoke-2" ]`. This used the installed CLI and ChatGPT login, a temporary project directory, and a local `MasterMcpServer`; the second turn resumed the first thread. It did not post to Discord.
- `bun src/codex-commands.test.ts` — exit 0.
- `bun src/codex-process.test.ts` — exit 0.
- `bun src/project-pool.test.ts` — exit 0.
- `git diff --check` — exit 0.
- The broader `bun src/master-commands.test.ts` script still exits 1 on six existing heartbeat assertions; Codex assertions pass. Those assertions are outside this change's focused acceptance tests.
- E2E: not configured in SpecClaw. One live authenticated Codex smoke turn was run separately after the deployed failure; protocol tests continue to use an injected fake app-server as required by NFR-4.
