# Design: progressMode "phases"

**Change:** progress-mode-phases

## Data flow

```
claude-process poll (existing 2s transcript watcher)
  └ pollSpecclawProgress()            gated: opts.progressMode === 'phases' && handlers attached
      takeSpecclawProgressSnapshot()  reads .specclaw/STATUS.md + change status.md (via readSpecclawStatus + verify-row parse)
      classifySpecclawTransitions(prev, next) → lines[]
      fireSpecclawProgress({ change, lines })   only when lines.length > 0
  → ProjectPool onSpecclawProgress → { kind: 'specclaw-progress' } pool event
  → server.ts handleSpecclawProgressEvent → one Discord msg per chatId:change, edit-in-place
```

## Key decisions

- **Pure classifier, timestamps at dispatch.** `classifySpecclawTransitions` takes (prev, next) snapshots and returns bare lines — no Date, fully fixture-testable (AC5). Server stamps `HH:MM` UTC observation time when appending (proposal's open question resolved: observation time).
- **Baseline-only first snapshot.** At spawn/mode-attach, store the snapshot without emitting — otherwise every respawn replays the current state as fake transitions.
- **Gate in the subprocess, not the server.** `opts.progressMode` threads into `ClaudeProjectProcess` so non-phases projects pay zero disk reads. Server still re-checks mode at dispatch (config may change between spawn and event).
- **AC4 by construction.** `handleToolProgressEvent` early-returns for `phases` — tool events never render. The phases path only consumes specclaw disk diffs, so `mcp__mcd__*` suppression is inherited (those never touch `.specclaw/`).

## Transition classification

Given prev/next snapshots (both `present`):
1. `next.activeChange` differs from `prev.activeChange` (or appears) → `🔨 <change> started` — one line, other same-tick diffs vs the old change suppressed (different change's counters aren't comparable).
2. Same change, `phase` changed → `<phase> started` + ` (N tasks)` suffix when phase is `build` and `tasksTotal` known.
3. Same change, `tasksDone` changed → `tasks <done>/<total> ✅`.
4. Same change, `verify` changed to a verdict → `verify 🟢` / `verify 🔴`.

Multiple genuine transitions in one tick (e.g. task count + verify) each produce their own line, appended in the order above.

Verify verdict parse: the active change's `status.md` Verify phase row — 🟢/✅ → `pass`, 🔴/❌ → `fail`, else undefined. Reuses the same Progress-table walk shape as `readSpecclawStatus`'s FR3 block.

## Discord rendering (server.ts)

`phasesProgressState = Map<'chatId:change', { msgId: string; lines: string[] }>` — mirrors `editProgressState` mechanics: fetch+edit, re-post on missing message, `slice(-15)` lines, 1900-char cap. Content:

```
🦞 <change>
├ 09:41 build started (8 tasks)
├ 09:55 tasks 3/8 ✅
└ 10:02 verify 🟢
```

Header always; accumulated lines joined with `├ ` except last `└ `. Discord-only v1: teams/whatsapp platforms return early (out of scope).

## Event plumbing

- `project-process.ts`: `SpecclawProgressEvent { change: string; lines: string[] }`; optional `onSpecclawProgress?()` on the `ProjectProcess` interface (mock untouched).
- `project-pool.ts`: PoolEvent union + subscription + cleanup, same shape as `onToolProgress`.

## Testing

`src/specclaw-progress.test.ts` — tmpdir fixtures + pure classifier sequences: build-start, task increments, verify verdicts, change switch, no-diff → `[]`, absent `.specclaw/` → `present:false` snapshot and no transitions. Schema acceptance test lives with the classifier suite (parse a projects entry with `progressMode: 'phases'`).
