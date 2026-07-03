# Tasks: Mission Control Dashboard Fixes

**Change:** mission-control-dashboard-fixes
**Created:** 2026-05-27
**Total Tasks:** 10

## Summary

Wave 1: Backend — DB helper, two new API routes, enriched instances endpoint, SSE keepalive. Wave 2: Frontend — update 4 components to consume new APIs + reconnect logic. Wave 3: Typecheck + commit.

## Tasks

### Wave 1 — Backend: DB + new API routes

- [x] `T1` — Add `getInstanceActivity` to db.ts
  - Files: `apps/mission-control/src/db.ts` (MODIFY)
  - Estimate: small
  - Depends: none
  - Notes: Add `export function getInstanceActivity(instanceId: string): { activeSlugs: string[]; lastActivity: string | null }`. Use SQLite `json_extract(payload, '$.slug')` on events table, filter `instance_id = ?` AND `created_at > unixepoch() - 300`. Return distinct non-null slugs and the `type` of the most-recent event.

- [x] `T2` — Enrich `/api/instances` response with activity data
  - Files: `apps/mission-control/app/api/instances/route.ts` (MODIFY)
  - Estimate: small
  - Depends: T1
  - Notes: Import `getInstanceActivity`. For each row from `getInstances()`, call `getInstanceActivity(row.instance_id)` and spread `activeSlugs` + `lastActivity` into the response object. Export `InstanceRow` extension type.

- [x] `T3` — Create `GET /api/specclaw` route
  - Files: `apps/mission-control/app/api/specclaw/route.ts` (CREATE)
  - Estimate: small
  - Depends: none
  - Notes: Read `process.env.MCD_CHANNELS_DIR`. If unset return `Response.json([])`. Use `fs.readdirSync` to list `projects/` subdirs, read each `<slug>/.specclaw/STATUS.md` if it exists. Parse lines matching `/^- (✅|🔨|📋|📝|🔍|🔀) \*\*(.+?)\*\* — (\d+)\/(\d+)/`. Skip ✅ lines. Detect phase from emoji: 📝=propose, 📋=plan, 🔨=build, 🔍=verify, 🔀=pr. Return `Array<{ slug, changes: Array<{ name, phase, tasksDone, tasksTotal, status }> }>`. Wrap in try/catch per-project.

- [x] `T4` — Create `GET /api/schedules` route
  - Files: `apps/mission-control/app/api/schedules/route.ts` (CREATE)
  - Estimate: small
  - Depends: none
  - Notes: Read `process.env.MCD_CHANNELS_DIR`. If unset return `Response.json([])`. Read `schedules.json` (`{ version, schedules: [] }`). Read `channels.json` and build `chatId → slug` map from `projects` object. For each schedule entry, add `slug` field (fallback to `chatId` if not found). Return enriched array. Wrap in try/catch → `[]` on error.

- [x] `T5` — Add SSE keepalive to stream route
  - Files: `apps/mission-control/app/api/events/stream/route.ts` (MODIFY)
  - Estimate: small
  - Depends: none
  - Notes: Inside `start(c)` add `const hb = setInterval(() => { try { c.enqueue(': keepalive\n\n') } catch { clearInterval(hb) } }, 15_000)`. In `cancel()`, call `clearInterval(hb)`. Use closure to capture `hb`. Keep `addClient`/`removeClient` calls as-is.

### Wave 2 — Frontend: component updates

- [x] `T6` — Update `InstanceGrid` — slug chips + activity badge
  - Files: `apps/mission-control/components/InstanceGrid.tsx` (MODIFY)
  - Estimate: small
  - Depends: T1, T2
  - Notes: Update `InstanceEntry` interface to add `activeSlugs: string[]` and `lastActivity: string | null`. In the card render: below the host/status row, add a flex-wrap row of `activeSlugs.slice(0,3)` as small cyan pills (text-[10px] font-mono). If `activeSlugs.length > 3` add "+N" chip. Show `lastActivity` as a dim badge (slate-500) next to status badge when set (e.g. "doing reply").

- [x] `T7` — Update `SpecclawPipeline` — poll `/api/specclaw`
  - Files: `apps/mission-control/components/SpecclawPipeline.tsx` (MODIFY)
  - Estimate: small
  - Depends: T3
  - Notes: Add `useState` for `apiData: Array<{ slug: string; changes: ChangeRow[] }>` and `useEffect` to fetch `/api/specclaw` on mount and every 30s. If `apiData` has entries, render from `apiData` (flatten all projects' active changes into pipeline rows). Fall back to current event-stream logic only if `apiData` is empty. Update `PipelineRow` type and `detectPhase` to accept `phase` string from API directly.

- [x] `T8` — Update `SchedulerTable` — poll `/api/schedules`
  - Files: `apps/mission-control/components/SchedulerTable.tsx` (MODIFY)
  - Estimate: small
  - Depends: T4
  - Notes: Add `useState<ScheduleApiRow[]>` and `useEffect` to fetch `/api/schedules` on mount and every 60s. Render table from this data (show all rows, not just fired ones). `ScheduleApiRow` has `{ id, chatId, slug, at, prompt, enabled, lastRunAt, runCount, maxRuns }`. Use `at` as the job time for `useCountdowns`. Show `slug` in Instance column instead of `instance_id`. Show `enabled` as state (enabled/paused). Keep `useCountdowns` hook unchanged. Show empty state if fetch returns `[]`.

- [x] `T9` — Update `EventFeed` — reconnect + connection indicator
  - Files: `apps/mission-control/components/EventFeed.tsx` (MODIFY)
  - Estimate: small
  - Depends: none
  - Notes: Extract SSE connection logic into `function connectSSE()` (returns cleanup fn). Add `connStatus: 'connected' | 'reconnecting' | 'disconnected'` state. In `connectSSE`: `es.onopen = () => setConnStatus('connected')`. `es.onerror = () => { setConnStatus('reconnecting'); es.close(); setTimeout(connectSSE, 3000) }`. Call `connectSSE()` in `useEffect` on mount. In controls row add a 6px dot (green=connected, amber=reconnecting, red=disconnected) and show "reconnecting…" text when amber.

### Wave 3 — Integration + commit

- [x] `T10` — Typecheck and commit
  - Files: `apps/mission-control/` (CHECK)
  - Estimate: small
  - Depends: T6, T7, T8, T9
  - Notes: Run `cd apps/mission-control && bun tsc --noEmit`. Fix any type errors found. Then stage all changed files and commit: `fix(mc): instance activity, specclaw/scheduler direct read, SSE keepalive`.
