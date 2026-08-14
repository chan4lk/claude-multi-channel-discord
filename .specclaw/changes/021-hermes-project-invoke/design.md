# Design: Hermes invoke from project channels

**Change:** hermes-project-invoke
**Created:** 2026-07-25

## Technical Approach

Widen the two existing master-only gates (tool listing at `master-mcp-server.ts:386`, call handler at `master-mcp-server.ts:791`) into a single shared predicate `hermesAccess(chatId)` that returns `'master' | 'project' | null`. Thread a `reportChatId` through `launchHermesRun` → `wrapHermesPrompt` so project-initiated runs report to their own channel. Audit notice goes out through the already-injected `onReply` callback — no new wiring in `server.ts` beyond passing `getConfig` (already passed).

## Architecture

```
project session (dstm-apps)
   └─ mcp__mcd__hermes_run { prompt }
        └─ MasterMcpServer.case 'hermes_run'
             ├─ hermesAccess(chatId)          // 'project' — bridge on + project.hermes.enabled
             ├─ launchHermesRun({ ..., reportChatId: chatId })
             │     └─ wrapHermesPrompt(..., reportChatId)   // hermes send --to discord:<project chat>
             └─ onReply({ chatId: masterChatId, text: '🛰 hermes run <id> launched by dstm-apps: "..."' })
```

`hermesAccess(chatId)`:
1. `getHermesConfig()?.enabled !== true` ⇒ `null`
2. `chatId === masterChatId` ⇒ `'master'`
3. `getConfig()?.projects[chatId]?.hermes?.enabled === true` ⇒ `'project'`
4. else `null`

Mirrors the existing `handoffSource(chatId)` / `peerSource(chatId)` private-method pattern in the same class.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | `ProjectHermesSchema = z.object({ enabled: z.boolean().default(false) })`; add `hermes: ProjectHermesSchema.optional()` to `ProjectSchema` |
| `src/hermes-bridge.ts` | modify | `wrapHermesPrompt(raw, runId, reportChatId, opts)` — param rename (send target); `launchHermesRun` gains `reportChatId?: string` (default `masterChatId`); meta gains `reportChatId` |
| `src/master-mcp-server.ts` | modify | add `hermesAccess()`; tool listing uses it (description updated); handler uses it, passes `reportChatId`, emits master audit notice for `'project'` access |
| `src/master-commands.ts` | modify | `set --hermes on\|off` (+`--yes` gate for `on`, master warn no-op); help text |
| `src/master-mcp-server.test.ts` | modify | AC2/AC3/AC4/AC5 matrices with injected spawnFn + captured onReply |
| `src/master-commands.test.ts` | modify | AC6 set-flag cases |
| `CLAUDE.md`, `ARCHITECTURE.md`, `README.md` | modify | AC8 doc updates |

## Data Model Changes

`channels.json`: optional `projects[<chat_id>].hermes.enabled: boolean`. No runtime-maintained fields, no migration (absent = disabled).

## API Changes

- MCP tool `hermes_run`: now visible to opted-in project sessions; args unchanged (`prompt`, `model?`). Description text notes report-back goes to the calling channel.
- `!project set <target> --hermes on --yes | --hermes off`.

## Key Decisions

- **Single predicate, both gates** — listing and execution check independently (defense in depth; a stale tool list can't bypass execution).
- **`--yes` required for `--hermes on`** — same rationale as `--bot-peers`: grants reach (host ops via `--yolo`). `off` needs no confirmation.
- **Audit notice via `onReply`, not pool injection** — notice is operator-facing channel traffic, exactly what `onReply` exists for; pool injection would wake master's Claude session needlessly.
- **`reportChatId` param instead of per-caller wrap logic** — keeps `wrapHermesPrompt` pure/testable; master path passes nothing and behavior is unchanged.
- **No per-project bridge config** — YAGNI; `defaults.hermes` stays the single bridge config (NFR3).

## Risks & Mitigations

- **Widened `--yolo` host access** — a prompt-injected project Claude could run arbitrary host ops. Mitigation: default-off, explicit `--yes` opt-in per project, master audit notice on every launch, allowFrom-gated toggle.
- **Report-back to non-Discord platforms lands nowhere** — documented limitation; hermes `send --to discord:` only. Teams/WhatsApp projects can still be opted in knowingly.
- **Signature change ripple in `wrapHermesPrompt`** — internal function, only two call sites (bridge + tests); rename param, keep arity.

## Grounding sources

- `CLAUDE.md` — "Hermes bridge (out-of-band ops)": "Opt-in via `defaults.hermes.{enabled, binPath, yolo, extraArgs}` … the master-only `mcp__mcd__hermes_run` MCP tool" — confirms current master-only contract this change widens.
- `src/master-mcp-server.ts:793` — `'hermes_run is only available in the master channel session'` — the exact gate being replaced.
- `src/hermes-bridge.ts:31` — `hermes send --to discord:${masterChatId}` — the report-back line re-targeted per-caller.
- `ProjectSchema` fields `handoff` / `botPeers` in `src/channels-config.ts` — the established per-project opt-in pattern (optional block, absent = off) this design copies.
