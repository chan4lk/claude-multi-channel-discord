# Proposal: Codex Project Runner for MCD Channels

**Created:** 2026-10-19
**Status:** 🟡 Draft

## Problem

MCD can route a project to MiniMax through the Claude CLI, but it always starts `ClaudeProjectProcess`. A Codex project cannot be enabled with a provider alias because Codex uses its own CLI, authentication, session format, and turn events. Operators need to run a Codex agent in a project channel with the same day-to-day channel controls they use for MiniMax.

## Proposed Solution

Add a per-project Codex runner behind the existing `ProjectProcess` and `ProjectPool` interfaces. A project can select `codex` at creation or switch an existing channel to it; MCD starts the Codex CLI in that project's working directory, connects the project-scoped MCD MCP tools, delivers channel messages, and routes replies and progress back through the existing pool. Keep the Claude CLI and Anthropic-compatible provider catalog for Claude and MiniMax projects. Document Codex authentication and deployment setup, and test both runners through the shared project lifecycle.

## Scope

### In Scope

- Select Codex for a project through the same create, clone, show, and switch paths used for provider routing; preserve existing projects' Claude behavior by default.
- Configure the Codex executable, model, authentication environment, working directory, project-scoped MCP connection, and explicit approval/sandbox policy suitable for unattended channel turns.
- Deliver successive channel messages to a persistent Codex conversation; relay text replies and supported tool progress to the correct channel, with no cross-project session or credential leakage.
- Integrate Codex spawn, shutdown, idle eviction, crash/retry, stuck detection, and operator initiated switching with `ProjectPool`; map Codex's available lifecycle signals to the existing observability paths.
- Add focused config, command, runner, and pool tests plus operator documentation and a working example.

### Out of Scope

- Treating Codex as an Anthropic-compatible API endpoint inside the Claude CLI.
- Changing MiniMax routing or the behavior of existing Claude projects.
- Making Codex the default runner for all projects.
- Cloud-hosted Codex task orchestration or a new model billing/credential service.

## Impact

- **Size:** architectural (a new `ProjectProcess` implementation and configuration interface)
- **Files affected:** approximately 12–18 (`src/channels-config.ts`, `src/project-process.ts`, new Codex runner, `server.ts`, project commands, docs, and tests)
- **Complexity:** large
- **Risk:** medium — Codex's session and event formats differ from Claude's; incorrect lifecycle or MCP scoping could lose a reply or route it to the wrong channel.

## Open Questions

1. Should `!project provider <slug> --set codex` select the Codex runner, or should runner selection have a separate command? Proposed default: keep the familiar provider command while making the runner distinction explicit in config and status.
2. Should Codex use the host's existing Codex login, an API key, or support both? Proposed default: support the host's existing login and an explicitly configured API-key environment variable, without storing secrets in `channels.json`.
3. Which Codex CLI mode best preserves multi-turn sessions and MCP tool calls under MCD's unattended operation? Validate against the installed CLI during planning/build before fixing the transport in the spec.

---

**To proceed:** Review this proposal and approve to begin planning.
