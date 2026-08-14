# Verify Report: 030-channel-deletion-watch
**Date:** 2026-08-14
**Verdict:** PASS

> Note: the payload at /tmp/verify-ctx.md contained no changed-file contents, "no tests configured," and a build log from an unrelated Next.js app (mission-control). All evidence below was gathered directly from the repo at merge commit `32dfdd5` by reading the code and running the suites.

## Acceptance Criteria
| AC | Status | Evidence |
|----|--------|----------|
| AC1 | ✅ met (code inspection only) | `server.ts:2558-2576` — `channelDelete` handler: `cfg.projects[channel.id]` lookup, `if (!project \|\| project.channelMissingSince) return` (unregistered = no-op, no overwrite), skips non-discord platforms (2563) and master (2564), stamps `channelMissingSince: new Date().toISOString()` (2569). No automated test — server.ts wiring is untestable in this harness (no discord.js mocking); verified by inspection. Logic is minimal and mirrors the tested sweep stamp path. |
| AC2 | ✅ met | `src/scheduler.ts:1013-1028` (stamp on first `'missing'`, no prompt), `:1031` (grace gate, `CHANNEL_MISSING_GRACE_MS = 90*60_000` at `:29`). Tests: `CW1: channelMissingSince stamped to now`, `CW1: no prompt on first observation`, `CW2: mid-grace → no prompt`, `CW2: mid-grace → no save` — all PASS. |
| AC3 | ✅ met | `src/scheduler.ts:1037-1047` — `onPrompt` fired once, `lastMissingAlertAt` stamped. Tests: `CW3: past grace → exactly one prompt`, `CW3: prompt carries slug + chatId`, `CW3: lastMissingAlertAt stamped`, `CW3: channelMissingSince preserved` — PASS. The literal prompt text (slug + `!project rm <slug> --yes --purge` + archive alternative) is built in `server.ts:1703` and matches FR4 verbatim (inspection; text itself not asserted in tests since it lives in untestable server.ts wiring). |
| AC4 | ✅ met | `src/scheduler.ts:1034-1035` (`CHANNEL_MISSING_RENAG_MS = 7*86_400_000` at `:32`). Tests: `CW4a: sweep 1d later → no re-prompt`, `CW4b: sweep 8d later → reminder fires`, `CW4b: reminder re-stamps lastMissingAlertAt` — PASS. |
| AC5 | ✅ met | `src/scheduler.ts:990-1008` — clears both fields via key deletion on fresh read. Tests: `CW5: channelMissingSince cleared`, `CW5: lastMissingAlertAt cleared`, `CW5: no prompt on restore` (fixture starts from prior missing+alerted state) — PASS. |
| AC6 | ✅ met | `src/scheduler.ts:987-988` — `'unknown'` ⇒ `continue`, zero state change. Tests: `CW6: unknown → no save`, `CW6: unknown → no prompt`, `CW6: channelMissingSince untouched` — PASS. |
| AC7 | ✅ met | `src/master-commands.ts:1196-1216` (rmSync, no archive branch), `:1225-1233` (config delete + `removeChannelFromAccessGroups`). Tests: `purge: working dir deleted`, `purge: no new .archive entry`, `purge: removed from channels.json` — PASS. |
| AC8 | ✅ met | `src/master-commands.ts:1206-1208` — `lstatSync` first, symlink ⇒ `unlinkSync` only. Tests: `purge symlink: link removed`, `purge symlink: target dir + sentinel intact`, `purge symlink: removed from channels.json` — PASS. |
| AC9 | ⚠️ unverified by test — code-inspected sound | Guard at `src/master-commands.ts:1210-1215`: `realpathSync(oldDir)` vs `realpathSync(projectsDir())`, refuses unless `real === projectsRoot \|\| real.startsWith(projectsRoot + sep)`, returns before any `rmSync`. No test; `src/master-commands.test.ts:2343-2353` documents why: the escaping layout is unreachable through the public `handleRm` path (SlugSchema rejects `/`/`..`; a symlink takes the AC8 unlink branch; a symlinked ancestor resolves identically in both realpath calls). Requires bind mounts or TOCTOU swap to trigger. Containment check judged correct (`+ sep` suffix blocks the `projects-evil` prefix bypass); accepted as defense-in-depth. |
| AC10 | ✅ met | Sweep: `src/scheduler.ts:980` master skip — tests `CW7: master never probed`, `CW7: non-master project still probed`, `CW7: no prompt, no save` PASS. Gateway handler also skips master (`server.ts:2564`). `rm`: refusal at `src/master-commands.ts:1183-1185` runs before any flag branching — tests `purge: refuses master project`, `purge: master dir untouched` PASS. |
| AC11 | ✅ met | `src/scheduler.ts:983` — `if (project.platform && project.platform !== 'discord') continue`. Tests: `CW8: whatsapp project not probed`, `CW8: teams project not probed`, `CW8: no save, no prompt` — PASS. |
| AC12 | ✅ met | `bun tsc --noEmit` exit 0. All canonical suites pass; two non-zero exits are pre-existing environmental issues unrelated to this change (see below). |

## Test / Lint / Build
- `bun tsc --noEmit` — clean (exit 0).
- `bun src/scheduler.test.ts` — all checks pass, including all CW1–CW9 channel-watch checks.
- `bun src/master-commands.test.ts` — all checks pass, including the full `rm --purge` section.
- All other suites pass: project-pool, master-mcp-server, bot-peers, shared-learnings, backlog, orphan-sweep, channels-config, git-credentials, handoffs, heartbeat, hermes-bridge, memory-store, org-graph, specclaw-progress, specclaw-status, whatsapp-adapter.
- Pre-existing environmental failures (untouched by this change): `src/integration.test.ts` (better-sqlite3 native binding unsupported by bun, ERR_DLOPEN_FAILED); `src/teams-adapter.test.ts` (needs `bun test` runner; passes 7/7 under it).
- No linter configured.

## Context Rules Compliance
- **Injectable side effects** — `registerChannelWatchSweep` takes `getChannels`, `saveChannels`, `channelExists`, `onPrompt`, `nowMs` all opts-injected; tests use a scripted probe + fake clock, never touch Discord (NFR2).
- **Read-fresh-before-write** — every sweep save re-reads `opts.getChannels()` and skips entries absent from the fresh read (NFR3); covers the "rm mid-flight can't be resurrected" edge case.
- **Defense in depth** — realpath containment guard on purge plus lstat-before-exists for dangling symlinks; master exclusion enforced independently in sweep, gateway handler, and `handleRm`.
- **No high-churn state in channels.json** — `channelMissingSince`/`lastMissingAlertAt` written only on state transitions; steady-state sweeps write nothing.
- **Zod conventions** — `.optional()` fields with "Not operator-set" doc comments.
- **Throttled notifications (NFR4)** — prompt routes through `routeNotification`.

## Deviations & Notes
- **AC9 has no test, by documented design** — escape layout not constructible through public path without bind mounts/TOCTOU; guard is fail-closed defense-in-depth. Verdict not downgraded.
- **AC1 + NFR1 probe classification are inspection-only** — `server.ts` wiring is untestable in this harness; the 10003→missing mapping is a one-line ternary matching spec, sweep-level outcomes fully tested (CW1–CW9).
- **FR4 prompt text** in `server.ts:1703` matches spec verbatim.
- **Verification payload was defective** (empty changed-files/test sections, unrelated build log); verdict rests on direct repo evidence.
- `graceMinutes` is a fixed built-in (`CHANNEL_MISSING_GRACE_MS`, 90 min), consistent with spec's "built-in 90".
