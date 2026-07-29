# Verify Report: ops-mcp-surface

**Date:** 2026-07-29
**Verdict:** PASS

## Gate Results

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `bun tsc --noEmit` | PASS |
| Build | mission-control `next build` | PASS (204/204 pages, compiled clean) |
| Tests | `bun src/master-commands.test.ts` | PASS ("all checks passed", re-run during verify) |
| Tests | `bun src/master-mcp-server.test.ts` | PASS ("all checks passed", re-run during verify) |
| Tests | project-pool, bot-peers, shared-learnings, backlog, scheduler | PASS ("all checks passed" each) |

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 | ✅ met | Checks `ops AC1: no token → 401`, `wrong token → 401`, `unconfigured opsToken → 401` all PASS; `route()` 401s via `opsTokenValid()` before serving (`src/master-mcp-server.ts:298`) |
| AC2 | ✅ met | Check `ops AC2: tools/list is exactly the 7 ops tools` PASS — sorted list compared against exactly `[backlog_state, collab_state, list_projects, project_status, schedules, server_info, usage]` |
| AC3 | ✅ met | Checks `ops AC3: list_projects composes 'list'` + `result text is the command rendering` PASS against injected `executeMasterCommand` stub |
| AC4 | ✅ met | Five composition checks PASS: `show ops-project`, `backlog ops-project`, `collab ops-project`, `usage`, `schedule list` / `schedule list ops-project` |
| AC5 | ✅ met | Checks `ops AC5: injection slug → tool error` + `stub not called for bad slug` PASS (`foo --yes` and `a b`); regex `/^[A-Za-z0-9._-]{1,64}$/` gates before composition in `buildOpsServer()` |
| AC6 | ✅ met | Checks `ops AC6: opsToken rejected on chat route` + `chat local token rejected on /mcp/ops` PASS; `opsToken` grep confirms it is only read inside `opsTokenValid()`, never in `tokenSource()` |
| AC7 | ✅ met | 14 new master-command checks PASS: 64-hex persist + one-time reveal + Caddy reminder, masked status (`**on** … slice(0,4)…slice(-3)`), full token absent from status, `none` removal + friendly no-op, `rotate` without `--yes` refused with nothing persisted, non-allowFrom → `unauthorized`; `'ops'` added to `MUTATION_VERBS` (`src/master-commands.ts:100`) |
| AC8 | ✅ met | Checks `ops AC8: server_info reports counts` (projects:1, warmSessions:2) + `leaks no token` PASS; handler returns only name/version/projects/warmSessions/masterConfigured |
| AC9 | ✅ met | `bun tsc --noEmit` PASS gate; all 7 pre-existing suites pass; new checks live in both `src/master-mcp-server.test.ts` (~25 checks) and `src/master-commands.test.ts` (~14 checks), both re-run clean during verify |
| AC10 | ✅ met | README "Ops MCP surface (optional)" section: rotate flow, Caddyfile `handle_path` + `header_up x-mcd-token` recipe, `claude mcp add --transport http` example, rotate⇒Caddy-drift gotcha box |

## Context Rules Compliance

- **Gate-method convention:** auth gate is a private method on `MasterMcpServer` (`opsTokenValid()`), timing-safe compare with length pre-check (NFR4). Minor deviation: it returns `boolean` rather than the `<feature>Source` discriminator-or-null shape — but design.md explicitly specified `opsTokenValid(presented): boolean`, so implementation matches the approved design.
- **Defense in depth (structural absence):** ops endpoint is a separate `buildOpsServer()`; session/master tools (`reply`, `run_master_command`, etc.) appear in neither the list handler nor the call switch — verified by AC6 checks (`unknown tool` on both). Whitelist marked as a security boundary in a code comment per design risk #2.
- **Off by default:** `opsToken: z.string().min(16).optional()` — absent field ⇒ every request 401 (test-verified), matching the reach-widening opt-in rule; `rotate` requires `--yes`.
- **No high-churn state in channels.json:** only the low-churn operator-owned `opsToken` secret is added (written solely by `ops rotate`/`ops none` via existing atomic IO) — compliant with the shared/*.json rule.
- **Injectable side effects:** tests inject `getConfig`/`getPool`/`executeMasterCommand`/`log` stubs; no real processes spawned.

## Notes

- The `/tmp/verify-context.txt` payload reported "No changed files found"; verification was performed directly against the checked-out branch (`git diff main`, 8 files, +470/−14) instead — evidence above is from the actual code and live test runs.
- Edge-case ordering nuance: on `/mcp/ops`, auth is checked before method, so an unauthenticated GET returns 401 rather than 405 (authenticated GET → 405, test-verified). This differs cosmetically from chat routes but leaks less to unauthenticated probes — acceptable.
- `min(16)` on the zod field means a hand-edited too-short `opsToken` fails config parse rather than silently enabling a weak token — a sensible hardening beyond spec.
- The stateless serve path was refactored into a shared `serveStateless()` helper used by both chat and ops routes; chat-route behavior is unchanged (NFR3) and all pre-existing tests pass unmodified.
- Follow-up (non-blocking): `ops` log markers are covered by code inspection (`[mcp-master]` prefix + `ops request` / `ops tool <name>`) but have no dedicated log-capture test — FR8 is a logging convention, not an AC, so this does not affect the verdict.
