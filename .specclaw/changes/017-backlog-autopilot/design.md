# Design: Backlog autopilot

**Change:** backlog-autopilot
**Created:** 2026-07-18

## Technical Approach

New pure-logic module `src/backlog.ts` (source detection, snapshot parsing, prompt builders, state-machine transition function) driven by a `registerAutopilotSweep()` method on the existing `Scheduler` class, following the exact shape of `registerBehaviourMirrorSweep()` (own unref'd timer, deps injected from `server.ts`, reads `channels.json` per tick so config changes need no restart). Runtime state lives on the project's `autopilot` config object in `channels.json`, the same pattern as `lastInjectedAt`. Injections are synthetic envelopes through `pool.deliver()` — the code path every scheduled and Discord message already takes.

State machine (persisted in `autopilot.state`):

```
(off) --set on--> seeding --backlog found--> running --all done--> complete
         |            |                        |  ^                    |
         |            +--2 intervals empty --> (escalate + disable)   |
         |            (source already exists → skip straight to running)
         |                                     |  |
         |                    stallThreshold zero-delta fires          |
         |                                     v  |                    |
         +--set off--> (state cleared)      halted +--new items found--+
                                               (re-arm only via set on)   (complete → running auto re-arm)
```

## Architecture

- **`src/backlog.ts` (new, pure — no timers, no Discord):**
  - `detectBacklogSource(projectCwd, file): 'specclaw' | 'file' | 'none'` — `.specclaw/STATUS.md` presence wins over the backlog file.
  - `snapshotBacklog(projectCwd, source, file): { done: number; total: number }` — file flavor: `- [x]` / `- [ ]` line count; specclaw flavor: per-change `tasks.md` checkbox counts for active changes + pending proposals (a pending proposal counts as one open item).
  - `buildSeedPrompt(slug, goal?)` / `buildNudgePrompt(source, snap)` — nudges append the existing reply-required footer text.
  - `nextAutopilotAction(entry, snap, nowIso): Action` — pure transition: `{ kind: 'seed' | 'nudge' | 'verify-failed' | 'stall' | 'complete' | 'rearm' | 'none', patch: Partial<AutopilotRuntime> }`. All decisions (interval elapsed, seed window expiry, zero-delta counting, window check via injected `now`) computed here so unit tests need no timers.
  - `withinWindow(window: string, now: Date): boolean` — `HH:MM-HH:MM`, wrap-around supported.
- **`src/scheduler.ts`:** `registerAutopilotSweep(opts)` — 60s timer; per enabled project: skip if `isBusy` (grace = 5 min), consult `checkHalt` (halted → suspend + `onEscalate`, mirrors schedule path), call `nextAutopilotAction`, execute side effects (deliver envelope / notify), persist patch via `saveChannels`. Logs `[autopilot] <slug>: <action>` and appends to `scheduler-history.jsonl`.
- **`src/channels-config.ts`:** `AutopilotSchema` on project + `defaults.autopilot` (limits-only, like `defaults.botPeers`).
- **`src/master-commands.ts`:** `handleSet` gains `--autopilot on|off`, `--seed`, `--autopilot-interval`, `--backlog-file`; new `backlog` verb (read-only status); help lines.
- **`server.ts`:** wire `scheduler.registerAutopilotSweep({...})` next to the behaviour-mirror registration; notification callbacks reuse `routeNotification` with master + project channel targets.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/backlog.ts` | create | Pure logic: detection, snapshot, prompts, `nextAutopilotAction`, `withinWindow` |
| `src/backlog.test.ts` | create | Fixtures for both flavors; transition table tests; window tests |
| `src/channels-config.ts` | modify | `AutopilotSchema` (project) + `defaults.autopilot` |
| `src/scheduler.ts` | modify | `registerAutopilotSweep()` + private `runAutopilotSweep()` |
| `src/master-commands.ts` | modify | `set` flags, `backlog` verb, help text |
| `src/master-commands.test.ts` | modify | Flag round-trips, refusals, `backlog` verb rendering |
| `server.ts` | modify | Sweep registration + notification wiring |
| `CLAUDE.md` / `README.md` / `ARCHITECTURE.md` | modify | Verb + config documentation |

## Data Model Changes

`channels.json` project entry gains:

```jsonc
"autopilot": {
  "enabled": true,
  "file": "BACKLOG.md",            // optional, default BACKLOG.md
  "intervalMinutes": 30,            // optional
  "stallThreshold": 3,              // optional
  "respectHeartbeatWindow": true,   // optional
  // runtime (MCD-maintained)
  "state": "running",
  "seededAt": "2026-07-18T12:00:00Z",
  "lastFireAt": "2026-07-18T12:30:00Z",
  "zeroDeltaCount": 0,
  "lastSnapshot": { "done": 3, "total": 9 }
}
```

`defaults.autopilot`: `{ intervalMinutes?, stallThreshold? }`. No schedules.json changes.

## API Changes

- `!project set <target> --autopilot on|off [--seed "<goal>"] [--autopilot-interval N] [--backlog-file <path>]`
- `!project backlog <target>` — status only
- New MCP tools: none (autopilot is operator-facing; project Claude just receives envelopes)

## Key Decisions

1. **Sweep, not schedules.json entry** — schedule schema is snowflake-bound and static-prompt; the state machine needs dynamic prompts and verification steps. Precedent: behaviour-mirror sweep.
2. **Runtime state in channels.json** — matches `lastInjectedAt`; avoids a new state file; atomic save already exists. Accepted cost: config file carries mutable fields (already true today).
3. **Pure transition function** — all timing/counting decisions in `nextAutopilotAction(entry, snap, nowIso)` so tests inject clock and fixtures, no timers.
4. **Seed exempt from window; nudges respect it** — seeding is operator-initiated (they just ran the command); unattended nudges sleep outside `heartbeat.window`.
5. **Specclaw wins over BACKLOG.md** — per operator default; explicit `--backlog-file` does NOT override specclaw detection (documented), keeping one source of truth per project.
6. **Halted requires manual re-arm (`set --autopilot on`); complete re-arms automatically** — a stall is a fault needing attention; completion is a normal resting state.

## Risks & Mitigations

- **Token burn on a confused agent** (nudges keep firing while the agent spins): idle gate skips in-flight turns; stall halt caps consecutive no-progress fires at 3; specclaw halt probe suspends on red verify; every halt escalates to master.
- **False "complete" from parse gaps** (e.g. items written in a non-checkbox format): status verb exposes the parsed X/Y so the operator can see miscounts; seed prompt explicitly instructs checkbox format.
- **channels.json write races** (sweep patch vs concurrent `set`): all writes go through the existing atomic load-modify-save helpers; sweep re-loads config at patch time and patches only the `autopilot` subtree of the target project.
- **Double-fire after restart:** `lastFireAt` persisted; interval check is `now - lastFireAt >= interval`, same contract that protects scheduler `lastRunAt`.
- **Master channel autopilot** — refused at the command layer (validation), sweep also skips `master.chatId` defensively.
