# Spec: Codex Project Runner for MCD Channels

**Change:** 032-codex-project-runner
**Created:** 2026-10-19
**Status:** 🟡 Draft

## Overview

An operator can assign Codex to one MCD project channel while other channels continue using Claude or MiniMax. Codex participates in the existing `ProjectPool` delivery, reply, and lifecycle contract. The host runs an installed Codex CLI app-server using its existing login or an explicitly named API-key environment variable; MCD never stores the credential value.

## Requirements

### Functional Requirements

- **FR-1 — Selection.** `create` and `clone` accept `--provider codex`; `provider <slug> --set codex` switches an existing project; `--set <Anthropic alias>` and `--clear` switch back to the Claude runner. The show paths identify the effective runner and provider. `codex` is reserved and cannot be a `defaults.providers` alias. No global Codex default is introduced.
- **FR-2 — Configuration.** Add an optional `defaults.codex` block for binary path, sandbox mode, approval policy, and API-key environment variable name. `project.model` applies to Codex when set; otherwise the Codex installation's model default applies, not MCD's Claude `defaults.model`. Existing config files remain valid and select Claude unless explicitly changed.
- **FR-3 — Session.** One Codex app-server process and thread belong to one active project. Start or resume it in `projectDir(slug)`; persist its thread ID separately from Claude's `.session-id`. Deliver messages in arrival order. Messages arriving during a turn wait for its completion, and every accepted delivery eventually completes, fails visibly, or remains pending for pool watchdog handling.
- **FR-4 — Instructions and MCP.** Supply the project's `CLAUDE.md` as Codex thread instructions so existing project prompts and `!project set --prompt` continue to apply. Register only this project's `mcd` HTTP MCP endpoint, with its `x-mcd-token` supplied from the child environment, and preserve project-local MCP config only when it can be merged without widening MCD's chat scope.
- **FR-5 — Replies.** An `mcd.reply` tool call uses the existing `MasterMcpServer → ProjectPool` path. If a successful turn produced no such call, post its final agent message through the process `onReply` path. Do not post both. Associate the reply with the delivered message ID when possible; never route a reply to another project's chat ID.
- **FR-6 — Progress and lifecycle.** Translate supported Codex tool start/completion and turn events to MCD progress, activity, and pending-turn signals. Integrate kill, idle eviction, stuck detection, process exit, retry/circuit behavior, and provider switching through `ProjectProcess`. A stopped process cannot emit late replies. Expose an explicit unavailable state for Claude-only transcript metrics rather than fabricating them.
- **FR-7 — Authentication and failures.** Use the service account's Codex login or map the configured API-key environment variable into Codex's expected environment at spawn. Missing executable, failed authentication, MCP connection failure, invalid thread resume, and app-server exit produce operator-readable errors; credentials and MCP tokens never appear in user-visible output or logs.
- **FR-8 — Operator setup.** Document host installation/login or API-key setup, provider commands, model selection, permission/sandbox defaults, and the limits of Codex-specific progress and transcript features.

### Non-Functional Requirements

- **NFR-1 — Isolation.** A Codex thread, token, working directory, and queued messages are bound to one chat ID. Tests cover concurrent channels and a runner switch.
- **NFR-2 — Safe defaults.** Codex defaults to a workspace-write sandbox and a noninteractive approval policy that cannot hang a channel waiting on an unimplemented prompt. Broader access requires an explicit operator config setting.
- **NFR-3 — Compatibility.** Claude subscription and MiniMax provider routing remain byte-for-byte compatible at the config and command boundary unless the operator selects Codex.
- **NFR-4 — Testability.** Inject the child-process spawn boundary so protocol tests use a fake app-server and do not require a live Codex account or network.

## Acceptance Criteria

Each criterion must pass for the change to be considered complete.

1. **AC-1:** Existing `channels.json` fixtures still parse and launch Claude. MiniMax alias resolution and its switch/create/clone tests continue to pass.
2. **AC-2:** Create, clone, show, `provider --set codex`, `provider --set minimax`, `provider --clear`, and `/provider` expose the correct runner and restart only the target project. Unknown aliases and a configured alias named `codex` fail with clear errors.
3. **AC-3:** A fake app-server test sees `initialize`, a Codex thread start with the project cwd, selected model or Codex default, configured sandbox/approval policy, project instructions, and only the target chat's MCD MCP URL/token mapping.
4. **AC-4:** Two messages to one channel run in order on one thread; after process eviction or bot restart the stored Codex thread ID resumes, while a second channel uses a distinct thread and token. Claude's `.session-id` is untouched.
5. **AC-5:** An explicit `mcd.reply` causes one routed channel reply and suppresses the final-message fallback; a turn with no explicit reply posts its final message once with the correct reply target. Failed/interrupted turns do not post a success fallback.
6. **AC-6:** Codex tool and turn events update activity/pending/progress signals; a hung or exited Codex process follows the pool's existing watchdog/retry path, and a killed process cannot post a delayed reply.
7. **AC-7:** Missing CLI, missing configured API key, invalid saved thread ID, and MCP/auth failure are surfaced without exposing credential or token values. The operator can recover by correcting config/auth or starting a fresh Codex thread.
8. **AC-8:** Operator docs contain a complete Codex project example and state its auth, sandbox, approval, switching, and unsupported Claude-only telemetry behavior; focused tests and `bun tsc --noEmit` pass.

## Edge Cases

- An inbound message arrives while Codex is still starting or a prior turn is active: queue it without duplicate submission.
- The process dies after `turn/start` but before `turn/completed`: preserve pending state for retry/watchdog and avoid a false success reply.
- A reply tool call arrives just before turn completion: mark the turn replied before applying the final-message fallback.
- A project switches Codex → MiniMax → Codex: keep the Codex thread file separate, but use the current chat-scoped MCP token on resume.
- A saved thread no longer exists: report the resume error and provide a controlled fresh-thread recovery path.
- `defaults.provider` names MiniMax while a project selects Codex: Codex selection wins; clearing Codex returns to the configured Claude default.
- The project is a linked repository: use the resolved project working directory and keep its prompt content; no cross-project config inheritance.

## Dependencies

- Installed Codex CLI with app-server support on the service host; working Codex login or `OPENAI_API_KEY` supplied through the configured environment variable.
- Existing MCD `ProjectProcess`, `ProjectPool`, and per-chat `MasterMcpServer` interfaces.
- The installed CLI's generated app-server protocol schemas for request and event shapes; tests use a fake transport and avoid paid inference.

## Notes

- `ARCHITECTURE.md` says, “It dispatches through `ProjectPool.deliver()` which dispatches to `ProjectProcess.deliver()`.” The new runner attaches at that boundary.
- `.specclaw/context.md` says, “Zod schemas in `src/channels-config.ts` are the single source of truth for `channels.json`” and “spawn functions ... are constructor-injected so tests never launch real processes.” The config and test design follow those rules.
- OpenAI's [Codex app-server guidance](https://developers.openai.com/blog/codex-as-a-platform) describes persistent conversations, streamed events, and approval handling. The [app-server protocol example](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) names `initialize`, `thread/start`, `turn/start`, and `thread/resume`; the installed CLI also generated schemas for those methods during planning.
