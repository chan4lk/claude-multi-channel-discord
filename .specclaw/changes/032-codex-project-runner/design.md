# Design: Codex Project Runner for MCD Channels

**Change:** 032-codex-project-runner
**Created:** 2026-10-19

## Technical Approach

Keep `ProjectPool` as the one per-channel lifecycle owner. Add `CodexProjectProcess implements ProjectProcess`, launched as `codex app-server --listen stdio://` with a child-process boundary injected for tests. Speak newline-delimited app-server JSON RPC: `initialize`/`initialized`, `thread/start` or `thread/resume`, then one `turn/start` per queued envelope. Persist the returned thread ID in a Codex-specific file under the project directory. Translate app-server notifications into MCD replies, progress, and liveness state. The app-server choice follows [OpenAI's integration guidance](https://developers.openai.com/blog/codex-as-a-platform), which describes it for persistent conversations and streamed events; the installed CLI's generated v2 schema confirms the required thread/turn fields.

Do not force Codex through `ClaudeProjectProcess`: its tmux readiness, transcript paths, and Anthropic environment are Claude-specific. The existing provider command remains the operator entry point: `codex` is a reserved value that chooses `runner: 'codex'`; all other aliases continue to mean Claude with `project.provider`. `--clear` clears both explicit fields and returns to the configured Claude default.

## Architecture

```text
channel input / scheduler
        ↓
  ProjectPool.deliver(chatId)
        ↓
  server factory → runner == codex ? CodexProjectProcess : ClaudeProjectProcess
        ↓                              ↓
  codex app-server (stdio)          existing claude path
        ↓
  per-chat MCD HTTP MCP → MasterMcpServer → ProjectPool.acceptReply → channel
        ↓
  final-message fallback when no mcd.reply call occurred
```

The Codex process owns a serial envelope queue. `deliver()` records pending activity and enqueues promptly. Startup waits for initialization and thread start/resume; the queue then starts a turn and waits for its terminal event before submitting the next envelope. RPC request IDs match responses; notification handlers ignore unrelated threads/turns. On `thread/start`, pass `cwd`, explicit model when set, `developerInstructions` from the project's `CLAUDE.md`, sandbox and approval policy, and a per-thread `mcp_servers.mcd` override. On `thread/resume`, reapply the current instructions and MCD endpoint/token so a bot restart or provider switch cannot revive stale MCP credentials.

The child receives `MCD_MCP_TOKEN` in its environment; Codex's MCP configuration maps `x-mcd-token` through `env_http_headers`. The token must not enter argv, persisted config, events, or errors. `defaults.codex.apiKeyEnv`, when present, reads that host variable at spawn and maps it to `OPENAI_API_KEY`; otherwise Codex uses the service account's login. `defaults.codex.binPath` defaults to `codex`, `sandbox` to `workspace-write`, and `approvalPolicy` to `never`. Reject an unsupported combination at config validation rather than leaving an unattended approval request pending. Config overrides are per thread; the MCD server still validates every MCP call against the chat ID and token.

Use a separate `.codex-thread-id` file, mode 0600, updated atomically after a successful start. A failed resume is visible to the operator and may move the stale ID aside before starting fresh; it must not silently overwrite a valid ID. On kill or exit, close stdio, stop event listeners, clear queued work according to the pool's existing retry model, and suppress late notifications. For each turn, record whether `mcd.reply` arrived through `acceptReply()`. If none did and the turn completed successfully, emit its final agent message once through `onReply` with the envelope's `messageId`. A failed or interrupted turn produces an error/exit signal, not a success fallback.

Map app-server item start/completion events to `ToolProgressEvent` when they represent tool activity; use turn completion to clear pending state and update activity. Leave Claude transcript mtime, token-based context warnings, and distillation unavailable when Codex cannot provide equivalent data. The pool's existing pending-deliver watchdog remains the primary liveness check. Support `getStats()` from the child PID where practical, and make `kill()` idempotent.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | Modify | Add optional Codex config and per-project runner; reserve `codex` and keep Anthropic aliases intact. |
| `src/master-commands.ts` | Modify | Create/clone/provider/show/model command routing and Codex-aware status text. |
| `src/provider-command.ts` | Modify | Explain Codex in slash-command labels while reusing the existing handler. |
| `src/codex-process.ts` | Add | App-server RPC, thread persistence, queue, reply and lifecycle adapter. |
| `src/paths.ts` | Modify | Dedicated Codex thread-ID file path. |
| `src/project-process.ts` | Modify only if needed | Keep the common interface; add a typed `acceptReply` hook if that removes the existing cast in the pool. |
| `src/project-pool.ts` | Modify only if needed | Runner-neutral reply/liveness handling; avoid Claude-specific assumptions. |
| `server.ts` | Modify | Select runner in factory and wire shared MCD events, credential, and progress callbacks. |
| `src/channels-config.test.ts`, `src/master-commands.test.ts`, `src/project-pool.test.ts` | Modify | Compatibility, command switches, and runner lifecycle tests. |
| `src/codex-process.test.ts` | Add | Fake app-server protocol and concurrency/reply/failure tests. |
| `docs/project-channels.md`, `docs/git-credentials.md`, `docs/commands.md`, `templates/master.CLAUDE.md`, `ARCHITECTURE.md` | Modify | Operator setup, examples, command help, and runtime architecture. |

## Data Model Changes

```ts
// channels.json: absent runner preserves today's Claude behavior.
projects[chatId].runner?: 'claude' | 'codex'
projects[chatId].provider?: string // Anthropic-compatible alias, Claude runner only
defaults.codex?: {
  binPath?: string
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' // no pending interactive approval without an MCD bridge
  apiKeyEnv?: string       // name only; value stays in service environment
}
```

The per-project `.codex-thread-id` is runtime state; it is not a `channels.json` field and never collides with Claude's `.session-id`. Changing provider/runner kills only that project's current process. No data migration is needed for existing projects.

## API Changes

- `!project create ... --provider codex` and `!project clone ... --provider codex` select the Codex runner; existing `--provider <alias>` behavior remains.
- `!project provider <slug> --set codex` selects Codex; `--set <alias>` selects Claude with that Anthropic-compatible alias; `--clear` returns to Claude and its configured default provider.
- `!project show <slug>` and `/provider show` display `runner: codex` or `runner: claude`, plus the effective provider/model without mislabeling a Codex project as `sonnet`.
- `!project model <slug> --set <name>` continues to set `project.model` and respawn the selected runner.
- No new external HTTP API: Codex uses the existing per-chat `MasterMcpServer` endpoint and token.

## Key Decisions

1. **App-server over tmux or one-shot exec.** App-server supports persistent threads, turn events, and lifecycle control. `codex exec` is aimed at bounded runs; this project requires a warm channel conversation. See [OpenAI Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform).
2. **Explicit runner field with command compatibility.** Provider aliases already mean Anthropic-compatible APIs. Store the runtime choice separately; reserve `codex` only at the operator command boundary so MiniMax config keeps its meaning.
3. **Noninteractive safe default.** `approvalPolicy: never` with `workspace-write` avoids an unhandled prompt while limiting file writes to the project workspace. An operator can opt into broader sandbox access in host config; no Discord message silently approves a Codex request.
4. **MCP reply preferred, final fallback.** The existing MCD reply tool preserves platform dispatch, reply threading, and pool activity. The fallback prevents a completed Codex turn from disappearing when it writes a normal final message.
5. **Project prompt reuse.** `create` and `clone` already write `CLAUDE.md`; pass its content explicitly to Codex at thread start/resume instead of introducing a second operator-owned prompt file.

## Risks & Mitigations

- **Protocol drift:** App-server is marked experimental in the installed CLI. Keep JSON RPC parsing narrow, test against generated v2 schemas/fake events, and report unsupported event shapes clearly.
- **Reply duplication:** Track `mcd.reply` per turn and apply final fallback only after terminal success with no tool reply. Test the race around tool reply and turn completion.
- **Cross-channel leakage:** Bind one child/thread/token to one chat ID and verify all incoming RPC notifications and MCP replies against it. Test two channels concurrently.
- **Unattended approvals:** Validate allowed policy and sandbox values; never silently grant `danger-full-access` as a default.
- **Session recovery:** Persist IDs atomically and report resume failure before controlled rotation to a new thread.
- **Service-host auth:** Preflight configured API-key env names and surface login failures without logging values; document service-account login separately from an interactive user's login.

## Grounding Sources

- `ARCHITECTURE.md`: “It dispatches through `ProjectPool.deliver()` which dispatches to `ProjectProcess.deliver()`.” This anchors the runner seam.
- `ARCHITECTURE.md`: “At spawn time `resolveProvider()` looks up the alias, reads the API key from the bot's process env ... and `ClaudeProjectProcess` sets `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`.” This is why Codex cannot be an ordinary provider alias.
- `.specclaw/context.md`: “Zod schemas in `src/channels-config.ts` are the single source of truth for `channels.json`” and “spawn functions ... are constructor-injected so tests never launch real processes.” These guide config validation and protocol test seams.
- `templates/master.CLAUDE.md`: “`!project show <slug>` displays the resolved provider” and “The subprocess is killed automatically; the next message in that channel respawns with the new env.” The Codex command path keeps those operator expectations.
