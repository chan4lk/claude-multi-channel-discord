# Status: Hermes invoke from project channels

**Change:** hermes-project-invoke
**Started:** 2026-07-25
**Last Updated:** 2026-07-25

## Progress

| Phase | Status | Notes |
|-------|--------|-------|
| Proposal | ✅ Approved | Operator approved option B 2026-07-25 |
| Spec | ✅ Complete | 7 FRs, 8 ACs |
| Design | ✅ Complete | hermesAccess predicate + reportChatId plumbing |
| Tasks | ✅ Complete | 5 tasks, 3 waves |
| Build | ✅ Complete | 5/5 tasks, 0 failed |
| Verify | ✅ Passed | 8/8 ACs — see verify-report.md |
| PR | ✅ Raised | https://github.com/chan4lk/claude-multi-channel-discord/pull/317 |

## Task Progress

**Completed:** 5 / 5
**Failed:** 0

- [x] T1 — Project hermes schema (`src/channels-config.ts`)
- [x] T2 — reportChatId through hermes-bridge (`src/hermes-bridge.ts`)
- [x] T3 — MCP server gate + audit notice + tests (`src/master-mcp-server.ts` + test)
- [x] T4 — `set --hermes on|off` verb (`src/master-commands.ts` + test)
- [x] T5 — Docs (`CLAUDE.md`, `ARCHITECTURE.md`, `README.md`)

## Agent Runs

| Task | Agent | Model | Status | Duration |
|------|-------|-------|--------|----------|
| T1 | main (direct) | fable-5 | ✅ | ~1 min |
| T2 | main (direct) | fable-5 | ✅ | ~1 min |
| T3 | general-purpose | fable-5 | ✅ | 4.3 min |
| T4 | general-purpose | fable-5 | ✅ | 3.2 min |
| T5 | main (direct) | fable-5 | ✅ | ~3 min |

## Issues

None. Two minor verify notes (CLAUDE.md inline field list — fixed on branch; unknown-target `--hermes` test — accepted, shared code path).

**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/317
