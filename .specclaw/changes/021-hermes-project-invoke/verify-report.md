# Verification Report: hermes-project-invoke

**Verified:** 2026-07-25
**Model:** claude-sonnet-4-6
**Verdict:** PASS

## Acceptance Criteria

- ✅ **AC1:** Zod schema accepts `{ hermes: { enabled: true } }` on a project entry and rejects `{ hermes: { enabled: "yes" } }`; absent block parses with no default object injected — `src/channels-config.ts` lines 203–206: `ProjectHermesSchema = z.object({ enabled: z.boolean().default(false) }).strict()` and `hermes: ProjectHermesSchema.optional()` on ProjectSchema (line 249). Live bun eval confirmed: `hermes enabled:true accepted: true`, `hermes enabled:string rejected: true`, `absent hermes -> no default injected: true`.

- ✅ **AC2:** Tool-list matrix — all six cases covered with passing tests in `src/master-mcp-server.test.ts` (lines 416–421): master+bridge-on listed; master+bridge-off not; project flag-on+bridge-on listed; project flag-on+bridge-off not; project flag-off not; project no-block not. All six PASS.

- ✅ **AC3:** Call-gate matrix — denied cases return `isError` and spawnFn is never called; allowed cases spawn and return `run <id> launched`. `AC3: denied cases never reach spawnFn` and `AC3: denied cases emit no audit notice` PASS. Defense-in-depth gate in `master-mcp-server.ts` lines 789–795 independently checks `hermesAccess(chatId)` in the call handler.

- ✅ **AC4:** Project-initiated run's wrapped prompt contains `hermes send --to discord:<project_chat_id>` and NOT the master chat id; master run still targets master — `src/hermes-bridge.ts` lines 17–34 (`wrapHermesPrompt` uses `reportChatId`); `master-mcp-server.ts` line 809: `reportChatId: access === 'project' ? chatId : undefined`. Tests PASS both directions.

- ✅ **AC5:** Project launch triggers exactly one `onReply` to master containing runId, slug, ≤120-char prompt preview; master launch triggers none — `master-mcp-server.ts` lines 813–820. Tests PASS including truncation of a 150-char prompt to exactly 120.

- ✅ **AC6:** `set --hermes` cases covered in `src/master-commands.test.ts` lines 1053–1144: on+yes persists `hermes.enabled: true`; on without yes refused (config unchanged); off removes block; master target warn no-op (on and off); `--hermes maybe` usage error. All PASS. ⚠️ Minor: unknown-target path shared with other set flags, not exercised with `--hermes` specifically.

- ✅ **AC7:** `bun tsc --noEmit` clean; all suites pass: master-mcp-server, master-commands, project-pool, bot-peers, shared-learnings, scheduler (all checks passed), backlog (81 checks).

- ✅ **AC8:** Docs updated: CLAUDE.md (config key bullet + set flags + hermes bridge section), ARCHITECTURE.md (set verb row line 252 + schema line 296), README.md (new "Grant a project channel access" subsection lines 318–325). ⚠️ Minor: CLAUDE.md inline `projects[<chat_id>].{...}` field list omitted `hermes?` — fixed post-verify.

## Test Results

```
bun src/master-mcp-server.test.ts  → all checks passed (includes AC2–AC5 matrix tests)
bun src/master-commands.test.ts    → all checks passed (includes AC6 set --hermes tests)
bun src/project-pool.test.ts       → all checks passed
bun src/bot-peers.test.ts          → All tests passed
bun src/shared-learnings.test.ts   → All tests passed
bun src/scheduler.test.ts          → All scheduler checks passed
bun src/backlog.test.ts            → All 81 checks passed
bun tsc --noEmit                   → (no output, clean)
```

## Issues Found

1. **CLAUDE.md `projects[<chat_id>]` inline field list incomplete** — omitted `hermes?`. Fixed in follow-up commit on this branch.
2. **No dedicated test for `set <unknown> --hermes`** — code path shared with all `set` flags and covered by existing not-found tests; accepted as-is.

## Summary

**Passed:** 8/8 criteria
**Failed:** 0/8 criteria
**Verdict:** PASS
