# Design: Mission Control Dashboard Fixes

**Change:** mission-control-dashboard-fixes  
**Created:** 2026-05-27

---

## Architecture

All changes are confined to `apps/mission-control/`. No changes to `server.ts`, emitter, or DB schema.

### T1 — Instance enrichment

**Approach:** Extend `getInstances()` DB query to include per-instance activity derived from recent `events` rows.

Add `getInstanceActivity(instance_id: string): { activeSlugs: string[]; lastActivity: string | null }` to `src/db.ts`:
```sql
SELECT DISTINCT json_extract(payload, '$.slug') AS slug, type, created_at
FROM events
WHERE instance_id = ?
  AND created_at > unixepoch() - 300
  AND json_extract(payload, '$.slug') IS NOT NULL
ORDER BY created_at DESC
LIMIT 50
```

`/api/instances/route.ts` calls `getInstanceActivity` for each instance row and merges.

`InstanceGrid` renders `activeSlugs` as small chips below host name. `lastActivity` replaces the `{status}` label when set (fallback to status).

### T2 — Specclaw API

**New file:** `app/api/specclaw/route.ts`

```
GET /api/specclaw
→ reads process.env.MCD_CHANNELS_DIR
→ glob: MCD_CHANNELS_DIR/projects/*/.specclaw/STATUS.md
→ parse each file: extract active changes (lines with 🔨 emoji or non-✅ prefix)
→ return array of { slug, changes[] }
```

**STATUS.md parsing logic:**
- Line format: `- {emoji} **{name}** — {n}/{total} tasks ({pct}%) | {k} failed`
- Emoji map: `🔨` = build, `✅` = completed, `📋` = plan, `📝` = propose, `🔍` = verify, `🔀` = pr
- Skip ✅ lines (completed)
- Detect phase from emoji or name-match fallback

`SpecclawPipeline` gets a new `useEffect` polling `/api/specclaw` every 30s. Falls back to old event-stream behavior if response is empty.

### T3 — Scheduler API

**New file:** `app/api/schedules/route.ts`

```
GET /api/schedules
→ reads MCD_CHANNELS_DIR + /schedules.json
→ reads MCD_CHANNELS_DIR + /channels.json (for chatId→slug map)
→ returns enriched schedule rows
```

`SchedulerTable` refactored: primary data source is `/api/schedules` poll (mount + 60s interval). Event-stream `scheduler_fired` events still update `lastRunAt` in real time. The `useCountdowns` hook is reused as-is.

### T4 — SSE keepalive

**`app/api/events/stream/route.ts`:**
```ts
start(c) {
  controller = c
  addClient(controller)
  const hb = setInterval(() => {
    try { c.enqueue(': keepalive\n\n') } catch { clearInterval(hb) }
  }, 15_000)
},
cancel() {
  removeClient(controller)
  clearInterval(hbRef)
}
```

**`components/EventFeed.tsx`:**
- Add `connStatus: 'connected' | 'reconnecting'` state
- `es.onopen` → `setConnStatus('connected')`
- `es.onerror` → `setConnStatus('reconnecting')` + `es.close()` + `setTimeout(() => reconnect(), 3000)`
- Extract SSE setup into `connectSSE()` called on mount and on reconnect
- Add connection dot to controls row

---

## File Changes Map

| File | Change |
|------|--------|
| `apps/mission-control/src/db.ts` | Add `getInstanceActivity()` |
| `apps/mission-control/app/api/instances/route.ts` | Enrich response with activity |
| `apps/mission-control/app/api/specclaw/route.ts` | **NEW** — read STATUS.md files |
| `apps/mission-control/app/api/schedules/route.ts` | **NEW** — read schedules.json |
| `apps/mission-control/app/api/events/stream/route.ts` | Add keepalive interval |
| `apps/mission-control/components/InstanceGrid.tsx` | Render slugChips + lastActivity |
| `apps/mission-control/components/SpecclawPipeline.tsx` | Poll /api/specclaw |
| `apps/mission-control/components/SchedulerTable.tsx` | Poll /api/schedules |
| `apps/mission-control/components/EventFeed.tsx` | Reconnect + conn status dot |

---

## Key Decisions

1. **No DB schema change.** Activity derived at query time from existing `events` table. Avoids migration.
2. **MCD_CHANNELS_DIR optional.** Both new routes return `[]` if unset. Dashboard degrades gracefully.
3. **Sync file reads.** `fs.readFileSync` is fine — these are local filesystem reads, called at most once per poll interval (30–60s). No streaming needed.
4. **SchedulerTable keeps countdown logic.** Only the data-fetch mechanism changes; the `useCountdowns` hook is preserved.
5. **SSE keepalive uses comment syntax.** `': keepalive\n\n'` is ignored by SSE parsers but resets proxy idle timers.

---

## Risks

- R1: `json_extract` on SQLite payload column requires `payload` to be valid JSON — it always is (inserted via `JSON.stringify`). Low risk.
- R2: STATUS.md format could change with specclaw updates — parser is best-effort, won't crash.
- R3: SSE in Next.js dev mode may restart workers and lose clients set — mitigated by `globalThis` pattern already in `sse.ts`.
