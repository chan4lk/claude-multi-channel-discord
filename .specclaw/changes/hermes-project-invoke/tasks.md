# Tasks: Hermes invoke from project channels

**Change:** hermes-project-invoke
**Created:** 2026-07-25
**Total Tasks:** 5

## Summary

Five tasks, three waves. Wave 1 lays schema + bridge plumbing (no behavior change). Wave 2 wires the MCP gate + set verb with tests. Wave 3 documents.

## Tasks

### Wave 1 — Schema + bridge plumbing

- [x] `T1` — Project hermes schema
  - Files: `src/channels-config.ts`
  - Estimate: small
  - Kind: config
  - Notes: `ProjectHermesSchema = z.object({ enabled: z.boolean().default(false) })`; `hermes: ProjectHermesSchema.optional()` on `ProjectSchema`, doc comment mirroring `handoff`'s reach rationale. Export type.

- [x] `T2` — reportChatId through hermes-bridge
  - Files: `src/hermes-bridge.ts`
  - Estimate: small
  - Kind: impl
  - Notes: `wrapHermesPrompt(raw, runId, reportChatId, opts)` (param rename only — send line uses it); `launchHermesRun` opts gain `reportChatId?: string`, default `masterChatId`; meta JSON gains `reportChatId`. Master path behavior unchanged.

### Wave 2 — Gates + verb + tests

- [x] `T3` — MCP server gate + audit notice + tests
  - Files: `src/master-mcp-server.ts`, `src/master-mcp-server.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T1, T2
  - Notes: private `hermesAccess(chatId): 'master'|'project'|null` per design; tool listing + `case 'hermes_run'` both use it; project access ⇒ `launchHermesRun({reportChatId: chatId})` + one `onReply` to master (`🛰 hermes run <id> launched by <slug>: "<prompt ≤120 chars>"`, slug fallback to chatId). Tests: AC2 + AC3 six-case matrices (injected spawnFn), AC4 wrapped-prompt target both directions, AC5 audit notice exactly-once / never-for-master.

- [x] `T4` — `set --hermes on|off` verb
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: small
  - Kind: impl
  - Depends: T1
  - Notes: `on` requires `--yes` (refusal message explains host-ops reach); `off` no `--yes`; master target warn no-op; invalid value usage error; help lines. Tests: AC6 cases.

### Wave 3 — Docs

- [x] `T5` — Docs: hermes project invoke
  - Files: `CLAUDE.md`, `ARCHITECTURE.md`, `README.md`
  - Estimate: small
  - Kind: docs
  - Depends: T3, T4
  - Notes: CLAUDE.md channels.json key list + verbs section + hermes bridge section (no longer master-only; report-back + audit notice; teams/whatsapp report limitation); ARCHITECTURE.md hermes section; README set verb row.

---

## Legend

- `[ ]` Pending
- `[~]` In Progress
- `[x]` Complete
- `[!]` Failed
