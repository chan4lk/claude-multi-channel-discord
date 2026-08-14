# Design: Channel Deletion Watch

**Change:** 030-channel-deletion-watch
**Created:** 2026-08-14

## Technical Approach

Mirror the auto-disable sweep architecture exactly: pure decision logic + injected side effects in `Scheduler`, wiring with real discord.js probe in `server.ts`, runtime state as optional MCD-maintained fields on the project entry in `channels.json`. The destructive surface (`--purge`) lives entirely in `handleRm`, double-gated and realpath-guarded; the watch itself only ever posts a message.

Detection is two-layered but sweep-authoritative: the `channelDelete` gateway event marks `channelMissingSince` early (free, instant), but only the hourly sweep — re-verifying via REST fetch — can prompt the operator, and only after the grace window. A restored channel clears state on any successful probe.

## Architecture

```
discord.js Client
  ├─ Events.ChannelDelete ──► markChannelMissing(chatId)        [server.ts, early mark only]
  └─ channels.fetch(chatId) ◄─ channelExists probe               [injected into sweep]

Scheduler.registerChannelWatchSweep({ getChannels, saveChannels, channelExists, onPrompt, nowMs })
  └─ hourly: for each discord project (non-master):
       probe → 'missing' | 'exists' | 'unknown'
       'missing': set channelMissingSince (if unset)
                  if now - channelMissingSince ≥ graceMs
                     and now - lastMissingAlertAt ≥ 7d (or unset)
                  → onPrompt(slug, chatId) + stamp lastMissingAlertAt
       'exists':  delete channelMissingSince + lastMissingAlertAt
       'unknown': no-op

handleRm(... --purge):
  --yes only        → archive to projects/.archive/   (unchanged)
  --yes --purge     → lstat projects/<slug>
                        symlink → unlinkSync (target untouched)
                        dir     → realpath must be under realpath(projectsDir()) → rmSync recursive
                        else    → refuse
```

Probe classification (in `server.ts` wiring, typed result consumed by scheduler):

```ts
async function channelExists(chatId: string): Promise<'exists' | 'missing' | 'unknown'> {
  try {
    const ch = await client.channels.fetch(chatId)
    return ch ? 'exists' : 'unknown'
  } catch (err) {
    return (err as { code?: number }).code === 10003 ? 'missing' : 'unknown'
  }
}
```

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/channels-config.ts` | modify | Add optional `channelMissingSince` / `lastMissingAlertAt` ISO string fields to project schema with MCD-maintained doc comments |
| `src/scheduler.ts` | modify | `registerChannelWatchSweep()` + `runChannelWatchSweep()` — pure decision logic, injected probe/clock/notify, read-fresh-before-write saves |
| `server.ts` | modify | `Events.ChannelDelete` handler (early mark), `channelExists` probe, sweep registration with `routeNotification` prompt to master |
| `src/master-commands.ts` | modify | `handleRm`: `--purge` flag (symlink unlink / realpath-guarded rmSync); `list` row `🗑` marker; `show` missing-since line; help text |
| `src/scheduler.test.ts` | modify | Sweep tests: mark/grace/prompt/re-nag/clear/unknown/master-skip/platform-skip (AC1–AC6, AC10, AC11) |
| `src/master-commands.test.ts` | modify | `rm --purge` tests: real dir purge, symlink guard, realpath escape refusal, master refusal (AC7–AC10) |

## Data Model Changes

Two new optional project-entry fields in `channels.json` (zod `.optional()`, absent = channel presumed alive):

- `channelMissingSince?: string` — ISO stamp of first missing observation (gateway event or sweep). Cleared on any successful probe.
- `lastMissingAlertAt?: string` — ISO stamp of last master prompt; gates the 7-day re-nag.

Both are MCD-maintained runtime, never operator-set — same contract as `enabledAt` / `lastInjectedAt`.

## API Changes

- New scheduler method: `registerChannelWatchSweep(opts)` / `runChannelWatchSweep(opts)` (public for tests, like `runAutoDisableSweep`).
- `!project rm` gains `--purge` (only meaningful with `--yes`).
- No MCP tool changes.

## Key Decisions

1. **Sweep-authoritative, event-assisted.** The gateway event can be missed (MCD down) and can theoretically fire spuriously; REST re-verification by the sweep is the only prompt trigger. Grace = built-in 90 min (no config knob in v1 — YAGNI, matches "2 consecutive checks" intent with hourly ticks).
2. **Only code 10003 is "missing"** (per context.md defense-in-depth spirit: fail toward no action). Missing Access (50001, bot kicked) is deliberately `'unknown'` — kicked ≠ deleted.
3. **No auto-disable of missing projects.** Delivery from a deleted channel is physically impossible; adding a second disable path tangles runtime stamps for zero benefit.
4. **Purge guard is lstat-first.** Symlinked projects (supported layout per CLAUDE.md paths) get `unlinkSync` only — the real repo elsewhere on disk is never recursively deleted. Real dirs must realpath-resolve under `projects/` before `rmSync(..., { recursive: true, force: true })`.
5. **Runtime state in `channels.json`, not a `shared/*.json` file.** Two low-churn stamps per project (writes only on state transitions, not every sweep) — matches `backlogWatch` precedent, below the high-churn threshold that pushed handoffs into `shared/`. (context.md: "High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json`" — these fields change at most a handful of times over a project's life.)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| False-positive "deleted" prompt (API hiccup) | 10003-only classification + 90-min grace + prompt-only (operator is sole destructive trigger) |
| Purge deletes through a symlink into a real repo | lstat-first: symlink → unlink only; AC8 test locks it |
| Purge escapes `projects/` via tampered layout | realpath containment check; AC9 test locks it |
| Sweep save clobbers concurrent config mutation | read-fresh-before-write per save, entry-absent ⇒ skip (pattern from `runAutoDisableSweep`) |
| Prompt spam while operator ignores it | `lastMissingAlertAt` 7-day re-nag gate |

## Grounding sources

- `.specclaw/context.md` — injectable side effects ("spawn functions (`hermesSpawnFn`), clocks (`now`), and mutators are constructor-injected so tests never launch real processes") → NFR2/probe injection; runtime-state placement rule quoted in Decision 5; test convention ("tests are plain `bun src/<name>.test.ts` scripts with PASS/FAIL check lines").
- `src/scheduler.ts:853-930` (`registerAutoDisableSweep`/`runAutoDisableSweep`) — sweep registration shape, hourly default, read-fresh-before-write, master-skip, per-project opt-out precedent.
- `src/master-commands.ts:1168-1211` (`handleRm`) — existing archive flow the purge branch forks from; access-group cleanup that must be preserved.
- `server.ts:1671-1683` — auto-disable wiring with `routeNotification` master alert, the exact template for the prompt wiring.
- `CLAUDE.md` ("State files layout") — "`<slug>`/ per-project cwd (**may be a symlink → real repo**)" → the symlink purge guard exists because symlinked layouts are documented-supported.
