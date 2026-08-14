# Design: Backlog stall watch

**Change:** backlog-stall-watch
**Created:** 2026-07-25

## Approach

Copy the proven autopilot-sweep architecture one layer down: pure decision logic in `src/backlog.ts`, a thin timer loop in `src/scheduler.ts`, wiring + Discord delivery in `server.ts`, persistence in `channels.json` runtime fields. No new files except tests ride existing ones.

### 1. Pure logic (`src/backlog.ts`)

```ts
export type BacklogWatchAction =
  | { kind: 'init' }
  | { kind: 'delta' }
  | { kind: 'alert'; openCount: number; staleDays: number }
  | { kind: 'none' }

export function evaluateBacklogWatch(opts: {
  snap: { done: number; total: number }
  runtime: { lastSnapshot?: { done: number; total: number }; lastDeltaAt?: string; lastAlertAt?: string }
  staleBacklogDays: number
  nowMs: number
}): { action: BacklogWatchAction; patch: Partial<runtime> }
```

Decision order: no `lastSnapshot`/`lastDeltaAt` ⇒ `init` (patch snapshot + lastDeltaAt). Snapshot differs ⇒ `delta` (patch snapshot + lastDeltaAt, clear lastAlertAt). Open items > 0 AND `nowMs - Date.parse(lastDeltaAt) >= days*86_400_000` AND alert window clear ⇒ `alert` (patch lastAlertAt). Else `none` (empty patch). Clamp `staleBacklogDays < 1` to 3 here (single choke point).

```ts
export function listOpenItems(projectCwd: string, source: BacklogSource, file?: string): string[]
```

`file`: read backlog file, return trimmed `- [ ] ...` lines' text. `specclaw`: reuse the same not-done classification `snapshotSpecclaw` uses (extract its per-change predicate into a small shared helper if needed) and return change names. Cap at 10, append `(+N more)`. Defensive: any fs error ⇒ `[]`.

### 2. Schema (`src/channels-config.ts`)

```ts
const BacklogWatchRuntimeSchema = z.object({
  enabled: z.boolean().optional(),
  staleBacklogDays: z.number().optional(),
  // Runtime — maintained by the sweep, not the operator
  lastSnapshot: z.object({ done: z.number(), total: z.number() }).optional(),
  lastDeltaAt: z.string().optional(),
  lastAlertAt: z.string().optional(),
}).strict()
```

`projects[*].backlogWatch: BacklogWatchRuntimeSchema.optional()`; `defaults.backlogWatch: z.object({ enabled, staleBacklogDays }).strict().optional()` (limits-only, mirroring `DefaultsAutopilotSchema`). Comment style copied from the autopilot schema block (`channels-config.ts:119-151`).

### 3. Sweep (`src/scheduler.ts`)

`registerBacklogWatchSweep(opts)` + `runBacklogWatchSweep(opts)` (public for tests), placed after the autopilot pair (`scheduler.ts:525+`), same structure: dynamic `import('./backlog.ts')`, iterate `config.projects`, per-project:

```
skip if chatId === config.master?.chatId
skip if project.autopilot?.enabled
resolve enabled  = project.backlogWatch?.enabled ?? defaults.backlogWatch?.enabled ?? true; skip if false
resolve staleDays = project.backlogWatch?.staleBacklogDays ?? defaults.backlogWatch?.staleBacklogDays ?? 3
source = detectBacklogSource(projectDirFor(slug), autopilotFile?) — plain BACKLOG.md/specclaw detection, no autopilot coupling
skip if source === 'none'
snap = snapshotBacklog(...)
{action, patch} = evaluateBacklogWatch(...)
if patch non-empty: reload-merge-save channels (same pattern runAutopilotSweep uses)
if action.kind === 'alert': opts.onAlert(slug, chatId, { snap, staleDays, openItems: listOpenItems(...) })
```

Default `sweepIntervalMs: 3_600_000` (hourly — days-scale detection needs no finer cadence). Injectable for tests.

### 4. Wiring (`server.ts`)

Next to `scheduler.registerAutopilotSweep(...)` (`server.ts:1586`):

```ts
scheduler.registerBacklogWatchSweep({
  getChannels: loadChannelsConfig, saveChannels, projectDirFor,
  onAlert: (slug, _chatId, info) => {
    const cfg = loadChannelsConfig(); const masterChatId = cfg.master?.chatId; if (!masterChatId) return
    const items = info.openItems.map(i => `• ${i}`).join('\n')
    routeNotification(cfg, { kind: 'text', chatId: masterChatId, text: `📋 **${slug}**: backlog stalled — ${info.snap.total - info.snap.done} open, no movement for ${info.staleDays}+ days\n${items}\n_Check the channel or merge pending PRs. Disable: \`backlogWatch.enabled: false\` on the project._` }, 'backlog-watch alert')
  },
  mcdDir: channelsDir,
})
```

## File changes

| File | Change |
|------|--------|
| `src/backlog.ts` | `evaluateBacklogWatch`, `listOpenItems`, `BacklogWatchAction` type |
| `src/channels-config.ts` | `backlogWatch` schemas on project + defaults |
| `src/scheduler.ts` | `registerBacklogWatchSweep` / `runBacklogWatchSweep` |
| `server.ts` | Sweep registration + master-channel alert wiring |
| `src/backlog.test.ts` | AC1 + AC2 checks |
| `src/scheduler.test.ts` | AC3 + AC4 checks |
| `CLAUDE.md`, `ARCHITECTURE.md`, `README.md` | Feature docs |

## Key decisions

1. **Hourly sweep, not 60s** — days-scale signal; hourly keeps `channels.json` write churn negligible.
2. **Skip whenever `autopilot.enabled`** (not just non-idle states) — one owner per project for stall signaling; simpler predicate, no state-machine coupling.
3. **`init` sets the clock at first observation** — no fabricated history; a pre-existing 10-day stall alerts after `staleBacklogDays` of observed stagnation. Documented in spec edge cases.
4. **Alert latch clears on delta** — a backlog that moves then re-stalls re-alerts after a fresh full window.
5. **No `!project set` flag in this change** — config is hand-editable JSON; a set-flag is a one-liner follow-up if wanted (YAGNI now).

## Risks

- `channels.json` concurrent writes: reuse the reload-merge-save pattern `runAutopilotSweep` already uses (accepted same-class risk).
- Alert noise on many stale projects: one line + item list per project per window (3 days) — bounded.
- specclaw open-item naming may not match operator's mental model (change dirs vs backlog lines) — acceptable; digest names are hints, not canonical.

## Grounding sources

- `src/scheduler.ts:525-560` — `registerAutopilotSweep` options shape + sweep skeleton this mirrors.
- `src/backlog.ts:53-150` — `detectBacklogSource` / `snapshotBacklog` / `countCheckboxes` / `snapshotSpecclaw` reused as-is.
- `src/channels-config.ts:119-151, 363-367` — autopilot schema comment/style precedent for `backlogWatch`.
- `server.ts:1586-1626` — autopilot escalation wiring + `routeNotification` master-channel pattern.
- Incident: dstm-apps backlog item stale 10 days while channel active elsewhere (2026-07-25 investigation) — the exact blind spot this fills.
