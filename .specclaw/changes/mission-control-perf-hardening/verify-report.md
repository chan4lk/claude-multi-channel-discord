# verify-report.md — mission-control-perf-hardening

**Change:** mission-control-perf-hardening
**Verified:** 2026-07-29
**Verifier:** specclaw-verify agent

---

## Per-AC Evaluation

### AC1 — Warm response < 200 ms for tool-heatmap, turn-heatmap, momentum-index

**Verdict: UNVERIFIABLE by static means** (server not restarted with new build since PR merge at 08:19 UTC; mc-dashboard started 2026-07-23)

**Proxy evidence (code inspection):**
- `app/api/tool-heatmap/route.ts`: calls only `toolCounts({ sinceMs })` → single indexed `GROUP BY` SELECT on `mc_tool_call`. No transcript reads.
- `app/api/turn-heatmap/route.ts`: calls only `turnHourDowBuckets({ sinceMs })` → single indexed `GROUP BY` SELECT on `mc_turn`. No transcript reads.
- `app/api/metrics/momentum-index/route.ts`: calls only `tokensSince({ sinceMs })` → single `SUM` on `mc_turn`. No transcript reads.
- All three replaced the full `readdir + readFileSync(*.jsonl)` hot path with a single prepared-statement query. The latency reduction is structurally guaranteed once the index is populated.

---

### AC2 — Fact-index counts match direct transcript scan within documented tolerance

**Verdict: MET**

**Evidence:** `fact-index-ingest.test.ts` parity checks all pass (27/27 checks PASS):
- `parity-all-time`: index toolCounts == direct scan (exact match)
- `parity-since-10:00Z`: windowed counts match
- `parity-since-13:00Z`: empty window agrees on zero
- `parity-tokens-alpha` / `parity-tokens-beta`: monthlyTokens exact (input + output, totalTokens = sum)

---

### AC3 — Seven routes return 401 for forged/absent cookie

**Verdict: UNVERIFIABLE by static means** (requires running server with auth middleware)

**Proxy evidence:** All 7 routes call `requireSession()` as the first statement in their GET handler, before any data access:
- `tool-heatmap/route.ts:16` — `const unauth = await requireSession(); if (unauth) return unauth`
- `turn-heatmap/route.ts:51` — same pattern
- `metrics/momentum-index/route.ts:66` — same pattern
- `metrics/[slug]/route.ts:150` — same pattern
- `turn-duration/route.ts:62` — same pattern
- `capability-map/route.ts:53` — same pattern
- `health-scorecard/route.ts:122` — same pattern

`requireSession()` at `src/security.ts` calls `auth.api.getSession({ headers })` and returns `Response.json({ error: "Unauthorized" }, { status: 401 })` when no valid session is found. Cookie-presence-only check is replaced.

---

### AC4 — Seven routes return 200 with data for valid session

**Verdict: UNVERIFIABLE by static means** (requires running server with valid session)

**Proxy evidence:** Same `requireSession()` pattern — if session exists, the function returns `null` and the route proceeds. Response shapes preserved (verified by `satisfies` TypeScript type-checking against existing interface types on all 7 routes).

---

### AC5 — Running ingester twice leaves row counts unchanged (idempotent)

**Verdict: MET**

**Evidence:**
- `fact-index-ingest.test.ts` checks `idem-1`, `idem-2`, `idem-3` — all PASS
- Second `ingestOnce` call returns `{ ingestedFiles: 0, turns: 0, toolCalls: 0 }`; mc_turn and mc_tool_call counts unchanged
- Mechanism: per-file byte-offset in `mc_ingest_state`; when `size === offset`, `ingestFile` returns `null` without touching DB

---

### AC6 — Appended turns/tool calls queryable within one ingest interval

**Verdict: MET**

**Evidence:**
- `fact-index-ingest.test.ts` checks `resume-1` through `resume-4` — all PASS
- Appending one `assistantLine` + tool-use block: next `ingestOnce` ingests exactly 1 turn, 1 toolCall
- `toolNameCount("alpha", "Write") === 1` (new); `toolNameCount("alpha", "Read") === 1` (unchanged — no re-ingest of prior bytes)
- `partial-1`: incomplete trailing line (no final `\n`) not ingested; `partial-2`: completes on next run

---

### AC7 — `mc-web.service` disabled; only `mc-dashboard` on port 3003

**Verdict: NOT MET (operator action outstanding)**

**Evidence:**
- `systemctl --user is-enabled mc-web.service` → `enabled`
- `systemctl --user status mc-web.service` → `activating (auto-restart) / exit-code` (crash-looping every ~5s because mc-dashboard holds the port)
- `ss -tlnp | grep 3003` → `0.0.0.0:3003` owned by `mc-dashboard` PID 521753 ✓
- `MISSION-CONTROL-OPS.md` documents the disable command and notes it must run as operator/Hermes (cannot run from inside MCD). The code change is correct; the operational step is pending.

**Note:** mc-dashboard holds the port correctly (port 3003 not served by mc-web). Only the `systemctl --user disable --now mc-web.service` step is outstanding, plus removing the `mc-auto-rebuild` cron entry documented in the ops doc.

---

### AC8 — Only MC_DB_PATH database written; app-dir mc.db gone and git-ignored

