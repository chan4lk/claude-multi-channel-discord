# Status: Codex Project Runner for MCD Channels

**Change:** 032-codex-project-runner
**Started:** 2026-10-19
**Last Updated:** 2026-10-19

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Proposal | ✅ Approved |  |
| Spec | ✅ Done |  |
| Design | ✅ Done |  |
| Tasks | ✅ Done |  |
| Build | ✅ Done | 7/7 tasks |
| Verify | ✅ Passed | PASS |
| PR | ✅ Raised | https://github.com/chan4lk/claude-multi-channel-discord/pull/333 |

## Task Progress

**Completed:** 7 / 7
**Failed:** 0
**Deferred:** 0

## Agent Runs

| Task | Agent | Model | Status | Duration | Review |
|------|-------|-------|--------|----------|--------|
| T1 | config and commands | gpt-6-astra | complete | 2m48s | — |
| T2 | Codex app-server process | gpt-6-astra | complete | 21m51s | — |
| T3 | project pool wiring | — | complete | 34s | — |
| T4 | operator guidance and checks | — | complete | 17m38s | — |
| T5 | reply and lifecycle remediation | — | complete | 4m35s | — |
| T6 | live MCP reply remediation | — | complete | — | PASS |
| T7 | first-turn thread persistence | — | complete | — | PASS |

## Issues

The full `master-commands.test.ts` script still has six pre-existing heartbeat classification failures. Its Codex command assertions pass, and the new focused `codex-commands.test.ts` suite passes independently. The Mission Control production build needed `MC_DB_PATH=:memory:` during page collection to avoid a SQLite lock; finalization passed with that build-time setting. The initial live Codex turn exposed an MCP approval denial and a silent empty final answer; T6 resolved both. T7 fixed the inability to resume a thread saved before its first turn.

## Post-build review

All 19 committed files appear in at least one task's declared file list. The design needed two refinements during implementation: Codex messages now use the existing channel envelope expected by project prompts, and Codex receives the same git credential environment as Claude projects. Codex has no Claude transcript, so the pool reports transcript-based monthly budget enforcement as unavailable rather than calculating usage from an old Claude session. T5 added direct tests for command routing, reply threading, progress, and watchdog interruption. T6 and T7 added live authenticated app-server smoke tests against a temporary MCD MCP endpoint, including a resumed second turn.
