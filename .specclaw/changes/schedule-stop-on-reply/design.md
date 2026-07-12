# Design: Schedule Auto-Pause on Reply Pattern (stopOnReply)

**Change:** schedule-stop-on-reply
**Created:** 2026-07-12

## Technical Approach

Three small layers, mirroring the P302 idle-gate shape:

1. **Schema** — `stopOnReply: z.string().optional()` with a `.refine`-style compile check (`new RegExp(v, 'i')` in try/catch inside `superRefine` or a standalone refinement on the field).
2. **Scheduler** — new public `noteReply(chatId, text)` + optional `SchedulerDeps.onAutoPause`. The scheduler does NOT subscribe to anything itself (it has no pool reference by design); callers push replies in.
3. **Wiring** — `server.ts` pool `onReply` handler (line ~1306) gains one line before platform dispatch: `if (reply.kind === 'text') scheduler?.noteReply(reply.chatId, reply.text)`. `onAutoPause` posts the master-channel notice using the same mechanism other server notices use (master chatId from `loadChannelsConfig().master?.chatId`, `client.channels.fetch` + `send` — reuse an existing helper if present).

## Architecture

```
claude → mcp__mcd__reply → MasterMcpServer.onReply → pool.acceptReply
                                                          │ (proc.onReply fan-out)
                                                          ▼
server.ts pool onReply(reply) ── reply.kind === 'text' ──▶ scheduler.noteReply(chatId, text)
        │                                                        │
        ▼ platform dispatch (discord/teams/whatsapp)             ▼
                                              for s in schedules where
                                                s.chatId === chatId && s.enabled
                                                && s.stopOnReply && s.lastRunAt != null:
                                                  new RegExp(s.stopOnReply, 'i').test(text)?
                                                    → s.enabled = false; saveSchedules()
                                                    → deps.onAutoPause?.(s, pattern)
                                                       └▶ server.ts: post "⏸ schedule <id> (<slug>)
                                                          auto-paused — reply matched /<pattern>/"
                                                          to master channel
```

`noteReply` loads `schedules.json` fresh on each call (same as `tick()`), scans for candidates, and returns immediately when none target the chatId — the reply hot path pays one file read only when schedules exist at all. Acceptable: replies are human-scale (a few per minute across the fleet), schedules.json is tiny.

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/schedules-config.ts` | modify | `stopOnReply` field + compile-check refinement |
| `src/scheduler.ts` | modify | `noteReply()`, `SchedulerDeps.onAutoPause?`, diag logs |
| `server.ts` | modify | tap in pool `onReply`, `onAutoPause` → master-channel notice |
| `src/master-commands.ts` | modify | `--stop-on-reply` on `scheduleAdd` (regex validation), `⏹ stop-on-reply /p/` in `scheduleList`, help text |
| `src/scheduler.test.ts` | modify | `noteReply` matrix (AC2–AC5) |
| `src/master-commands.test.ts` | modify | flag persist/reject + list display (AC6) |

## Data Model Changes

```ts
/**
 * Optional auto-pause pattern. After a fire, if the project's outbound
 * reply matches this regex (case-insensitive), the scheduler disables
 * the schedule deterministically — no more post-completion fires.
 */
stopOnReply: z.string().optional(),
```

Schema-level validation: pattern must compile (`new RegExp(p, 'i')`); reject with message `` `stopOnReply` must be a valid regex ``.

## API Changes

- `Scheduler.noteReply(chatId: string, text: string): void` — public, safe to call for every outbound text reply.
- `SchedulerDeps.onAutoPause?: (schedule: Schedule, pattern: string) => void` — optional notice hook.
- `!project schedule add ... [--stop-on-reply "<regex>"]`.
- `schedule list` row suffix: `⏹ stop-on-reply /<pattern>/`.

## Key Decisions

1. **Push-based tap, not scheduler-side subscription** — Scheduler stays pool-agnostic (same DI philosophy as `isBusy` from P302); server.ts owns the glue.
2. **Any-reply-after-any-fire window** (resolves open question) — no timers, no per-fire state. A schedule that fired once is armed until paused. Simplest semantics; the pattern is distinctive by contract ("backlog complete").
3. **Persist immediately per match** — one `saveSchedules` per pause event (rare), reusing atomic write.
4. **Regex compiled per candidate schedule per reply** — candidate count is ~0–2 per chat; compilation cost is irrelevant at human reply rates. No cache.
5. **Invalid pattern at runtime skips, never throws** (FR8) — reply dispatch must never break because of a bad hand-edited pattern.

## Risks & Mitigations

- **Overly-broad pattern pauses a healthy loop** — operator-authored, opt-in; the master-channel notice makes the pause visible immediately; `schedule resume <id>` undoes it.
- **Reply tap ordering: scheduler may be null during startup** — guard with `scheduler?.`; a reply lost to the tap during boot is harmless (next reply matches).
- **Teams/WhatsApp replies** — tap placed before platform branch so all platforms feed the matcher.