**Verdict: MET**

**Evidence:**
- `apps/mission-control/.gitignore` contains: `mc.db`, `mc.db-shm`, `mc.db-wal`, `mc.db-journal` ✓
- `git ls-files apps/mission-control/mc.db` → error (not tracked) ✓
- No file `apps/mission-control/mc.db` exists on disk ✓
- `src/db.ts:32`: `const dbPath = process.env.MC_DB_PATH ?? "mc.db"` — respects env; the stray default is handled by the gitignore
- `mc-dashboard.service` unit sets `Environment=MC_DB_PATH=/home/openclaw/srv/mission-control-hub/mc.db` ✓
- Production db confirmed at `/home/openclaw/srv/mission-control-hub/mc.db` (72 MB, contains fact-index schema tables) ✓

---

### AC9 — `bun tsc --noEmit` passes; existing tests pass

**Verdict: MET**

**Evidence:**
- `bun tsc --noEmit` → zero output (clean) ✓
- `bun apps/mission-control/src/fact-index.test.ts` → **22/22 checks PASS** ✓
- `cd apps/mission-control && NODE_PATH="$PWD/node_modules" node /tmp/mc-vt/fact-index-ingest.test.js` → **27/27 checks PASS** ✓
- `cd apps/mission-control && bun test lib/` → **11 tests, 0 fail** (33 expect() calls) ✓

---

### AC10 — SSE broadcaster tick no longer calls full-transcript scan functions

**Verdict: MET** (remediated post-verify: commit `6c044c8` adds wm-1…wm-6 watermark checks for `toolCallsSince()`/`maxToolCallId()` — 33/33 ingester checks pass)

**Code inspection evidence (`src/sse.ts`):**
- Imports: `{ computeFleet, computeStalls }` from `./fleet-compute`; `{ maxToolCallId, toolCallsSince }` from `./fact-index`. No `fs`, no `readFileSync`, no `readdir`, no `.jsonl` opens.
- `checkToolEvents()` (lines 78–93): queries `maxToolCallId()` (first tick to initialize watermark) and `toolCallsSince({ afterId })` (subsequent ticks). Zero file IO. Comment confirms: "fact index replaces the old full-transcript read + per-slug line tracker, so the broadcaster never opens transcript files."
- `computeMonthlyTokensUsed` in `src/fleet-compute.ts` (line 205): returns `monthlyTokens({ slug, yearMonth }).totalTokens` — fact-index call. ✓

**Test coverage (remediated):** `fact-index-ingest.test.ts` now includes wm-1…wm-6: maxToolCallId matches SQL MAX(id), toolCallsSince(max) empty, toolCallsSince(0) returns all rows ascending, only rows past the watermark returned after a fresh ingest, fresh row carries slug/tool_name, watermark advances. All 33 checks pass (commit `6c044c8`).

**Note:** `computeFleet` / `computeStalls` in `fleet-compute.ts` still read transcript mtimes for fleet state/stall detection — this is **in scope** per the spec ("remaining ~211 routes keep transcript-reading helpers") and not part of FR5 which scoped only `checkToolEvents` and `computeMonthlyTokensUsed`.

---

## Gates

| Gate | Result |
|------|--------|
| `bun tsc --noEmit` | ✅ PASS (0 errors) |
| `bun src/fact-index.test.ts` | ✅ PASS (22/22) |
| `node fact-index-ingest.test.js` | ✅ PASS (27/27) |
| `bun test lib/` | ✅ PASS (11/11) |

---

## Summary of Findings

**Passing (fully met):** AC2, AC5, AC6, AC8, AC9, AC10 (after remediation `6c044c8`)

**Unverifiable by static means (code confirms correct implementation):** AC1, AC3, AC4 — these require a running server with ingested data (service restart pending). The code paths are correct; no transcript reads remain on the 7 hot routes.

**Not met — operator action outstanding:** AC7 — `mc-web.service` is still `enabled` (crash-looping on the port it lost). `MISSION-CONTROL-OPS.md` correctly documents the `systemctl --user disable --now mc-web.service` step as a Hermes/operator action.

**Additional deploy note:** `mc-dashboard.service` has been running since 2026-07-23 (before the PR). The fact-index tables exist in the production DB but are empty (0 rows in `mc_turn`, `mc_tool_call`, `mc_ingest_state`). A `next build` + service restart is required to activate `instrumentation.ts register()` and start the ingester. Also note: `mc-dashboard.service` has `ProtectHome=read-only` + `ReadWritePaths=.next/` only; `/home/openclaw/srv/mission-control-hub/` should be added to `ReadWritePaths` to guarantee the ingester can write `mc.db` under systemd hardening (auth tables exist in the DB, suggesting this has worked historically, but it is not explicitly granted).

---

**Verdict: PARTIAL**

All code changes are correct and complete; the AC10 test gap was remediated in commit `6c044c8` (33/33 ingester checks). The remaining gaps are deploy-side, not code-side: AC1/AC3/AC4 are unverifiable until the server is rebuilt + restarted with the new code, and AC7 (disable `mc-web.service` + remove the `mc-auto-rebuild` cron) is an operator/Hermes action. Re-verify after deploy to upgrade to PASS.
