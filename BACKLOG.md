# Mission Control Dashboard — Backlog

Standalone, independently-shippable proposals for the Mission Control UI at `apps/mission-control/`.

---

## P1 — Fleet Health Bar

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The current dashboard header shows instance count and uptime but has no per-state breakdown of the Claude fleet. Operators cannot immediately see how many channels are idle, actively working, or stalled without drilling into the Instance Grid.

### Proposed Solution

Extend the fixed HUD header with project-state counters sourced from the MCD server. Add a `/api/fleet` endpoint in the mission control app that reads `channels.json` and cross-references each project's transcript recency to classify state as `idle | active | stalled | autonomous`. Display four neon badges in the header: Idle (cyan), Active (green), Stalled (red pulsing), Autonomous (purple). Clicking any badge filters the Instance Grid to matching projects.

### Acceptance Criteria

- AC1: Idle / Active / Stalled / Autonomous counts shown in header; update every 30s
- AC2: Stalled count badge pulses when > 0
- AC3: Clicking a state badge adds a filter query param; Instance Grid reacts
- AC4: Fleet endpoint reads `channels.json` from `MCD_CHANNELS_DIR`; no server restart needed on project changes
- AC5: Header remains one line on ≥ 1280px viewport

---

## P2 — Project Graph View

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The Instance Grid shows projects as a flat list with no visual indication of relationships. Operators cannot see coordination links (which channels have been injected into) or cluster projects by state at a glance.

### Proposed Solution

Add a `/graph` page with a force-directed D3 node graph. Each project is a neon node; color encodes state (cyan=idle, amber=active, red=stalled, purple=autonomous); size encodes recent message volume. Edges connect projects that have sent inject events to each other. Node hover shows slug, model, last-active, CLAUDE.md excerpt. Graph layout persists to localStorage.

### Acceptance Criteria

- AC1: All projects in `channels.json` appear as nodes within 1s of page load
- AC2: Node state colors update on ≤ 5s poll
- AC3: Stalled nodes pulse via CSS animation
- AC4: Clicking a node opens a detail drawer: slug, config, transcript snippet
- AC5: Inject edges rendered as directed arrows; absent when no injects recorded
- AC6: Empty graph (no projects) shows placeholder, no crash

---

## P3 — Stall Alert Panel

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Stalled channels are currently invisible in the dashboard. Operators discover stalls only via the heartbeat bot message or by manually checking each channel. There is no at-a-glance triage surface.

### Proposed Solution

Add a `StallAlertPanel` component shown as a collapsible panel (or dedicated tab) in the dashboard. A `/api/stalls` endpoint classifies each project's transcript using the existing `classifyChannel` logic from `src/heartbeat.ts`. The panel shows: slug, stall reason, stall age, last transcript snippet. Each row has an "Inject" button opening a pre-filled dialog.

### Acceptance Criteria

- AC1: Panel auto-refreshes every 30s; badge count shown in Fleet Health Bar
- AC2: Stall reason and snippet sourced from `classifyChannel`
- AC3: Inject dialog pre-populates a suggested continuation prompt by stall type; operator can edit
- AC4: After inject, row removed optimistically; reappears on next refresh if still stalled
- AC5: Empty state ("No stalled channels ✓") shown with green glow
- AC6: Rows older than project's `stuckThresholdMinutes` highlighted red

---

## P4 — Live Activity Feed (enhancement)

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The existing EventFeed shows raw MCD events but filters nothing: it renders every event type with no visual hierarchy. High-signal events (commits, PRs, injects, stalls) are buried under routine heartbeats and MCP calls. There is no way to pause or filter.

### Proposed Solution

Enhance the existing `EventFeed` component with: (1) event-type filter chips (commit / PR / inject / stall / tool / all); (2) pause-on-hover; (3) color-coded event rows by category; (4) linkable events that highlight the source project node in the Graph View.

### Acceptance Criteria

- AC1: Filter chips visible above feed; default = all; state persists in localStorage
- AC2: Pause-on-hover freezes scroll; resume on mouse-leave; "PAUSED" badge shown
- AC3: Commit and PR events rendered with repo icon and truncated commit message
- AC4: Stall events rendered in red; inject events in purple
- AC5: Clicking an event highlights the corresponding project in Instance Grid (query param)
- AC6: Max 500 events retained in DOM; older events pruned

---

## P5 — Proposal / Backlog Overlay

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

There is no way to see each project's pending workload (specclaw proposals, BACKLOG.md items) alongside its runtime status. Operators cannot prioritise which channel needs attention based on queue depth.

### Proposed Solution

