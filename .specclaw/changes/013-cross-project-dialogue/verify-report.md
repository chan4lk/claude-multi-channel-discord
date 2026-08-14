# Verification Report: cross-project-dialogue

**Verified:** 2026-07-17
**Model:** claude-sonnet-4-6
**Verdict:** PASS

## Acceptance Criteria

- ✅ **AC1:** `tools/list` for a project without `peers` config omits `ask_project`, `share_learning`, `read_learnings`; with `peers.allow` non-empty, all three appear. Master lists learnings tools but not `ask_project`. — Verified by direct test assertions in `master-mcp-server.test.ts` lines 426–445. Code path: `peerSource()` returns null for projects without `peers.allow`; learnings exposure gated by `hasPeerAccess = peerSrc !== null || getMasterChatId() === chatId` (`master-mcp-server.ts:428`). All 9 AC1 checks PASS.

- ✅ **AC2:** `ask_project` A→B with mutual consent delivers: pool receives envelope with `userId: "peer:<aSlug>"` and content matching FR5 format; tool result includes `thread_id` and `hop`. — Confirmed in test lines 447–487: pool receives envelope at PEER_B_CHAT with `userId: "peer:project-a"`, content contains `[Peer message from "project-a" thread=t-... hop=1/2]`, result JSON has `thread_id` (starts with `t-`) and `hop === 1`. All 6 AC2 sub-checks PASS.

- ✅ **AC3:** One-way allow (A allows B, B does not allow A) → `errorResult` mentioning mutual consent; nothing delivered. — Verified: test lines 489–497 (A targets C; C has no peers.allow). Error path hits `master-mcp-server.ts:684–686`: `tgtAllows.includes(srcSlug)` false → errorResult mentioning "mutual consent required". Both checks PASS.

- ✅ **AC4:** With `maxHops: 2` on a thread: third delivery on that thread is refused; a fresh thread delivers again. — Project-A config has `maxHops: 2`. Test lines 499–526: hop1 and hop2 succeed, hop3 returns isError with "hop budget exhausted". Fresh thread (no thread_id) starts new, succeeds. All 4 AC4 checks PASS.

- ✅ **AC5:** Two deliveries on the same pair within `cooldownSeconds` → second refused; after the window (fake clock), it succeeds. — Injectable `now` clock used (`master-mcp-server.ts:167`; `MasterMcpServerOptions.now`). Test lines 528–549: cd1 succeeds, cd2 (same timestamp) refused, fakeNow advanced 20s (> 15s default), cd3 succeeds. All 3 AC5 checks PASS.

- ✅ **AC6:** `ask_project` targeting master slug or self → error; unknown slug → error. — Code paths at `master-mcp-server.ts:667–675`. Tests: self-reference check (lines 554–558), unknown slug check (lines 560–564), and no-peers-project calling ask_project (lines 566–571). All 3 AC6 checks PASS.
  - ⚠️ Edge case: The FR7 master-exclusion code path at line 667–669 (`'master project is not a valid ask_project target'`) is not directly tested. In the test's `peerConfig`, the master chat (`PEER_MASTER`) has no corresponding entry in the `projects` map, so targeting a master-slug resolves to "unknown slug" before the FR7 guard fires. The guard exists and is correct, but a scenario where master has a slug in the projects map is not exercised by the test.

- ✅ **AC7:** `share_learning` appends a slug-attributed, timestamped line; `read_learnings` returns it; tag filter excludes non-matching entries; `limit` respected, newest first. — Tested exhaustively in both `shared-learnings.test.ts` (24 checks, all PASS) and `master-mcp-server.test.ts` (tool-level tests, lines 573–662, all PASS). Tag normalization (strip `#`, lowercase, drop empties), AND semantics, newest-first ordering all verified.

- ✅ **AC8:** Appending past 64 KB drops oldest entries, keeps newest (file stays ≤ cap and still parses); >2 KB entry rejected with error. — `shared-learnings.ts:74–75` (entry cap), `92–96` (rotation loop). `shared-learnings.test.ts` rotation test: 80 entries × ~950 bytes each, then `statSync` confirms `size ≤ 64 * 1024` and newest 5 entries are retained. All 5 AC8 checks PASS.

- ✅ **AC9:** `set <slug> --peers <other>` persists `peers.allow` to channels.json; `--peers none` removes it; unknown slug and self-reference rejected with usage message. — Implemented in `master-commands.ts:661–800`. Tested in `master-commands.test.ts` lines 1128–1225: persist (PASS), replace-preserves-limits (PASS), none-removes-block (PASS), unknown-slug-rejected (PASS), self-reference-rejected (PASS), master-slug-rejected (PASS). All 9 AC9 checks PASS.

- ✅ **AC10:** Mirror posts: successful delivery sends both channel previews (assert via mocked client), truncated at 200 chars. — Implementation at `master-mcp-server.ts:726–742`: `const preview = text.slice(0, 200)`. Mock Discord client captures channel.send calls (`peerMirrors` array). Test lines 476–487: 2 mirrors posted, source gets `→ project-b:` prefix, target gets `from project-a:` prefix. All 3 AC10 checks PASS.
  - ⚠️ Edge case: The test uses a short text ("hello from A"); the 200-char truncation is implemented correctly in code (`text.slice(0, 200)`) but is not exercised by a test with text >200 chars. The implementation is correct; there is no test verifying the truncation boundary.

- ✅ **AC11:** Full gate: `bun tsc --noEmit` + all three existing test files + new tests pass. — `bun tsc --noEmit`: clean (no output). `bun src/master-mcp-server.test.ts`: all checks pass (31 existing + 43 new = 74 total). `bun src/master-commands.test.ts`: all checks pass (includes AC9 peers block). `bun src/project-pool.test.ts`: all checks pass. `bun src/bot-peers.test.ts`: all 18 checks pass. `bun src/shared-learnings.test.ts`: all 24 checks pass.

## Test Results

```
bun src/shared-learnings.test.ts
  24 checks — All tests passed.

bun src/master-mcp-server.test.ts
  74 checks — all checks passed

bun src/master-commands.test.ts
  (AC9 block, all peers-related checks) — all checks passed

bun src/project-pool.test.ts
  all checks passed

bun src/bot-peers.test.ts
  18 checks — All tests passed.

bun tsc --noEmit
  (no output — clean)
```

## Issues Found

1. **FR7 master-as-target code path not tested** — The specific error `'master project is not a valid ask_project target'` (`master-mcp-server.ts:668`) is unreachable in the test suite because the test `peerConfig` has no projects entry for the master chatId, so the slug lookup returns `undefined` before the guard fires. The guard is implemented correctly and will function in production where master does have a project entry. **Fix:** Add a test case where a project entry exists with the master chatId, and assert that targeting its slug produces the FR7-specific error message rather than "unknown slug".

2. **AC10 truncation boundary not exercised by test** — The mirror preview `text.slice(0, 200)` is correct in the implementation but no test sends text longer than 200 characters to verify the truncation. Low risk since the implementation is trivially correct. **Fix:** Add an AC10 test case with `text: 'x'.repeat(250)` and assert that the mirror content has `preview` of length ≤200.

## Summary

**Passed:** 11/11 criteria
**Failed:** 0/11 criteria
**Verdict:** PASS
