# Design: SpecClaw Status Visibility in Show + Heartbeat

**Change:** specclaw-status-visibility
**Created:** 2026-07-12

## Technical Approach

One new pure module + two one-line-ish render hooks. All parsing is line-oriented regex over two known-format markdown files written by the specclaw plugin's `specclaw-update-status` script.

## Architecture

```
src/specclaw-status.ts        NEW  readSpecclawStatus(projectCwd) → SpecclawStatus
        ▲                ▲
        │                │
src/master-commands.ts   src/master-commands.ts
  handleShow()             handleHeartbeat()
  (specclaw: line)         (🦞 specclaw: block)
```

Parsing sources:
1. `<cwd>/.specclaw/STATUS.md` — dashboard. Active Changes bullet: `/^- (🔨|✅|[^ ]+) \*\*(.+?)\*\* — (\d+)\/(\d+) tasks.*?\| (\d+) failed/`. Pending Proposals: count `/^- 📋/` lines within that section.
2. `<cwd>/.specclaw/changes/<active>/status.md` — `## Progress` table rows, split on `|` (same approach as `specclaw-guard.ts:26-43`); first row (skipping Proposal) whose status cell lacks 🟢/✅ → `phase`.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/specclaw-status.ts` | create | `SpecclawStatus` interface + `readSpecclawStatus()` |
| `src/specclaw-status.test.ts` | create | fixture-dir tests (tmpdir), AC1–AC4 |
| `src/master-commands.ts` | modify | `handleShow`: specclaw line; `handleHeartbeat`: specclaw block |
| `src/master-commands.test.ts` | modify | AC5/AC6 render assertions |

## Data Model Changes

None (read-only; no config/schema changes).

## API Changes

None external. New internal export `readSpecclawStatus`.

## Key Decisions

- **New module, not extending `specclaw-guard.ts`:** guard is a boolean gate consumed by build tooling; reporting has a different shape and consumers. Guard stays untouched (zero regression risk).
- **`activeChange` = first 🔨 entry:** matches dashboard generator semantics; ✅-only dashboards mean nothing in flight.
- **Heartbeat block only lists active changes:** keeps the 30m heartbeat short; idle specclaw projects add noise without signal.
- **`projectDir(slug)` + realpath not needed:** `.specclaw` lives in the project cwd itself (symlink targets resolve on read).

## Risks & Mitigations

- **Dashboard format drift** (specclaw plugin upgrades, e.g. 0.4.3 → 0.5.0 templates): regexes anchored on stable tokens (`**name**`, `x/y tasks`, `📋`); every parse failure degrades to undefined fields, never a crash. Fixture tests pin the current format so drift surfaces as a test failure.
- **Per-project file reads in heartbeat scan** (~27 projects × 2 reads every 30m): negligible; reads are local and small.
