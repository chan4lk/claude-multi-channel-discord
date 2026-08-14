# Verify Report: specclaw-status-visibility

**Date:** 2026-07-12
**Verdict:** PASS

## Acceptance Criteria

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 — Parser returns `{present:false}` for no `.specclaw/` dir, no `STATUS.md`, unreadable file without throwing | ✅ | specclaw-status.test.ts: 4 checks PASS; `readFileSync` try/catch at `src/specclaw-status.ts:17-21` |
| AC2 — Fixture `🔨 foo — 3/8 tasks (38%) \| 1 failed` + 2 pending proposals → correct struct | ✅ | specclaw-status.test.ts: 6 checks PASS |
| AC3 — Phase resolution: Build row `🔨`, earlier rows `🟢` → `phase: 'build'` | ✅ | specclaw-status.test.ts: 3 checks PASS; `src/specclaw-status.ts:100-103` |
| AC4 — `✅`-only dashboard → `activeChange` undefined, `present: true` | ✅ | specclaw-status.test.ts: 2 checks PASS |
| AC5 — `show` renders `specclaw:` line; omitted when no `.specclaw/` | ✅ | master-commands.test.ts AC5a/AC5b (4 checks) PASS; `src/master-commands.ts:307-326` |
| AC6 — heartbeat full-scan renders `🦞 specclaw:` block; absent when none | ✅ | master-commands.test.ts AC6a/AC6b (3 checks) PASS; `src/master-commands.ts:1744-1748` |
| AC7 — tsc clean; all existing suites green | ✅ | tsc exit 0; suites below |

## Test Results

```
bun src/specclaw-status.test.ts   → 25/25 checks PASS
bun src/master-commands.test.ts   → 88/88 checks PASS
bun src/project-pool.test.ts      → all checks PASS
bun src/master-mcp-server.test.ts → 11/11 checks PASS
bun tsc --noEmit                  → clean (exit 0)
```

## Notes

- NFR1 read-only: parser imports only `readFileSync`; no writes.
- NFR2 robust: all IO guarded; missing sections → undefined fields, no throws.
- NFR3 cheap: exactly 2 `readFileSync` calls, no directory walks.
- Edge case `failedTasks = 0` covered (regex matches `| 0 failed`).
- Single-channel heartbeat mode also appends the specclaw block (`src/master-commands.ts:1709-1714`).