Add a "Backlog" toggle to the Project Graph View. When enabled, each project node gains a glowing halo ring; ring brightness scales with pending proposal count (read from each project's `.specclaw/STATUS.md` and `BACKLOG.md`). Clicking the halo opens a side drawer listing proposals with title, status badge, and link to the spec file. A `/api/backlog` endpoint scans all project working directories.

### Acceptance Criteria

- AC1: Halo renders as a neon ring; dim = 1 item, bright/pulsing = 5+
- AC2: Projects with no proposals show no halo
- AC3: Drawer lists each proposal: title, status badge, created date
- AC4: Overlay toggleable with keyboard shortcut `B` without leaving graph view
- AC5: Backlog endpoint scans all project dirs listed in `channels.json`
- AC6: Updates within 30s of a `.specclaw/STATUS.md` change

---

## P6 — Memory Constellation

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The memory integration (PR #47) stores cross-channel memories in `memory.db` but the dashboard has no way to view, search, or manage memories. Operators cannot see what master Claude has learned or verify memory quality without running CLI commands.

### Proposed Solution

Add a `MemoryPanel` component and `/api/memories` endpoint to the mission control dashboard. The panel renders memories as a filterable grid grouped by type (decision / pattern / coordination / channel_summary / general). Each memory card shows: type badge, channel slug, content preview, access count, recency. Includes a search input, type filter, and per-card "Forget" button.

### Acceptance Criteria

- AC1: All records from `memory.db` shown on load; refresh every 60s
- AC2: Filter by type and channel slug via dropdowns
- AC3: Search input filters by content substring
- AC4: Each card shows: id (truncated), type, slug, content (first 200 chars), access_count, last_accessed_at
- AC5: "Forget" button deletes record via DELETE `/api/memories/[id]`; card removed optimistically
- AC6: Empty state shown when no memories

---

## P7 — Schedule Timeline

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The existing `SchedulerTable` shows schedules as a flat table with no temporal context. Operators cannot see when the next job will fire, which jobs are overdue, or how jobs cluster across the day.

### Proposed Solution

Replace or complement `SchedulerTable` with a horizontal swimlane timeline showing a 24h window. One row per project with scheduled jobs. Interval jobs show last-run marker and live countdown to next run. Daily HH:MM jobs show today's run slot. Paused schedules shown dimmed. Clicking a job block shows full config and a "Copy inject command" action.

### Acceptance Criteria

- AC1: All entries from `schedules.json` rendered; 24h window centered on now
- AC2: Next-run countdown ticks live (no refresh)
- AC3: Paused schedules shown with strikethrough/dim styling
- AC4: Timeline scrollable horizontally; slug labels fixed on left
- AC5: "Copy inject command" available per job
- AC6: Jobs fired within last hour show "last ran X min ago" trailing marker

---

## P8 — WhatsApp Fleet Status

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The dashboard has no visibility into WhatsApp adapter state. When `WHATSAPP_ENABLED` is set (PR #48), operators cannot see connection status, active WhatsApp-platform projects, or QR code events from the dashboard.

### Proposed Solution

Add a `WhatsAppStatus` badge to the Fleet Health Bar. When WhatsApp is enabled, show: connection status (connected / disconnected / pairing), active WhatsApp project count, and last message timestamp. The badge links to a filtered Instance Grid showing only `platform: whatsapp` projects. QR code events from `src/whatsapp-adapter.ts` surfaced as a banner in the Activity Feed.

### Acceptance Criteria

- AC1: WhatsApp badge visible in header when `WHATSAPP_ENABLED=1` or `whatsapp-auth/` exists
- AC2: Badge shows: connected (green) / disconnected (red) / pairing (amber pulsing)
- AC3: Active WhatsApp project count shown; clicking filters Instance Grid
- AC4: QR code event rendered as a special banner in Event Feed with "scan within 60s" timer
- AC5: Badge hidden when WhatsApp not configured (no padding/space taken)

---

## P9 — Memory-Aware Heartbeat Prompt

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The heartbeat schedule prompt does not currently instruct master Claude to use the memory tools before or after scanning. Channel summaries are not being persisted automatically, so the memory store remains empty even after memory integration shipped (PR #47).

### Proposed Solution

Update the recommended heartbeat schedule prompt template in `templates/master.CLAUDE.md` to include: (1) recall prior `channel_summary` memories before scanning; (2) save updated summaries after the scan; (3) save `coordination` memory after any inject. Update the example `schedule add` command in the template. Optionally add a default schedule to `bin/setup-new-instance.sh`.

### Acceptance Criteria

- AC1: `templates/master.CLAUDE.md` heartbeat schedule example includes `mcp__mcd__recall` before scan and `mcp__mcd__remember` after
- AC2: Injected prompt from the example includes saving `coordination` memory post-inject
- AC3: `bin/setup-new-instance.sh` optionally bootstraps a heartbeat schedule with the updated prompt
- AC4: Existing scheduled jobs are not modified by this change (template only)

---

## P10 — Cross-Channel Timeline

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators have no way to see how activity across all channels correlates over time. Events in the feed are ordered by arrival with no temporal axis, making it impossible to see whether a spike in one channel triggered stalls in others.

### Proposed Solution

Add a `/timeline` page with a horizontal multi-channel timeline. One swimlane per project. Events (spawns, replies, injects, stalls, specclaw completions) rendered as colored tick marks on a 24h or 6h scrollable axis. Axis is live — the right edge is "now" and scrolls automatically. Hovering a tick shows event details. Clicking jumps to that project's node in the Graph View.

### Acceptance Criteria

- AC1: All projects shown as swimlanes; events from `/api/events` rendered as ticks within 2s of page load
- AC2: Time axis spans last 6h by default; 24h toggle available
- AC3: Right edge tracks "now" with a live cursor line; auto-scrolls
- AC4: Event types use the same color scheme as EventFeed
- AC5: Hovering a tick shows: type, timestamp, payload excerpt
- AC6: Empty swimlane (no events for project) shown as a dim line, not hidden

---

## P11 — Agent Diff Viewer

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators cannot see what code changes a project agent has made between heartbeat cycles without SSHing into the server or opening the project channel. There is no quick way to review recent git diffs from the dashboard.

### Proposed Solution

Add a `/api/diff/[slug]` endpoint that runs `git diff HEAD~5..HEAD --stat` and `git log --oneline -10` on the project working directory. Add a "Diff" tab to the Project Graph detail drawer. Syntax-highlight the diff output (added/removed lines in green/red). Include commit log above the diff. Auto-refresh on drawer open.

### Acceptance Criteria

- AC1: Diff tab appears in graph node detail drawer
- AC2: Shows last 10 commits as a log above the diff
- AC3: Added lines highlighted green; removed lines highlighted red; context lines dim
- AC4: `/api/diff/[slug]` returns `{ log: string; diff: string; slug: string }`
- AC5: Empty diff ("nothing changed") shown with neutral message
- AC6: Diff truncated at 500 lines with a count of omitted lines

---

## P12 — Live Transcript Tail

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators must open the tmux pane or the project's Discord channel to read what an agent is currently thinking or doing. The dashboard has no way to show a live or recent view of a project's transcript.

### Proposed Solution

Add a `/api/transcript/[slug]` endpoint that reads the latest `.jsonl` transcript file and returns the last N assistant/tool entries. Add a "Transcript" panel that can be pinned below the Instance Grid: shows last 20 assistant text blocks and tool calls in a neon-framed terminal-style box, auto-scrolling on new data. Polls every 5s when visible.

### Acceptance Criteria

- AC1: Transcript panel toggleable from the Instance Grid header
- AC2: Shows last 20 entries (assistant text + tool name + result snippet)
- AC3: Auto-scrolls to bottom on new entries; pauses if operator scrolls up
- AC4: Endpoint reads the most-recently-modified `.jsonl` in the project's transcript dir
- AC5: Tool calls shown with tool name badge (color-coded by category)
- AC6: Empty or missing transcript shown with "No transcript yet" placeholder

---

## P13 — Memory Graph

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The Memory Panel shows memories as a flat list but gives no sense of how memories relate to each other or which channels contribute most. There is no way to see memory density or patterns at a glance.

### Proposed Solution

Add a `/memory-graph` page. Force-directed graph where each node is a memory (colored by type). Edges connect memories that share the same `channel_slug`. Node size scales with `access_count`. Cluster by type using D3 force grouping. Clicking a memory node shows full content. Includes a type filter strip identical to the Memory Panel. Graph re-renders on 60s poll.

### Acceptance Criteria

- AC1: All memories from `memory.db` appear as nodes within 2s
- AC2: Node color matches memory type (reuse Memory Panel palette)
- AC3: Node size scales with access_count (min r=6, max r=20)
- AC4: Edges connect same-channel memories; edge opacity scales with shared access count
- AC5: Clicking a node opens a detail card with full content, type, slug, timestamps
- AC6: Type filter chips hide/show nodes without rebuilding simulation

---

## P14 — Command Palette

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Navigating the dashboard requires clicking through multiple sections. Operators who know what they want (view a project, jump to a transcript, filter by state) must use the mouse. There is no keyboard-first navigation.

### Proposed Solution

Add a command palette (⌘K / Ctrl+K) that opens a searchable modal with instant results. Commands include: navigate to `/graph`, `/timeline`, `/memory-graph`; filter InstanceGrid by project slug; open a project's transcript panel; copy inject command for a slug. Results are fuzzy-matched against project slugs and command names. Recent commands shown when search is empty.

### Acceptance Criteria

- AC1: Palette opens on Ctrl+K (or Cmd+K on Mac) from anywhere in the dashboard
- AC2: Typing filters commands and project slugs with fuzzy match; results update in <50ms
- AC3: Arrow keys navigate results; Enter executes; Escape closes
- AC4: Project-slug results show state badge (color) and age
- AC5: Recent commands (last 5) shown at top when input is empty
- AC6: Palette closes on backdrop click or Escape

---

## P15 — Agent Performance Metrics

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators have no visibility into per-agent token usage, turn latency, or cost trends. Expensive or slow agents are invisible until they cause problems. There is no way to compare cost-per-turn across projects or spot regressions after model changes.

### Proposed Solution

Add a `/metrics` page with a per-project performance dashboard. A `/api/metrics/[slug]` endpoint scans the project's `.jsonl` transcript files and extracts `usage` blocks to compute: total input/output tokens, cost estimate (at current model pricing), avg turn latency, p95 turn latency, and turns per day. Render as neon sparklines (7-day trend) plus a summary table. Global view aggregates across all projects.

### Acceptance Criteria

- AC1: `/metrics` page lists all projects with token totals, cost estimate, avg latency
- AC2: Clicking a project expands a sparkline panel showing 7-day token and latency trends
- AC3: Cost estimate uses hardcoded per-model rates (Sonnet/Haiku/Opus) from CLAUDE.md
- AC4: `/api/metrics/[slug]` reads `.jsonl` files; returns `{ slug, totalTokens, estimatedCostUsd, avgLatencyMs, p95LatencyMs, turnsPerDay }`
- AC5: Global aggregation row shown at top of table
- AC6: Data cached for 60s; stale indicator shown while refreshing

---

## P16 — Specclaw Pipeline Kanban

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators have no cross-project view of specclaw pipeline progress. Changes in `propose → plan → build → verify → pr` state are invisible except per-project. It is impossible to see which projects are blocked at which stage without SSHing in.

### Proposed Solution

Add a `/pipeline` page with a kanban board. Five columns: Propose, Plan, Build, Verify, PR. A `/api/pipeline` endpoint scans all project `.specclaw/changes/` directories, reads each `proposal.md`/`spec.md`/`tasks.md`/`verify-report.md` to classify stage, and returns cards. Each card shows: change name, project slug, days in current stage, last-modified timestamp. Drag-and-drop is read-only (display only); clicking a card opens a detail drawer with the full spec.

### Acceptance Criteria

- AC1: All active specclaw changes across all projects appear as kanban cards within 2s
- AC2: Stage inferred from files present: proposal only → Propose; +spec.md → Plan; +tasks.md → Build; +verify-report.md → Verify; PR URL in verify-report → PR
- AC3: Cards show: change name, slug badge, days-in-stage, last-modified age
- AC4: Stalled cards (> 24h in Build or Verify) highlighted amber
- AC5: Detail drawer shows proposal.md content and, if present, tasks.md checklist with done/pending counts
- AC6: Refresh every 60s; manual refresh button in page header

---

## P17 — Inject Terminal

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Injecting messages into a project channel requires either typing `!project inject` in the master Discord channel or switching to the project's Discord channel. There is no dashboard-native way to inject a prompt or check-in message.

### Proposed Solution

Add an "Inject" panel accessible from the Command Palette and the Instance Grid row action menu. The panel is a neon-styled terminal input: project slug selector (auto-filled from context), a multiline textarea, and a "Send Inject" button. On submit, calls a `/api/inject` POST endpoint that writes the message to the master MCD process via the `!project inject` verb. Inject history (last 20 per project) stored in localStorage.

### Acceptance Criteria

- AC1: Inject panel opens from Command Palette ("inject into <slug>") and from Instance Grid row kebab menu
- AC2: `/api/inject` POST `{ slug, message }` → runs `!project inject <slug> <message>` via the MCD HTTP MCP server
- AC3: Success shows a confirmation flash ("Injected ✓"); error shows red banner with message
- AC4: Inject history (last 20) shown as collapsible list below textarea; clicking re-populates textarea
- AC5: Textarea supports multi-line; Ctrl+Enter submits; Escape closes panel
- AC6: Slug selector shows live state badge (color) for each project

---

## P18 — Token Budget Gauge

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators running cost-sensitive projects have no live view of how close a project is to its monthly token budget. Overages are discovered after the fact via billing, not from the dashboard.

### Proposed Solution

Add a `TokenBudgetGauge` component to the Instance Grid row and Project Graph detail drawer. Each project can have an optional `monthlyTokenBudget` field in `channels.json`. The gauge is a neon arc (0–100%) showing tokens used this calendar month vs budget. Color: green < 70%, amber 70–90%, red > 90%. The `/api/metrics/[slug]` endpoint (from P15) provides the token total. Projects without a budget show no gauge.

### Acceptance Criteria

- AC1: Gauge visible in Instance Grid row when `monthlyTokenBudget` is set on the project
- AC2: Arc color transitions: green → amber → red at 70% and 90% thresholds
- AC3: Tooltip shows exact tokens used, budget, and % remaining
- AC4: Budget field editable via `/api/projects/[slug]/budget` PATCH endpoint; updates `channels.json`
- AC5: Projects without budget show a dim "no budget" placeholder (not blank space)
- AC6: Month resets on the 1st; gauge reads 0% at reset

---

## P19 — Cross-Channel Semantic Search

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators cannot search across all project transcripts and memories from the dashboard. Finding which channel discussed a particular topic, error, or decision requires manually reading channel histories or running grep on the server.

### Proposed Solution

Add a `/search` page with a unified full-text search across: (1) memory records in `memory.db` (content field); (2) last 500 lines of each project's latest `.jsonl` transcript (assistant text blocks only). A `/api/search?q=<term>` endpoint runs SQLite FTS on memories and line-based substring match on transcripts. Results grouped by source (Memory / Transcript) and project slug. Clicking a result opens the Memory Panel or Transcript Panel pinned to that entry.

### Acceptance Criteria

- AC1: Search input on `/search` page; results appear within 500ms for ≤ 20 projects
- AC2: Results grouped into Memory and Transcript sections; each result shows: slug, snippet (hit highlighted), timestamp
- AC3: Memory results link to Memory Panel filtered to that record
- AC4: Transcript results link to Transcript Panel scrolled to that entry
- AC5: Empty results show "No matches across memories or transcripts" with dim styling
- AC6: Search term persisted in URL query param (`?q=`); shareable link works

---

## P20 — Stall Inject Upgrade

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The `StallAlertPanel` inject dialog copies the `!project inject` command to clipboard and asks the operator to paste it into the master Discord channel. Now that P17 shipped `InjectTerminal`, this copy-paste detour is unnecessary friction. The stall panel should open `InjectTerminal` directly, pre-filled with the suggested continuation prompt.

### Proposed Solution

Replace the `InjectDialog` inside `StallAlertPanel` with a call to the global `InjectTerminal` via the `mc:inject` window event (introduced in P17). Pass `initialSlug` and pre-populate `message` with the suggested prompt via a new `mc:inject` event payload field (`initialMessage`). `InjectTerminal` gains an optional `initialMessage` prop. The old clipboard-based dialog is removed.

### Acceptance Criteria

- AC1: Clicking "Inject" in `StallAlertPanel` opens `InjectTerminal` modal (not clipboard dialog)
- AC2: `InjectTerminal` pre-filled with the stall's suggested continuation prompt
- AC3: Project slug pre-selected from the stall entry
- AC4: After sending, stall row removed optimistically (same behavior as before)
- AC5: Old `InjectDialog` component and clipboard path deleted from `StallAlertPanel`
- AC6: `mc:inject` event payload extended with optional `initialMessage` field

---

## P21 — Watchdog Countdown in Instance Grid

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The stuck-watchdog timer (default 5 min, adaptive up to 30 min) fires silently. Operators watching an active project have no warning that the watchdog is about to kill it. The only signal is a sudden `watchdog` event in the feed, which may arrive after the kill.

### Proposed Solution

Add a per-project watchdog countdown badge to `InstanceGrid`. When a project has `lastActivity` within the watchdog window, show a countdown timer that ticks toward the kill threshold. A `/api/fleet` extension provides each project's `stuckThresholdMinutes` and `lastReplyMs`. Badge colors: green (>50% time remaining), amber (20–50%), red pulsing (<20%). Badge disappears when project is idle or after a reply resets the timer.

### Acceptance Criteria

- AC1: Countdown badge visible in Instance Grid row for active projects
- AC2: Badge shows remaining time in format `W:SS` (minutes:seconds)
- AC3: Badge color transitions green → amber → red at 50% and 20% thresholds
- AC4: Badge pulses red when < 20% threshold remains
- AC5: Badge disappears when project receives a reply (watchdog reset)
- AC6: `/api/fleet` response includes `stuckThresholdMinutes` and `lastReplyMs` per project

---

## P22 — Pipeline-to-Diff Deep Link

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The `/pipeline` kanban detail drawer shows tasks and proposal snippets but has no way to see the actual code changes for a project in Build or Verify stage. Operators must navigate to the graph, find the project node, open the diff tab, and scroll back. There is no direct path from a pipeline card to the diff.

### Proposed Solution

Add a "View Diff" button to the `/pipeline` detail drawer for cards in `build`, `verify`, or `pr` stage. Clicking it navigates to `/graph?diff=<slug>`, which the graph page already supports (or should be wired to auto-open the diff tab for that slug). Alternatively, embed a compact diff preview inline in the drawer using the existing `/api/diff/[slug]` endpoint: last 5 commits as a log + stat summary (no full patch).

### Acceptance Criteria

- AC1: "View Diff" button visible in detail drawer for `build`, `verify`, `pr` stage cards
- AC2: Button links to `/graph?diff=<slug>` which auto-opens the diff tab for that project
- AC3: Compact diff preview (commit log + `--stat`) shown inline in drawer below tasks list
- AC4: Drawer uses `/api/diff/[slug]` (existing endpoint); no new API required
- AC5: "No diff yet" message shown if project has no commits
- AC6: Preview truncated at 10 commits and 20 stat lines

---

## P23 — Metrics CSV Export

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The `/metrics` page shows per-project token usage and cost estimates but has no export. Operators managing billing need to share these figures with finance or include them in sprint reports. Copy-pasting from a web table is error-prone for multi-project fleets.

### Proposed Solution

Add an "Export CSV" button to the `/metrics` page header. Clicking it triggers a download of a CSV file with columns: `slug, model, totalInputTokens, totalOutputTokens, estimatedCostUsd, avgLatencyMs, p95LatencyMs, turnsPerDay, exportedAt`. The CSV is generated client-side from the already-fetched metrics data (no new API endpoint needed). The global row is included as a `__total__` slug.

### Acceptance Criteria

- AC1: "Export CSV" button in `/metrics` page header
- AC2: Download triggered immediately on click; filename `mcd-metrics-YYYY-MM-DD.csv`
- AC3: CSV includes all rows currently visible in the table (respects any active filter)
- AC4: Global totals row included as slug `__total__`
- AC5: CSV generated client-side from in-memory data; no network request on export
- AC6: Button disabled and shows "Loading…" while metrics are still fetching

---

## P24 — Project Health Score Ring

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators have no single composite signal to judge overall project health. Fleet Health Bar shows state counts; metrics shows token totals — but no view rolls stall rate, token efficiency, memory freshness, and message recency into one glanceable score per project.

### Proposed Solution

Add a `HealthScoreRing` component (neon arc gauge, 0–100) to the Instance Grid row and Project Graph detail drawer. Score is computed server-side at `/api/health/[slug]` from four sub-scores: (1) **Recency** — exponential decay on hours-since-last-message; (2) **Stall rate** — fraction of recent sessions that ended stalled (read from transcript `stop_reason`); (3) **Token efficiency** — inverse of average tokens-per-turn vs fleet median; (4) **Memory freshness** — days since last memory file write under `memory/`. Weights: 40% recency, 30% stall, 20% efficiency, 10% freshness. Ring color: green ≥ 80, amber 50–79, red < 50. A `/api/health` aggregate endpoint returns scores for all projects for the grid view.

### Acceptance Criteria

- AC1: `HealthScoreRing` renders a neon arc 0–100 in Instance Grid row; color transitions at 80/50
- AC2: Tooltip shows score breakdown: recency, stall rate, efficiency, freshness sub-scores
- AC3: `/api/health/[slug]` returns `{ score, recency, stallRate, efficiency, freshness, computedAt }`
- AC4: `/api/health` aggregate returns scores for all active projects in one request
- AC5: Projects with < 2 sessions show a dim "insufficient data" state (not 0)
- AC6: Score updates on same 30s poll cycle as fleet endpoint; no extra request needed in grid

---

## P25 — Git Branch Dashboard

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators cannot see each project's git state from the dashboard. Stale branches, unmerged commits, or diverged-from-main projects accumulate silently. Discovering them requires SSHing into the server and running git commands per project.

### Proposed Solution

Add a `/branches` page showing a table of all projects with git repositories. A `/api/branches` endpoint runs `git status --porcelain`, `git log --oneline origin/main..HEAD`, and `git log --oneline HEAD..origin/main` in each project's working directory. Table columns: slug, current branch, commits ahead of main, commits behind main, uncommitted changes count, last commit message + SHA (truncated). Row color: red if behind > 0 and ahead > 0 (diverged), amber if behind only, green if ahead-only or clean. A "Pull" button calls `/api/projects/[slug]/pull` to run `git pull`. A "View Diff" button deep-links to the Pipeline Diff Preview.

### Acceptance Criteria

- AC1: `/branches` page renders table within 2s; slugs without a `.git` dir show a "–" in git columns
- AC2: Commits ahead/behind computed relative to `origin/main` (or the repo's default remote branch)
- AC3: Uncommitted changes count = number of modified+untracked lines from `git status --porcelain`
- AC4: Pull button calls existing `/api/projects/[slug]/pull`; row shows spinner then refreshes
- AC5: "View Diff" button links to `/pipeline?slug=<slug>`; only shown when commits-ahead > 0
- AC6: Table sortable by any column; default sort by commits-behind desc

---

## P26 — Multi-Project Broadcast

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Injecting the same message into multiple stalled projects (e.g. "please summarize your progress and stop") requires repeated manual actions — one inject per channel in the Inject Terminal. There is no batch operation for fleet-wide interventions.

### Proposed Solution

Add a "Broadcast" action to the Command Palette and a dedicated `/broadcast` page. The page has: (1) a project multi-select with state-based presets (All Stalled, All Active, All); (2) a message composer with a `{{slug}}` template variable; (3) a recipient preview listing each selected slug; (4) a "Send to N projects" confirm button. Sending calls `/api/inject/[slug]` in parallel for each selected project. A delivery status column updates as each responds: queued → sent → error. Post-send, a summary toast shows success/fail counts.

### Acceptance Criteria

- AC1: `/broadcast` page reachable from Command Palette ("Broadcast…") and nav sidebar
- AC2: Preset filters: All, All Stalled, All Active, All Idle; multi-select for custom subsets
- AC3: `{{slug}}` in message body replaced per-project at send time
- AC4: Delivery status column shows per-project sent/error state in real time
- AC5: Send button disabled until ≥ 1 project selected and message non-empty
- AC6: Confirmation dialog shown before send when recipient count ≥ 5

---

## P27 — Scheduler Heatmap

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

Operators can view scheduled jobs in the Schedule Timeline but have no historical view of whether jobs are actually running and succeeding. A job can be "scheduled" but silently skipped or failing with no indication in the dashboard.

### Proposed Solution

Add a Scheduler Heatmap section to the `/timeline` page (or as a new tab). Display a GitHub-style contribution grid: rows = projects with schedules, columns = last 30 days (1 cell per day), cells colored by execution outcome (green=ran OK, red=failed, amber=skipped/stalled, gray=no job that day). A `/api/scheduler/history` endpoint reads a new `schedule-log.jsonl` file appended by the scheduler on each run. Each log entry: `{ slug, scheduledAt, firedAt, status: 'ok'|'stalled'|'skipped', durationMs }`. The heatmap uses `classifyChannel` state at job completion to determine outcome.

### Acceptance Criteria

- AC1: Heatmap grid renders in `/timeline`; rows = projects with schedules, cols = last 30 days
- AC2: Cell color: green=ok, red=failed, amber=stalled, gray=no schedule that day
- AC3: Hover tooltip shows: scheduled time, actual fire time, duration, status
- AC4: `/api/scheduler/history` reads `schedule-log.jsonl` from `MCD_CHANNELS_DIR`
- AC5: Scheduler writes an entry to `schedule-log.jsonl` on each job fire (append-only)
- AC6: Empty state (no log file) shows placeholder row per scheduled project with gray cells

---

## P28 — SSE Live Event Stream

**Status:** `[x] done`
**Created:** 2026-06-20

### Problem

The dashboard makes N×2 polling requests per minute (EventFeed, InstanceGrid, StallAlertPanel, Fleet Health Bar each poll independently every 30s). With many browser tabs or many projects, this generates significant redundant load on the server and `channels.json` reads.

### Proposed Solution

Add a `/api/events/stream` Server-Sent Events endpoint that pushes fleet-state diffs every 5s. The SSE payload type: `{ type: 'fleet-update' | 'tool-event' | 'stall-alert', data: ... }`. `ClientShell.tsx` subscribes with a single `EventSource` per tab and distributes events via a React context (`FleetContext`). `InstanceGrid`, `FleetHealthBar`, `StallAlertPanel`, and `EventFeed` read from context instead of polling. Polling endpoints remain as fallback (fetch-on-mount + manual refresh button). Reconnect with exponential back-off on disconnect.

### Acceptance Criteria

- AC1: `/api/events/stream` returns `text/event-stream` with 5s heartbeat
- AC2: `FleetContext` distributes SSE events; `InstanceGrid` re-renders on fleet-update events
- AC3: `EventFeed` receives `tool-event` events in real time without polling
- AC4: `StallAlertPanel` receives `stall-alert` events; no separate 30s poll needed
- AC5: On disconnect, `EventSource` reconnects with exponential back-off (1s→2s→4s… cap 30s)
- AC6: Existing poll endpoints (`/api/fleet`, `/api/stalls`) retained; components fall back to polling if SSE unavailable

---

## P29 — Browser Push Notifications for Stall Alerts

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

When a project stalls while the operator is away from the dashboard tab, there is no out-of-band signal. The stall panel only shows alerts to operators actively viewing the dashboard. Critical stalls (e.g. blocked PRs, stuck builds) can go unnoticed for hours.

### Proposed Solution

Use the browser Notifications API to deliver push-style alerts when new stalls are detected via SSE. A "Enable Notifications" button in the Stall Alert Panel requests `Notification.permission`. When `FleetContext` receives a `stall-alert` event with slugs not in the current dismissed set, fire a browser notification: title `⚠ Stall: <slug>`, body `<reason>`. Throttle: max 1 notification per slug per 5 minutes. Persist permission granted/revoked state in `localStorage`.

### Acceptance Criteria

- AC1: "Enable Notifications" button in StallAlertPanel; only shown if `Notification.permission !== 'granted'`
- AC2: New stall events via SSE trigger browser notification within 2s of detection
- AC3: Dismissed stalls do not trigger notifications; cleared when no longer stalled
- AC4: Max 1 notification per slug per 5 minutes (throttle)
- AC5: Permission request only on explicit user gesture (button click), not on page load

---

## P30 — Fleet Activity Heatmap

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Scheduler Heatmap (P27) shows when scheduled jobs fire, but operators have no way to see the actual activity density per project over time. Distinguishing projects with regular autonomous activity from truly idle/abandoned ones requires manually inspecting transcripts.

### Proposed Solution

Add an `/api/metrics/activity-heatmap` endpoint that reads transcript `.jsonl` files for all projects, buckets assistant turns by hour-of-day × day-of-week (7×24 grid), and returns activity density per cell. Render a heatmap at `/metrics#activity` using a CSS grid with color intensity (dark→neon-cyan) scaled to max cell value. Rows = day-of-week (Mon–Sun), columns = hour (0–23). Tooltip on hover shows exact turn count. Rolling 30-day window.

### Acceptance Criteria

- AC1: `/api/metrics/activity-heatmap` returns `{ slug, grid: number[7][24] }[]` for all projects
- AC2: Heatmap component renders at `/metrics` page (new tab below existing charts)
- AC3: Project selector chips filter the heatmap to selected projects
- AC4: Tooltip on cell hover shows exact count and period
- AC5: Rolling 30-day window; endpoint returns `generatedAt` ISO timestamp

---

## P31 — Agent Turn Duration Histogram

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Operators set `stuckThresholdMinutes` per project manually with no data to guide the choice. There is no visibility into how long typical agent turns actually take (first tool call → reply). Thresholds set too low cause false-positive watchdog kills; too high means real stalls go undetected.

### Proposed Solution

Add `/api/metrics/turn-durations` that parses transcript `.jsonl` files, pairs each user-turn start with the next assistant reply, and returns a distribution of turn durations per project (p50, p90, p99, max, last 30 days). Add a "Turn Duration" histogram widget to the `/metrics` page. Show per-project bars, highlight the current `stuckThresholdMinutes` as a vertical threshold line. Include a "Recommended threshold" (p99 × 1.5) suggestion per project.

### Acceptance Criteria

- AC1: `/api/metrics/turn-durations` returns `{ slug, p50, p90, p99, max, count, recommendedThresholdMins }[]`
- AC2: Histogram widget on `/metrics` page renders per-project bars with threshold overlay
- AC3: Recommended threshold shown as a dashed line; color-coded (green=current≥recommended, amber=close, red=below)
- AC4: Clicking a bar opens that project's transcript in TranscriptPanel
- AC5: Rolling 30-day window; minimum 5 turns required before showing recommendation

---

## P32 — Broadcast History Log

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Multi-Project Broadcast (P26) sends messages to multiple channels but leaves no audit trail. Operators cannot review what was broadcast, to which projects, or when. If a broadcast was sent with a typo or to wrong targets, there is no way to verify what actually happened.

### Proposed Solution

Extend the `/api/broadcast` POST handler to persist each broadcast to `mc.db` (new `broadcasts` table: id, ts, message, targets JSON, status). Add a `/broadcast/history` page at `/broadcast#history` that lists past broadcasts in reverse-chronological order with expandable details (targets, message, timestamp). Add a delete/dismiss action per entry. Use the existing SQLite `db.ts` for storage.

### Acceptance Criteria

- AC1: Each broadcast POST inserts a row in `broadcasts` table (mc.db) with ts, message, targets[]
- AC2: `/api/broadcast/history` GET returns rows paginated (limit 50, cursor-based)
- AC3: Broadcast history tab visible at `/broadcast` page below the send form
- AC4: Each row is expandable: shows full message text, target slugs, sent timestamp
- AC5: Delete button removes entry from history (soft-delete with `deleted_at`)

---

## P33 — Project Annotation Panel

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Project metadata in `channels.json` is machine-configured. Operators need a way to attach human-readable notes (owner, status, blockers) to a project without editing JSON. Currently annotations must be added to the project's CLAUDE.md or noted externally, where they're invisible in the dashboard.

### Proposed Solution

Add a `notes` column to the existing `instances` or a new `project_annotations` table in `mc.db`. Expose `/api/projects/[slug]/annotation` (GET/PUT). Add a collapsible annotation input to each project card in `InstanceGrid` (click a pencil icon to reveal a textarea, auto-saves on blur). Show the first 60 chars of the note as a subtitle on the card. Notes persist in SQLite across restarts and bot redeployments.

### Acceptance Criteria

- AC1: `project_annotations` table in mc.db with columns `slug TEXT PK, note TEXT, updated_at INTEGER`
- AC2: GET `/api/projects/[slug]/annotation` returns `{ note: string | null }`; PUT upserts
- AC3: Pencil icon on each InstanceGrid card; click reveals textarea; saves on blur
- AC4: First 60 chars of note shown as subtitle on card when note is non-empty
- AC5: Empty/blank note PUT deletes the row; card subtitle hidden

---

## North Star

MCD's goal: **fully featured autonomous agent harness** — one-liner install, graceful error handling, audit trails, token saving, memory saving, minimal operator toil. All proposals below serve this direction.

---

## P34 — Cross-Platform One-Liner Installer

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Setting up MCD requires manual steps: install bun, tmux, clone repo, run setup script, configure env. There is no single install command. This blocks adoption and makes self-hosted deployments fragile. macOS and Windows users face extra friction.

### Proposed Solution

Ship a `bin/install.sh` (curl-pipe compatible) and `bin/install.ps1` (PowerShell) that detect OS/arch, install bun and tmux via the appropriate package manager (brew/apt/scoop/winget), clone or update the repo, run `setup-new-instance.sh` interactively, and write a systemd unit (Linux) or launchd plist (macOS) or Windows service wrapper for auto-start. Also publish an `npx mcd-setup` shim that delegates to the shell installer. Document the one-liner in README.

### Acceptance Criteria

- AC1: `curl -fsSL https://raw.githubusercontent.com/chan4lk/claude-multi-channel-discord/main/bin/install.sh | bash` completes on Ubuntu 22+, Debian 12+, macOS 13+
- AC2: `bin/install.ps1` completes on Windows 11 with PowerShell 7+
- AC3: Installer detects existing bun/tmux and skips reinstall; idempotent
- AC4: Systemd/launchd/Windows service registered and started on completion
- AC5: `npx mcd-setup` delegates to the platform installer

---

## P35 — Graceful Error Recovery Framework

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

When a project's claude subprocess crashes, the bot waits for the next inbound message to lazy-respawn. If tmux dies, the session is silently lost. If the Discord gateway reconnects after a long outage, in-flight messages may be lost. There is no retry budget, circuit breaker, or operator notification for repeated failures.

### Proposed Solution

Add a per-project failure ledger (`failureCount`, `lastFailedAt`, `backoffUntil`) stored in memory inside `ProjectPool`. On subprocess exit, schedule a respawn with exponential backoff (5s→10s→30s→2min, cap 5min). After 5 consecutive failures within 30min, mark the project as `circuit-open` and emit a `watchdog` event to the master channel. Circuit auto-resets after 10min of no failures. All respawn/backoff/circuit events are logged to `mc.db` events table. Expose current circuit state in `/api/fleet`.

### Acceptance Criteria

- AC1: Subprocess crash triggers respawn with exponential backoff; no operator action needed for transient failures
- AC2: After 5 failures in 30min, circuit opens; master channel receives notification
- AC3: Circuit state visible in InstanceGrid card (`circuit-open` badge)
- AC4: Circuit auto-resets after 10min clean window
- AC5: All respawn/backoff/circuit events logged to `mc.db` with slug, ts, reason

---

## P36 — Comprehensive Audit Trail

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

There is no tamper-evident log of who did what to MCD. `!project` commands, spawn/stop events, config mutations, and inject actions leave no persistent audit record beyond ephemeral Discord messages. Post-incident reconstruction is impossible.

### Proposed Solution

Add an `audit_log` table to `mc.db` with columns `(id INTEGER PK, ts INTEGER, actor TEXT, actor_id TEXT, verb TEXT, target TEXT, payload TEXT, ip TEXT)`. Every `!project` command, spawn, stop, kill, config change, inject, and broadcast writes a row. Expose `/api/admin/audit` (paginated, admin-key gated). Add an Audit Log tab to the `/admin` page with filter by actor/verb/target and ISO timestamp range. Rows are append-only (no delete API).

### Acceptance Criteria

- AC1: `audit_log` table in mc.db; schema migration runs on startup if table absent
- AC2: All `!project` verbs, spawn/stop/kill/inject events write a row with actor Discord user ID
- AC3: `/api/admin/audit` returns rows paginated by cursor; requires admin API key
- AC4: `/admin` page shows audit tab: filter by actor, verb, target, date range
- AC5: Rows are append-only; no DELETE endpoint; export as NDJSON available

---

## P37 — Context Window Optimizer (Token Saver)

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Long-running project sessions accumulate context that bloats token usage. Claude Code's context grows unbounded across many turns until the session is evicted or the operator manually restarts. There is no mechanism to detect context saturation or prompt the agent to self-compress before hitting limits.

### Proposed Solution

Track token usage per turn from transcript `.jsonl` (`message.usage.input_tokens`). When a project's rolling-window input tokens exceed a configurable threshold (default 80% of model context, e.g. 160k for claude-sonnet-4-6's 200k window), emit a `context-warning` event and inject a compression prompt: _"Your context is large. Please summarise completed work, close finished tasks, and compact your working memory before continuing."_ Log the injection as an audit event. Expose `contextUsagePct` in `/api/fleet` and show a gauge in InstanceGrid.

### Acceptance Criteria

- AC1: Per-project rolling input-token tracker reads from transcript `.jsonl` each poll cycle
- AC2: `contextWarningThresholdPct` configurable per-project in `channels.json` (default 80)
- AC3: Compression prompt injected when threshold crossed; max once per 10min per project
- AC4: `context-warning` event emitted to `mc.db` and SSE stream
- AC5: `contextUsagePct` in `/api/fleet` response; InstanceGrid card shows gauge when > 60%

---

## P38 — Cross-Session Memory Distillation

**Status:** `[ ] pending`
**Created:** 2026-06-21

### Problem

Each project's Claude session accumulates memory files during a run, but when sessions are evicted and respawned, only `--resume` carries forward the conversation. Learned facts, patterns, and decisions from one session are not distilled into durable per-project knowledge that survives a full restart.

### Proposed Solution

After a session ends (clean stop or watchdog kill), schedule a distillation job: spawn a short-lived `claude -p` process in the project directory with prompt: _"Summarise the key facts, decisions, and open questions from this session into MEMORY.md in ≤500 words. Merge with existing content."_ The distillation job runs in the background with a 90-second timeout. On next session start, `--resume` plus the updated MEMORY.md give continuity. Log distillation events to `mc.db`. Configurable: `distillOnStop: true` per-project.

### Acceptance Criteria

- AC1: `distillOnStop: true` in project config triggers distillation within 30s of clean stop
- AC2: Distillation uses `claude -p` with a fixed prompt; 90s hard timeout; retried once on failure
- AC3: Distillation output is merged (not replaced) into `projects/<slug>/MEMORY.md`
- AC4: Distillation event logged to audit trail with duration and token count
- AC5: `distillationEnabled` visible in `!project show` output

---

## P39 — Autonomous Goal Persistence

**Status:** `[ ] pending`
**Created:** 2026-06-21

### Problem

When a project agent restarts (watchdog kill, manual stop, server restart), it resumes the conversation but has no explicit record of its current high-level goal or task. The agent must re-infer intent from conversation history. Long-running autonomous tasks (multi-day builds, research) lose momentum across restarts.

### Proposed Solution

Add a `GOAL.md` per project under `projects/<slug>/GOAL.md`. Operators set the goal via `!project set goal "..."` (or via a new dashboard field). After each `reply` tool call, a background watcher checks if the reply contains a goal-completion signal (configurable regex or LLM check). On restart, the GOAL.md is prepended to the system prompt injection so the agent immediately knows its mission. Include `lastGoalUpdate` and `goalStatus` (active/paused/completed) in `/api/fleet`. Dashboard shows goal text in InstanceGrid card.

### Acceptance Criteria

- AC1: `!project set goal "<text>"` writes `projects/<slug>/GOAL.md`; `!project show` displays it
- AC2: `GOAL.md` contents injected into per-turn system context wrapper on session start
- AC3: `goalStatus` (active/paused/completed) in `/api/fleet`; InstanceGrid card shows goal chip
- AC4: `!project set goal ""` clears the goal file
- AC5: Goal text max 500 chars; truncated with warning if exceeded

---

## P40 — Token Budget Enforcement & Alerts

**Status:** `[ ] pending`
**Created:** 2026-06-21

### Problem

`monthlyTokenBudget` is already stored per-project in `channels.json` and the TokenBudgetGauge shows usage, but there is no enforcement. When a project exceeds its budget, Claude continues generating tokens at cost. There are no proactive alerts at threshold milestones (50%, 80%, 100%).

### Proposed Solution

Extend the fleet broadcaster to check `monthlyTokensUsed / monthlyTokenBudget` each tick. At 50%, 80%, and 100% thresholds, emit a `budget-alert` SSE event and post a master-channel notification (once per threshold per calendar month). At 100%, automatically pause new inbound messages to the project (queue them, drain when budget resets at month start). Expose `budgetStatus: 'ok' | 'warning' | 'critical' | 'exhausted'` in `/api/fleet`. Dashboard shows budget status in InstanceGrid card with color coding.

### Acceptance Criteria

- AC1: 50%/80%/100% budget milestones each emit a `budget-alert` SSE event and master-channel message (once per threshold per month)
- AC2: At 100%, new inbound messages queued; queued count shown in InstanceGrid card
- AC3: Budget reset at calendar month start (UTC midnight on 1st) restores message flow
- AC4: `budgetStatus` in `/api/fleet`; InstanceGrid card color: green/amber/red/grey
- AC5: `monthlyTokenBudget: null` means unlimited; enforcement skipped
