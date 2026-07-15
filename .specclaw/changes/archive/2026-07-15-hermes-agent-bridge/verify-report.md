# Verify Report: hermes-agent-bridge

**Date:** 2026-07-15
**Verdict:** PASS

## Acceptance Criteria

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 | ✅ | `master-commands.test.ts`: "hermes: launch reply contains run id", "hermes: launch reply contains log path", "hermes: meta json exists in hermes-runs dir" — mock spawn writes `<run-id>.json` with wrapped prompt and argv |
| AC2 | ✅ | `master-commands.test.ts`: "hermes: disabled when config absent" passes; `master-mcp-server.test.ts`: "hermes_run (master, disabled): NOT listed when hermes.enabled=false" passes; `handleHermes` at `master-commands.ts:1952-1954` returns disabled message when `!hcfg?.enabled` |
| AC3 | ✅ | `master-mcp-server.test.ts`: "hermes_run (project, enabled): NOT listed for non-master chat" passes; tool list gated at `master-mcp-server.ts:368` by `this.getMasterChatId() === chatId` |
| AC4 | ✅ | `hermes-bridge.test.ts`: checks `argv[0]==='-z'`, `argv[2]==='--yolo'`, `argv[3]==='-m'`, `argv[4]==='MiniMax-M3'`, `argv[5]==='--verbose'`; order is `['-z', wrapped, '--yolo', '-m', model, ...extraArgs]`; `binPath` passed as spawn's first arg (standard Node.js spawn semantics); raw prompt embedded verbatim confirmed by `wrapHermesPrompt` tests |
| AC5 | ✅ | `hermes-bridge.test.ts`: "wrapHermesPrompt: contains hermes send instruction with discord:<masterChatId>" passes; "wrapHermesPrompt report:false: no hermes send mention" passes; `master-commands.test.ts`: "hermes: meta wrappedPrompt contains hermes send instruction" and "--no-report meta wrappedPrompt does NOT contain hermes send" pass |
| AC6 | ✅ | `master-commands.test.ts`: "hermes: --tail unknown id returns not-found", "hermes: --tail unknown id includes recent runs listing", "hermes: --tail existing id returns log content" all pass; `hermes-bridge.test.ts` tail tests (default 40 lines, custom count, unknown returns null) all pass |
| AC7 | ✅ | `hermes-bridge.test.ts`: "launchHermesRun: detached: true", "stdio[0] is ignore", "stdio[1] is a number (fd)", "stdio[2] is a number (fd)", "unref called" all pass; `hermes-bridge.ts:83-86` spawns with `{detached: true, stdio: ['ignore', fd, fd]}` and calls `child.unref()` at line 100 |
| AC8 | ✅ | `bun src/hermes-bridge.test.ts`: 61/61 checks pass; `bun src/master-commands.test.ts`: all checks pass including 8 hermes-specific checks; `bun src/master-mcp-server.test.ts`: all checks pass including 6 hermes-specific checks; `bun tsc --noEmit`: clean (no output) |
| AC9 | ⚠️ N/A (manual) | Live smoke test — requires deployed server with hermes-agent installed and configured; not automatable |

## Test/Lint/Build

```
bun src/hermes-bridge.test.ts      → 61 checks, all PASS
bun src/master-commands.test.ts    → all checks PASS (incl. 8 hermes checks)
bun src/master-mcp-server.test.ts  → all checks PASS (incl. 6 hermes checks)
bun tsc --noEmit                   → clean, no errors
```

## Notes / Gaps

- **AC4 argv convention:** The spec lists `[binPath, '-z', ...]` but `buildHermesArgv` returns `['-z', wrappedPrompt, ...]` without `binPath`. This is correct — Node.js `spawn(bin, args)` takes the executable separately. Tests validate the order as specified.
- **AC9 pending:** Manual smoke test required post-deploy to confirm `hermes send` integration with live Discord credentials. Does not block PASS — all automated criteria green.
- **No new npm dependencies** confirmed: `hermes-bridge.ts` imports only `node:fs`, `node:path`, `node:child_process`.
