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

**Status:** `[x] done`
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

**Status:** `[x] done`
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

**Status:** `[x] done`
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

---

## P41 — Audit Log Browser

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

P36 shipped a comprehensive audit trail written to `mc.db` (SQLite). Every fleet event (spawns, kills, stuck-watchdog, circuit-open, budget-alerts, scheduler fires) is persisted. But there is no way to browse it from the mission control UI — operators must `sqlite3 mc.db` to inspect history. High-value operational data exists but is invisible.

### Proposed Solution

Add an `/audit` page to mission control that reads from `mc.db` via a new `/api/audit` route. Display events newest-first in a paginated table with columns: timestamp, event type (color-coded badge), slug, and payload summary. Support filtering by event type and by slug. Add a link from each InstanceGrid card's slug to a pre-filtered audit view for that project. Limit page size to 100; add load-more button.

### Acceptance Criteria

- AC1: `/audit` page lists events from `mc.db`, newest-first, paginated 100/page
- AC2: Event type filter (multiselect: spawn, stuck, circuit-open, budget-alert, scheduler, crash)
- AC3: Slug filter — text input that narrows to a single project's events
- AC4: InstanceGrid slug chip links to `/audit?slug=<slug>` for per-project drill-down
- AC5: `/api/audit` route returns `{ events: AuditEvent[], total: number }`; respects `?type=&slug=&limit=&offset=` params

---

## P42 — Memory Distillation Status Panel

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

P38 added cross-session memory distillation: after a project session stops, `src/distillation.ts` summarises the transcript and writes a `MEMORY.md` file in the project directory. This runs silently — operators have no way to see which projects have distilled memory, when it last ran, or how large the memory has grown. A project with a stale or missing MEMORY.md may be operating without useful context.

### Proposed Solution

Add a `/api/memory` route that reads each project's `projects/<slug>/MEMORY.md` and returns `{ slug, exists: bool, sizeBytes: number, lastModified: string | null }`. In the InstanceGrid card, add a small memory chip (💭) showing size (e.g. "4.2 KB") when MEMORY.md exists. Clicking the chip opens a modal that shows the full MEMORY.md content. Add a "Distill now" action button in the modal that calls `POST /api/memory/<slug>/distill` to trigger a manual distillation job.

### Acceptance Criteria

- AC1: InstanceGrid slug row shows 💭 chip with file size when `projects/<slug>/MEMORY.md` exists
- AC2: Clicking chip opens modal with MEMORY.md content (read-only, markdown-rendered)
- AC3: Modal has "Distill now" button that POSTs to `/api/memory/<slug>/distill`; server runs `distillation.ts` synchronously and refreshes the panel
- AC4: `/api/memory` returns memory status for all projects in one call; updates every 60s alongside fleet polling
- AC5: Projects with no MEMORY.md show no chip (no clutter)

---

## P43 — Budget Queue Count Badge

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

P40 queues inbound messages when a project's budget is exhausted. The InstanceGrid card shows the slug in grey when `budgetStatus === 'exhausted'`, but the operator cannot see how many messages are waiting. If 10 messages accumulated over a weekend, they would all fire at month start with no warning — potentially overwhelming the agent. P40's AC2 ("queued count shown in InstanceGrid card") was not fully implemented: the queue lives in the bot process, not in a queryable API.

### Proposed Solution

Expose `budgetQueuedCount` in `/api/fleet` by writing it to a side-file `budget-queue-state.json` under `MCD_CHANNELS_DIR`. The pool writes this file whenever the queue changes (`budget-exhausted`, `budget-restored` events). The mission-control fleet-compute reads it and surfaces `queuedCount` on `FleetProject`. InstanceGrid shows a small badge like "⏳3" next to the grey exhausted chip.

### Acceptance Criteria

- AC1: Pool writes `budget-queue-state.json` (`{ [chatId]: { slug, count, updatedAt } }`) on every queue change
- AC2: `/api/fleet` returns `queuedCount?: number` on `FleetProject` when `budgetStatus === 'exhausted'` and count > 0
- AC3: InstanceGrid shows `⏳<N>` badge next to exhausted slug chip; tooltip says "N message(s) queued for next month"
- AC4: Badge disappears when queue drains (count returns to 0)
- AC5: `budget-queue-state.json` written atomically (temp-file rename) to avoid partial reads

---

## P44 — Inline Goal Editor in Dashboard

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

P39 added `GOAL.md` per project and shows a goal chip in the InstanceGrid. But goals can only be set via `!project set goal "<text>"` typed into Discord. Operators using the mission control dashboard cannot set or clear a goal without switching to Discord. The goal chip is read-only — no pencil icon, no inline editor.

### Proposed Solution

Extend the InstanceGrid goal chip to be editable. Clicking the chip (or a ✎ button next to it) opens an inline textarea pre-filled with the current GOAL.md content. On save, `PUT /api/projects/<slug>/goal` writes the new content to `projects/<slug>/GOAL.md`. On clear, `DELETE /api/projects/<slug>/goal` removes the file. Add a `goalStatus` selector (active / paused / completed) rendered as a small pill that can be toggled. Mirror the existing `SlugAnnotation` component pattern.

### Acceptance Criteria

- AC1: Goal chip in InstanceGrid has a ✎ button; clicking opens inline textarea editor
- AC2: `PUT /api/projects/<slug>/goal` with `{ text: string, status?: 'active'|'paused'|'completed' }` writes `GOAL.md`
- AC3: `DELETE /api/projects/<slug>/goal` removes `GOAL.md`; chip disappears from card
- AC4: goalStatus pill (active=purple, paused=grey, completed=green) toggleable inline; persisted to GOAL.md frontmatter or a sidecar `GOAL.status` file
- AC5: Save is debounced on blur/Enter; optimistic UI update before server confirms

---

## P45 — Per-Project Timeline View

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

All project-level data (audit events, scheduler fires, budget alerts, memory distillations, stall detections) lives in separate stores. There is no single view that shows a project's history as a unified chronological timeline. Debugging why a project went stale or why budget was consumed requires cross-referencing audit log, scheduler heatmap, and transcript tail separately.

### Proposed Solution

Add a `/projects/<slug>` page with a vertical timeline view. Each entry is a timestamped event with an icon and colour: 🟢 spawn, 🔴 kill/crash, ⚠️ stuck/stall, 🔶 budget threshold, 📅 scheduler fire, 💭 distillation, 💬 reply (count per turn). Source data: audit events from `mc.db` + transcript `.jsonl` (for turn/reply events). Clicking a turn entry expands a snippet of the assistant's reply. Timeline is infinite-scroll, newest first. Link from InstanceGrid slug chip.

### Acceptance Criteria

- AC1: `/projects/<slug>` renders a vertical timeline with icons and timestamps
- AC2: Event types covered: spawn, kill, crash, stuck, budget-alert, scheduler-fire, distillation, assistant-reply-turn
- AC3: Clicking a reply-turn entry expands the assistant reply text snippet (first 300 chars)
- AC4: Timeline paginated: loads 50 events, "load older" button appends next 50
- AC5: Link from InstanceGrid slug chip (`{slug} ⟳` → `/projects/<slug>` on Ctrl+click or separate icon)

---

## P46 — Activity Pulse Rings on Project Graph

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Project Graph shows project state via color (idle/active/stalled/autonomous) but conveys no quantitative activity intensity. Two "active" projects could have wildly different turn rates and token costs — the graph shows them identically. Operators cannot see at a glance which projects are most busy or healthiest.

### Proposed Solution

Add a "Pulse Mode" toggle button in the Project Graph header. When enabled, each node gains two animated SVG rings sourced from the existing `/api/health` aggregate endpoint: (1) an inner activity ring whose CSS animation-duration is proportional to project activity rate (derived from `ageMins` — more recent = faster pulse); (2) an outer health ring whose color maps the health score (green ≥ 80, amber 50–79, red < 50). Ring radius scales with health score. A mini-legend appears in the graph corner explaining ring semantics. Toggle state persists to localStorage. No new API endpoint required — uses existing `/api/health`.

### Acceptance Criteria

- AC1: "Pulse" toggle button in graph legend area; default OFF
- AC2: When ON, each node renders an inner activity ring with animation-duration between 0.6s (very active) and 3s (idle)
- AC3: Outer health ring color: green (#4ADE80) for score ≥ 80, amber (#F59E0B) for 50–79, red (#EF4444) for < 50
- AC4: Health ring radius scales between NODE_RADIUS+8 and NODE_RADIUS+16 proportional to score
- AC5: Mini-legend in graph corner (when pulse ON) shows ring color → score tier mapping
- AC6: Toggle state persisted to localStorage key `mc_graph_pulse`; `/api/health` fetched once on enable then on 30s interval

---

## P47 — Context Fill ETA Badge

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Context Window Optimizer (P37) shows `contextUsagePct` as a gauge when > 60%, but gives no forward-looking estimate. Operators cannot tell if a project will saturate its context in 10 minutes or 10 hours. Unplanned context saturation triggers compression injections that interrupt the agent mid-task.

### Proposed Solution

Add a `contextFillEtaMinutes` field to `/api/fleet` response. Computed by: reading the last 5 turns from transcript to get tokens-per-turn velocity; dividing remaining context headroom (model context limit × threshold − current input tokens) by that velocity. If velocity ≤ 0 or data insufficient, field is absent. InstanceGrid card shows a small ⏱ badge ("ctx full ~2h") when `contextFillEtaMinutes` < 120 and `contextUsagePct` > 50. Badge color: green > 60min, amber 20–60, red < 20.

### Acceptance Criteria

- AC1: `/api/fleet` includes `contextFillEtaMinutes?: number` computed from last-5-turn token velocity
- AC2: InstanceGrid card shows ⏱ badge when eta < 120min and contextUsagePct > 50
- AC3: Badge format: "ctx ~Xh Ym" for hours+mins, "ctx ~Xm" for minutes only
- AC4: Badge color: green > 60min, amber 20–60min, red < 20min
- AC5: When velocity data insufficient (< 3 turns), badge not shown; no division-by-zero crash
- AC6: Tooltip on badge shows exact velocity (tokens/turn) and remaining headroom

---

## P48 — CLAUDE.md Live Editor

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Each project's CLAUDE.md (system prompt) can only be edited by SSHing into the server or typing into a text editor. Operators iterating on project behavior must context-switch out of the dashboard. There is no way to preview, diff, or save the system prompt from the mission control UI.

### Proposed Solution

Add a "System Prompt" tab to the Project Graph detail drawer and InstanceGrid card context menu. The tab shows a `<textarea>` pre-filled with the current `projects/<slug>/CLAUDE.md` content. A `GET /api/projects/[slug]/claude-md` endpoint reads the file; `PUT` writes it atomically (temp-file rename). Ctrl+S saves; shows a "Saved ✓" confirmation for 2s. A diff view (split before/after) shown below the textarea highlights what changed. Character count shown; warn at > 8000 chars.

### Acceptance Criteria

- AC1: "Prompt" tab in Project Graph detail drawer (alongside Info and Diff tabs)
- AC2: `GET /api/projects/[slug]/claude-md` returns `{ content: string, sizeBytes: number, lastModified: string }`
- AC3: `PUT /api/projects/[slug]/claude-md` with `{ content: string }` writes atomically; returns 200 on success
- AC4: Ctrl+S or "Save" button saves; shows "Saved ✓" confirmation; error shown on failure
- AC5: Character count below textarea; amber warning at > 6000 chars, red at > 8000
- AC6: Last-modified timestamp shown; content refreshed on drawer open

---

## P49 — Cross-Project Goal Progress Board

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Project goals (GOAL.md, from P39) are visible only per-project in the InstanceGrid goal chip. There is no fleet-level view of all active goals, their statuses, or which projects have made progress. Operators managing many autonomous projects have no single surface to track what each agent is working toward.

### Proposed Solution

Add a `/goals` page with a kanban board. Three columns: Active (purple), Paused (grey), Completed (green). A `/api/goals` endpoint scans all project directories for `GOAL.md`, reads content and status (from `GOAL.status` sidecar or frontmatter), and returns cards. Each card shows: slug badge, goal text (first 120 chars), status chip, last-modified age, and a link to `/projects/<slug>` timeline. Clicking a card's status chip cycles Active → Paused → Completed via `PUT /api/projects/[slug]/goal`. Page accessible from nav sidebar and Command Palette.

### Acceptance Criteria

- AC1: `/goals` page renders kanban with Active / Paused / Completed columns
- AC2: `/api/goals` scans all project dirs in `channels.json`; returns `{ slug, goalText, status, lastModified }[]`
- AC3: Clicking status chip on a card cycles status and persists via existing `PUT /api/projects/[slug]/goal`
- AC4: Cards link to `/projects/<slug>` for full timeline context
- AC5: Projects with no GOAL.md not shown; empty board shows "No goals set" placeholder
- AC6: Page reachable from Command Palette "Goals board" command and nav sidebar link

---

## P50 — Audit Replay Scrubber

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Post-incident debugging requires reconstructing fleet state at a past moment. The Audit Log Browser (P41) shows events in chronological order but has no way to "rewind" to a specific time and see what the fleet looked like. Operators must mentally reconstruct state from a list of events — error-prone for complex multi-project incidents.

### Proposed Solution

Add a "Replay" panel to the `/audit` page. A time-range picker + a scrubber slider lets operators select a moment in the past. The panel shows a read-only snapshot of the InstanceGrid as it would have appeared at that moment: project states inferred from audit log events (spawn/kill/stuck events rebuild state transitions). The reconstruction is purely client-side from already-fetched audit rows — no new API needed. A "play" button animates through events at 10×. A "jump to incident" button appears when a `stuck` or `circuit-open` event is found in the selected window.

### Acceptance Criteria

- AC1: "Replay" toggle button in `/audit` page header
- AC2: When enabled, a time-range picker + slider appear above the audit table
- AC3: Scrubbing to a timestamp reconstructs project states from audit events up to that point
- AC4: Reconstructed state shown as a mini InstanceGrid (slug + state badge) below the slider
- AC5: "Play" button animates through events in the selected range at 10× speed
- AC6: "Jump to incident" button scrolls to first `stuck` or `circuit-open` event in range

---

## P51 — Unified Knowledge Graph

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Project nodes, memory records, and goals live in separate views. Operators have no single visualization that shows how knowledge, intent, and agent identity relate across the fleet. There is no way to see at a glance which projects share memory themes, which goals are backed by rich memory, or which agents are knowledge-rich vs knowledge-bare.

### Proposed Solution

Add a `/knowledge` page with a multi-type D3 force-directed graph. Three node shapes: circles (projects), diamonds (memories), hexagons (goals). Edges: project→memory when `memory.channel_slug` matches project slug; project→goal when `GOAL.md` exists for that project; memory→memory when two memories share the same `channel_slug`. Node size: projects scale with health score; memories scale with `access_count`; goals are fixed. A `/api/knowledge` endpoint aggregates `/api/fleet`, `/api/memories`, and `/api/goals` into a unified `{ nodes, edges }` graph payload. Filter chips (Projects / Memories / Goals / All) hide/show node types without re-running the simulation. Clicking a node opens a detail panel (right-side drawer) with full content and links to source views.

### Acceptance Criteria

- AC1: `/knowledge` page renders all three node types within 2s; node count shown in header
- AC2: `/api/knowledge` returns `{ nodes: KnowledgeNode[], edges: KnowledgeEdge[] }` from fleet + memory + goal sources
- AC3: Filter chips hide/show node types; simulation keeps positions; chip state in localStorage
- AC4: Clicking project node opens drawer: slug, state, health score, goal text, memory count
- AC5: Clicking memory node opens drawer: type, content, access_count, last_accessed, linked project
- AC6: Clicking goal node opens drawer: goal text, status, slug, link to `/projects/<slug>`
- AC7: Page reachable from nav sidebar and Command Palette ("Knowledge graph" command)

---

## P52 — Fleet Intelligence Advisor

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Dashboard operators monitor fleet health reactively — they respond to stalls, budget alerts, and stuck watches after the fact. There is no proactive intelligence layer that synthesizes fleet state, memory quality, and goal progress to surface prioritized recommendations before problems escalate.

### Proposed Solution

Add a collapsible "Advisor" panel to the dashboard (bottom-right corner, toggleable with `A` shortcut). A `/api/advisor` endpoint runs a lightweight heuristic scan (no LLM) over fleet state, audit events, memory freshness, context usage, and goal staleness. Returns up to 5 ranked recommendations as cards, each with: severity (info/warn/critical), title, explanation (1-2 sentences), and a one-click action (inject suggestion text, trigger distill, copy command). Recommendations refresh every 5 minutes or on demand. Examples: "Project X has not replied in 3h — suggest inject", "Project Y context at 87% — suggest compression", "Memory for project Z is 14 days stale — suggest distillation". Recommendations are fully heuristic (no external AI calls).

### Acceptance Criteria

- AC1: Advisor panel toggleable with `A` key; collapsed by default; toggle state in localStorage
- AC2: `/api/advisor` returns `{ recommendations: AdvisorCard[] }` sorted by severity desc
- AC3: Each card has: severity badge (critical=red, warn=amber, info=cyan), title, explanation, action button
- AC4: Action button: inject cards open InjectTerminal pre-filled; distill cards POST `/api/memory/<slug>/distill`; command cards copy to clipboard
- AC5: Panel shows "Fleet looks healthy ✓" when no recommendations
- AC6: Refresh every 5min; manual refresh button in panel header; last-checked timestamp shown

---

## P53 — Proposal-to-Impact Traceability Matrix

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Specclaw proposals drive git commits, audit events, and agent tool calls — but there is no link between a proposal and its downstream impact. Operators cannot tell how many lines of code, how many tokens, or how many tool calls a given proposal generated. Post-mortem analysis of large changes is manual.

### Proposed Solution

Add a `/api/pipeline/impact/[slug]/[changeName]` endpoint that: (1) reads `proposal.md` created date; (2) runs `git log --oneline --after=<created>` to count commits and changed files in the project's working dir; (3) counts audit events tagged with the change name (if the agent logs them); (4) counts tool calls from transcript `.jsonl` in the window. Return `{ commits, filesChanged, linesAdded, linesDeleted, auditEvents, toolCalls, durationDays }`. Add an "Impact" tab to the `/pipeline` detail drawer showing these stats as neon stat cards. A fleet-wide "Impact Leaderboard" widget on `/pipeline` sorts changes by `commits + linesAdded` descending.

### Acceptance Criteria

- AC1: `/api/pipeline/impact/[slug]/[changeName]` returns impact stats for a given change
- AC2: "Impact" tab in pipeline detail drawer shows: commits, files changed, ±lines, duration
- AC3: Impact Leaderboard widget on `/pipeline` page ranks all verified/PR-stage changes by impact score
- AC4: Impact stats computed from git log date-bounded by proposal `created` date
- AC5: Changes with no git history show "No commits yet" in Impact tab
- AC6: Leaderboard updates on same 60s poll as pipeline page

---

## P54 — Live Agent Thought Stream

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Operators watching the Project Graph see node state colors update every 5s but cannot see what each agent is actually thinking or doing at a micro level. Active projects are opaque blobs — the graph gives no semantic signal about current reasoning, tool calls in progress, or decision points.

### Proposed Solution

Add a "Thought Stream" overlay mode to the Project Graph (toggle button in graph header, keyboard shortcut `T`). When enabled, active project nodes emit animated text particles showing the last tool call name (e.g. "→ Edit", "→ WebFetch", "→ Agent") as floating labels that drift upward from the node and fade out over 3s. Source: SSE `tool-event` events from `FleetContext` (already pushed by P28). Text particles are CSS-animated `<div>` elements absolutely positioned over the SVG. Max 3 simultaneous particles per node to prevent clutter. Particle color matches tool category (file ops=cyan, web=amber, agent=purple, other=grey).

### Acceptance Criteria

- AC1: "Thought" toggle button in Project Graph header; off by default; state in localStorage
- AC2: When ON, tool-event SSE messages trigger a floating text particle at the source project node
- AC3: Particle shows tool name (short form: "Edit", "Bash", "WebFetch", "Agent"); drifts up and fades over 3s
- AC4: Particle color: file ops (#22D3EE cyan), web (#F59E0B amber), agent (#A78BFA purple), other (#6B7280 grey)
- AC5: Max 3 particles per node; oldest dropped when 4th arrives
- AC6: No particles emitted for `mcp__mcd__*` tool calls (same suppression rule as progress mode)

---

## P55 — Autonomous Weekly Fleet Report

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Operators get no periodic summary of fleet performance. Week-over-week comparisons of token usage, goals achieved, PRs opened, stalls resolved, and memory growth require manual dashboard inspection. There is no automated digest to share with stakeholders or use as a self-audit.

### Proposed Solution

Add a `/api/reports/weekly` endpoint that generates a JSON summary of the past 7 days: per-project metrics (tokens, turns, stalls, PRs via git log, memories distilled), fleet totals, top performers (most active, most efficient, most goals completed). A `/reports` page renders this as a neon-styled report card with sparklines and a summary narrative. An "Export HTML" button generates a self-contained single-page HTML report for sharing. A scheduler entry can be added via `!project schedule add` to trigger weekly report generation. Report data sourced entirely from existing `mc.db` + transcript `.jsonl`; no new data collection required.

### Acceptance Criteria

- AC1: `/api/reports/weekly` returns `{ generatedAt, weekStart, weekEnd, projects: WeeklyProjectStats[], fleet: FleetWeeklyStats }`
- AC2: `/reports` page renders stats as cards: total tokens, turns, stalls, estimated cost, goals completed
- AC3: Per-project table sortable by any metric; top-3 projects highlighted with neon border
- AC4: "Export HTML" button downloads a self-contained report (inlined CSS, no external deps)
- AC5: Report data from `mc.db` audit events + transcript `.jsonl` for the 7-day window
- AC6: Scheduler-compatible: `POST /api/reports/weekly/generate` triggers report and saves to `reports/YYYY-WW.json` in `MCD_CHANNELS_DIR`

---

## P56 — Dashboard Navigation Completeness

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The dashboard header only links to 6 of the 13+ available Mission Control pages (Graph, Timeline, Memory, Pipeline, Audit, Goals). Pages like `/metrics`, `/branches`, `/broadcast`, `/knowledge`, `/reports`, and `/search` are reachable only by typing URLs directly. New operators discovering the product have no way to know these views exist.

### Proposed Solution

Replace the flat header link row with a collapsible "All Views" dropdown (click or keyboard `V`). Group links by category: **Observability** (Graph, Timeline, Memory Graph, Knowledge), **Operations** (Pipeline, Audit, Branches, Broadcast), **Intelligence** (Goals, Metrics, Reports, Advisor), **Admin** (Search, Admin). Each group shows a neon section heading. Active page is highlighted. On mobile the dropdown becomes a full-width slide-in menu. Current unlinkable pages (`/metrics`, `/branches`, `/broadcast`, `/knowledge`, `/reports`, `/search`) get added to the nav.

### Acceptance Criteria

- AC1: All 13+ pages reachable from the dashboard header via the dropdown
- AC2: Links grouped by category with section headings
- AC3: Current route highlighted in the dropdown
- AC4: Dropdown closes on Escape or outside click
- AC5: Mobile: dropdown renders as a full-width overlay panel
- AC6: No layout shift — dropdown does not reflow the header HUD area

---

## P57 — Fleet Intelligence Advisor Dashboard Tile

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Fleet Intelligence Advisor (`/api/advisor`) generates actionable recommendations (critical stalls, memory distillation suggestions, token budget alerts) but the main dashboard has no tile for it. Operators must navigate to `/advisor` separately to see recommendations, missing time-sensitive critical alerts.

### Proposed Solution

Add a collapsible "Advisor" tile to the main dashboard page, positioned below the Instance Grid. The tile polls `/api/advisor` every 60s and shows the top 3 recommendations as compact cards with severity badges (critical=red pulse, warn=amber, info=cyan). Each card has a one-click action button that calls the relevant endpoint (`/api/inject/[slug]`, etc.). If no recommendations exist, the tile shows a "Fleet healthy ✓" message. A red badge on the tile header pulses when `critical` recommendations exist.

### Acceptance Criteria

- AC1: Advisor tile polls `/api/advisor` every 60s; shows top 3 recommendations
- AC2: Critical recommendations cause tile header badge to pulse red
- AC3: One-click action buttons work (inject, distill, command)
- AC4: "Fleet healthy ✓" state shown when recommendations array is empty
- AC5: Tile is collapsible; collapsed state persisted in localStorage
- AC6: Tile added to main dashboard page, below the Instance Grid

---

## P58 — Reports Page Sortable Table + Sparklines

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The `/reports` page renders a per-project table but it is not sortable — operators cannot click a column header to rank by cost, stalls, or turns. The table also lacks visual trend context: a project with 100 turns could be rising or declining week-over-week, but there is no sparkline to show the intra-week trend.

### Proposed Solution

Add client-side sort to every column header in the `/reports` per-project table (click to sort asc/desc, toggle on second click, active column highlighted). Extend `/api/reports/weekly` to include a `dailyTurns: number[7]` field per project (turns per day for the past 7 days). Render a 7-point mini sparkline SVG (inline, no lib) next to each project's Turns value showing the daily trend with a neon stroke. Color: green if last 3 days trend upward, red if downward, grey if flat.

### Acceptance Criteria

- AC1: All table columns in `/reports` are sortable; active sort column highlighted
- AC2: `/api/reports/weekly` returns `dailyTurns: number[7]` per project
- AC3: Sparkline SVG rendered next to Turns value; 7 points, neon stroke
- AC4: Sparkline color: green (uptrend), red (downtrend), grey (flat)
- AC5: Sort state preserved across report refreshes within the session
- AC6: Sparklines render correctly on mobile (do not overflow table cell)

---

## P59 — Cross-Page Deep Link: Graph → Metrics → Report

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Project Graph, Metrics page, Timeline, and Weekly Report all show data for the same projects but there are no cross-links between them. Clicking a project node in the graph has no path to "see this project's metrics" or "see this project in the weekly report". Navigation between views requires going back to the dashboard and re-navigating — breaking flow when investigating a specific project.

### Proposed Solution

Add a context action menu to the Project Graph node detail drawer (small "⋯" button). Menu items: "View Metrics →" (links to `/metrics?slug=<slug>`), "View Timeline →" (`/timeline?slug=<slug>`), "View in Report →" (`/reports#<slug>`). On the `/metrics` page, detect the `slug` query param and pre-select/scroll to that project. On `/reports`, detect the hash and highlight the matching row. On the Timeline page, detect the `slug` param and filter to that project.

### Acceptance Criteria

- AC1: Project Graph node detail drawer has "⋯" action menu with Metrics / Timeline / Report links
- AC2: `/metrics?slug=<slug>` pre-selects and scrolls to that project's card
- AC3: `/reports#<slug>` highlights the matching row with a neon outline for 3s
- AC4: `/timeline?slug=<slug>` pre-filters the timeline to that project
- AC5: Links open in the same tab (no `target="_blank"`)
- AC6: Menu closes on outside click or Escape

---

## P60 — Pipeline Impact All-Stages Leaderboard

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The Impact Leaderboard added in P53 only shows changes in the `verify` or `pr` stage, silently excluding active `build`-stage changes that may have significant code churn. An operator running a large refactor in the build stage would never see it in the leaderboard, making the widget misleading about fleet-wide impact.

### Proposed Solution

Expand the Impact Leaderboard to include all pipeline stages. Add a stage filter row above the table (buttons: All / Propose / Plan / Build / Verify / PR) to let operators scope by stage. Changes with zero commits show a "—" in the score column instead of "0". Leaderboard fetches impact stats in batches of 5 concurrent requests (not one-shot parallel) to avoid hammering the server when there are many changes. Add a total row at the bottom showing fleet-wide commit + line sums.

### Acceptance Criteria

- AC1: Leaderboard includes changes from all pipeline stages by default
- AC2: Stage filter buttons (All / Propose / Plan / Build / Verify / PR) filter the table
- AC3: Changes with zero commits show "—" impact score
- AC4: Impact stats fetched in batches of 5 (not all-at-once)
- AC5: Total row at bottom shows fleet-wide sums: commits, +lines, -lines, tool calls
- AC6: Leaderboard updates on same 60s poll as pipeline page

---

## P61 — 3D Force-Graph View

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The 2D Project Graph (P2) shows project relationships as a flat node-link diagram. With many projects, nodes overlap and edges become hard to trace. There is no spatial depth cue to help operators distinguish clusters of related projects from isolated ones.

### Proposed Solution

Add a `/graph3d` page that renders the fleet as a 3D force-directed graph using `react-force-graph-3d` (three.js underneath). Nodes are spheres colored by project state (cyan=idle, green=active, red=stalled, purple=autonomous). Edges represent cross-channel injection links. Camera orbits automatically; operators can drag to rotate, scroll to zoom, click a node for a floating info card. Node size scales with memory file size.

### Acceptance Criteria

- AC1: `/graph3d` page renders all fleet projects as 3D spheres
- AC2: Node color matches fleet state (idle/active/stalled/autonomous)
- AC3: Camera auto-orbits; drag to rotate, scroll to zoom
- AC4: Click node opens floating info card (slug, state, last-seen)
- AC5: Node size proportional to memory size
- AC6: Nav link to `/graph3d` in navigation

---

## P62 — Dashboard Section Visibility Controls

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The main dashboard has 8 sections: Instances, Stall Alerts, Transcript, Scheduler, Fleet Advisor, Event Feed, Specclaw Pipeline, and Memories. Operators focused on a single workflow (e.g., stall triage or schedule management) must scroll past irrelevant sections. There is no way to collapse or hide sections to declutter the view.

### Proposed Solution

Add a `⊞ Sections` icon button in the dashboard header (right side, before the SSE indicator). Clicking opens a compact popover listing all 8 dashboard sections with toggle switches. Toggling a section off animates it to zero height and removes it from layout flow (not just `visibility: hidden`). State persisted to `localStorage` under key `mc-dashboard-sections`. A pill badge `N hidden` appears in the header when any sections are off. All sections visible by default on first load.

### Acceptance Criteria

- AC1: Header has `⊞ Sections` button that opens/closes a popover
- AC2: Popover lists all 8 sections with on/off toggles
- AC3: Toggling off a section collapses it with a 200ms height animation; content unmounts
- AC4: Visibility state persisted to `localStorage`; survives page refresh
- AC5: `N hidden` pill badge visible in header when ≥1 section is hidden
- AC6: All sections on by default for new visitors (no prior localStorage entry)

---

## P63 — Fleet State History Sparklines

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The fleet header badges (Idle / Active / Stalled / Autonomous) show only the current point-in-time count. An operator seeing "3 Stalled" has no idea whether that number is rising, falling, or stable — critical context when deciding whether to intervene.

### Proposed Solution

Beneath each fleet state badge, render a 20-point micro-sparkline (40×16 px inline SVG) that records the badge's count every 30 seconds in a client-side ring buffer (max 20 samples = 10 minutes of history). Line color matches the state color. A rising stalled sparkline draws in red; a falling one in green. Ring buffer stored in a `useRef`; no server round-trips needed.

### Acceptance Criteria

- AC1: Each fleet badge (Idle/Active/Stalled/Autonomous) shows a 40×16 sparkline below the count
- AC2: Sparkline sampled every 30s; buffer holds last 20 samples (10 min)
- AC3: Stalled sparkline: green if last 3 points trend downward, red if upward, default color if flat
- AC4: Sparklines render without layout overflow on ≥320px viewport
- AC5: On first load, sparkline shows a single flat dot (only one sample yet)
- AC6: Sparklines are purely client-side (no new API endpoints)

---

## P64 — Project Galaxy Map

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Both the 2D Project Graph and 3D Force Graph lay out projects by connection topology. Projects with no cross-channel injection links appear as isolated floating nodes with no meaningful placement. There is no visualization that places ALL projects in a spatial context based on their intrinsic properties (activity, age, memory richness).

### Proposed Solution

Add a `/galaxy` page. Render projects as stars on a dark canvas using canvas2d or SVG. Position each project on a spiral-arm layout where: radial distance from center = days since last activity (recent projects near center), angular position = project creation order. Star size = memory file size (log scale). Star brightness/glow = current state (active=bright green, idle=dim cyan, stalled=red pulse, autonomous=purple nebula). Hovering a star shows a floating tooltip (slug, state, last-seen, memory size). Clicking navigates to `/projects/<slug>`. A legend panel in the bottom-left explains the encoding. Auto-animates with a slow rotation of the whole galaxy.

### Acceptance Criteria

- AC1: `/galaxy` page renders all fleet projects as stars on a dark canvas
- AC2: Radial distance from center proportional to recency (recent = close to center)
- AC3: Star size proportional to memory file size (log scale, min 4px, max 20px)
- AC4: Star color/glow reflects fleet state (active=green, idle=cyan, stalled=red, autonomous=purple)
- AC5: Hover shows tooltip with slug, state, last-seen, memory size
- AC6: Click star navigates to `/projects/<slug>`
- AC7: Legend panel in bottom-left explains size/color/position encoding
- AC8: Canvas rotates slowly (1 full rotation per 120s); pauses on hover

---

## P65 — Holistic Project Feed

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

No single view shows the complete picture of each project in one place. To understand a project's current state, an operator must visit the Dashboard (instance state), `/projects/<slug>` (memory + transcript), `/pipeline` (specclaw stage), `/metrics` (turn counts), `/branches` (git branch), and `/goals` (current goal) — six pages for what should be a single glance.

### Proposed Solution

Add a `/feed` page: a vertically-scrolling "project cards" feed where each card shows everything about one project in a compact 200px-tall card: slug + platform badge, fleet state dot, current goal (first 80 chars), active specclaw change (stage badge), latest transcript snippet (last tool call), memory size, git branch, last-active timestamp, and quick-action buttons (Inject, Stop, Graph). Cards sorted by last-active descending. Filtered by a search bar (slug/goal text match) and a state filter row (All / Idle / Active / Stalled / Auto). Data fetched from existing `/api/fleet`, `/api/goals`, `/api/pipeline` endpoints in parallel; refreshes every 30s.

### Acceptance Criteria

- AC1: `/feed` page renders one card per project, sorted by last-active descending
- AC2: Each card shows: slug, platform, state dot, goal snippet, specclaw stage, transcript snippet, memory size, git branch, last-active
- AC3: Search bar filters cards by slug or goal text (client-side, real-time)
- AC4: State filter row (All / Idle / Active / Stalled / Auto) filters cards
- AC5: Quick-action buttons on each card: Inject (opens InjectTerminal), Graph (links `/graph?highlight=<slug>`), Stop (with confirmation)
- AC6: Data refreshes every 30s; cards animate in on first load
- AC7: Nav link to `/feed` added to NavDropdown

---

## P66 — Agent Turn Flame Graph

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Operators cannot visualize how individual agent turns are structured: which tools were called, in what order, how long each took, and which tools dominate turn time. The metrics page shows p50/p90/p99 per project but gives no per-turn breakdown. Debugging a slow or stuck turn requires reading raw JSONL manually.

### Proposed Solution

Add a `/flamegraph` page that renders a flame-chart view of recent agent turns for a selected project. Each row is one turn (newest at top, max 20 turns). Each row contains colored blocks representing tool calls, positioned left-to-right by their occurrence within the turn and sized proportionally to their duration (derived from JSONL record timestamps). Tool calls are color-coded by category: Bash (orange), Read/Write (blue), Agent (purple), MCP (cyan), other (gray). A tooltip on hover shows tool name, duration ms, and status (ok/error). A new API route `/api/flamegraph/[slug]` parses the latest JSONL transcript for the project and returns structured turn data. No external dependencies — pure SVG rendering.

### Acceptance Criteria

- AC1: `/flamegraph` page renders; project selector dropdown populates from `/api/fleet`
- AC2: Each row represents one turn; max 20 turns shown; newest turn at top
- AC3: Tool call blocks color-coded: Bash=orange, Read/Write=blue, Agent=purple, MCP=cyan, other=gray
- AC4: Block width proportional to tool call duration (from JSONL timestamps); minimum visible width 4px
- AC5: Hover tooltip shows: tool name, duration ms, turn index
- AC6: X-axis shows turn duration in ms; Y-axis labels show turn index + user message snippet
- AC7: `/api/flamegraph/[slug]` returns structured TurnFlame data parsed from JSONL
- AC8: Nav link to `/flamegraph` added to NavDropdown under Observability

---

## P67 — Project Spotlight Drawer

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

To understand a project's full context, operators must navigate across six pages: Dashboard, `/projects/[slug]`, `/pipeline`, `/metrics`, `/branches`, and `/goals`. Every time a project card or graph node is clicked, operators leave the current view entirely.

### Proposed Solution

Add a global "Project Spotlight" right-side drawer (400px wide, slides in over content) that can be triggered from any project card in InstanceGrid, any node in the Galaxy Map or Force Graph, or any row in the timeline/feed pages. The drawer shows: state ring + slug header, current goal, active specclaw proposal (stage badge), last 3 transcript snippets, memory count + top 3 memory titles, git branch + last commit, scheduled jobs, and quick-action buttons (Inject, Stop). Drawer state is managed via URL param `?spotlight=<slug>` so it is shareable and deeplinked. Implemented as a `SpotlightDrawer` component registered in `ClientShell` so it is available on every page.

### Acceptance Criteria

- AC1: `SpotlightDrawer` renders as a right-side panel that slides in when `?spotlight=<slug>` is present in the URL
- AC2: Drawer shows: state dot + slug, goal, specclaw stage, last 3 transcript entries, memory count + previews, git branch, last scheduled job
- AC3: Clicking any project card/galaxy star/graph node adds `?spotlight=<slug>` to URL; closes on Escape or clicking outside
- AC4: Quick-action: Inject opens InjectTerminal pre-filled with the slug; Stop fires inject with `/stop`
- AC5: Drawer data auto-refreshes every 30s; stale indicator if data > 60s old
- AC6: Works on mobile (full-width bottom sheet on <640px)

---

## P68 — Fleet Ambient Display

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Mission Control has no wall-display or ambient mode. Operators monitoring the fleet from a secondary monitor need a glanceable, always-on visualization — not a data-dense dashboard.

### Proposed Solution

Add a `/ambient` page: a full-screen generative particle system that maps fleet state to visual atmosphere. Each project becomes a particle (circle) that orbits and drifts — idle particles drift slow cyan, active particles pulse bright green, stalled particles emit red ripples, autonomous particles glow purple with a slow orbit trail. The number of active particles and their brightness scales with fleet-wide activity. Clicking a particle opens the Project Spotlight drawer (`?spotlight=<slug>`). No nav header — a `[×]` exit button and an auto-hide overlay with the active/stalled count appear on mouse move. Particle positions are deterministic (seeded by slug hash) so the layout is stable across refreshes. Renders entirely in a `<canvas>` element using `requestAnimationFrame`; no external dependencies.

### Acceptance Criteria

- AC1: `/ambient` page renders full-screen canvas with no nav header
- AC2: One particle per project; position seeded by slug hash (stable)
- AC3: Particle color + animation reflects state: idle=slow cyan drift, active=green pulse, stalled=red ripple, autonomous=purple orbit
- AC4: Clicking a particle adds `?spotlight=<slug>` to URL; SpotlightDrawer slides in
- AC5: Fleet state polled every 30s from `/api/fleet`; particles animate transition on state change
- AC6: Mouse-move reveals overlay: active count, stalled count, `[×]` back-to-dashboard link; overlay auto-hides after 3s
- AC7: Nav link to `/ambient` added to NavDropdown under Observability

---

## P69 — Live Tool Call Ticker

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

When `progressMode` is enabled, tool call events flow through the SSE stream but are only visible in Discord or in a single project's progress messages. There is no fleet-wide view showing what all active projects are currently doing.

### Proposed Solution

Add a `/ticker` page styled like a Bloomberg terminal feed: a fixed-height scrolling panel of live tool call events across all active projects. Each row: `[HH:MM:SS] <slug> | <tool_name> | <status: started/done/error> | <duration_ms>`. Events sourced from the existing SSE stream at `/api/events/stream` — filter for `tool_progress` event type. Rows auto-scroll; newest at bottom. Color coding: slug in cyan, tool_name by category (Bash=orange, Read=blue, Agent=purple, MCP=teal, other=gray), status=green/red/amber, duration in dim white. A filter bar lets operators show only specific slugs or tool categories. The ticker pauses on hover (to allow reading); resumes on mouse-leave.

### Acceptance Criteria

- AC1: `/ticker` page renders scrolling event feed from SSE `/api/events/stream`
- AC2: Rows formatted: `[HH:MM:SS] slug | tool_name | status | duration_ms`
- AC3: Color coding: slug=cyan, tool category colors (Bash=orange, Read/Write=blue, Agent=purple, MCP=teal), status=green/red/amber
- AC4: Auto-scroll to newest; pauses on hover; resumes on mouse-leave
- AC5: Filter bar: slug substring filter + tool category multi-select checkboxes
- AC6: Max 500 rows retained in memory; oldest evicted on overflow
- AC7: Nav link to `/ticker` added to NavDropdown under Observability

---

## P70 — Cross-Project Memory Similarity Matrix

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

No view reveals which projects share similar memory topics or concerns. Operators cannot identify when two projects are independently solving the same problem, when a memory from one project would be valuable to another, or which projects are most topically isolated.

### Proposed Solution

Add a `/similarity` page showing a project × project heatmap where each cell's intensity represents the co-mention overlap between the two projects' memory content (simple word-frequency intersection over union after stop-word removal). Rows and columns are sorted by cluster (projects with highest average similarity grouped together). Each cell is colored from dark (0% overlap) to bright cyan (100% overlap). Hovering a cell shows the top 5 shared keywords. The diagonal is always 100% (excluded from sorting). A minimum threshold slider (default 10%) hides cells below threshold (gray). Data computed server-side at `/api/similarity` by reading all `~/.claude/projects/<encoded>/memory/*.md` files.

### Acceptance Criteria

- AC1: `/similarity` page renders an N×N heatmap where N = number of projects with memory files
- AC2: Cell intensity maps to word-overlap score (intersection/union of non-stop keywords, 0–1)
- AC3: Rows/columns sorted by cluster (greedy: row with highest average similarity placed first)
- AC4: Hover tooltip shows top 5 shared keywords for that cell pair
- AC5: Threshold slider (0–50%) grays out cells below threshold
- AC6: `/api/similarity` endpoint computes scores server-side; result cached 5 min
- AC7: Nav link to `/similarity` added to NavDropdown under Intelligence

---

## P71 — SpotlightDrawer Navigation Links

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The SpotlightDrawer (P67) shows a rich summary for each project, but has no way to navigate to the full detail views. To reach the timeline, flamegraph, metrics, or branches for a project, operators must close the drawer and navigate manually. The drawer is a dead end for power users.

### Proposed Solution

Add a compact "jump to" link bar inside the SpotlightDrawer header area (below the slug/state row). Show icon buttons for: Timeline (`/projects/<slug>`), Flame Graph (`/flamegraph?project=<slug>`), Metrics (`/metrics?slug=<slug>`), Branches (`/branches?slug=<slug>`). Each opens in the same tab, closing the drawer first. Existing "Inject" and "Stop" quick actions remain at the bottom.

### Acceptance Criteria

- AC1: Link bar visible in drawer header with Timeline, Flame, Metrics, Branches icons
- AC2: Clicking a link closes the drawer (removes `?spotlight` param) then navigates to the target
- AC3: Each icon has a tooltip showing the full page name
- AC4: Links render on both desktop (right panel) and mobile (bottom sheet) without overflow
- AC5: Target pages that don't exist for a project (e.g. no JSONL) handle gracefully — link still present, page shows empty state

---

## P72 — 3D Force-Graph Spotlight Integration

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The 3D Force-Graph page (`/graph3d`) still navigates to `/projects/<slug>` when a node is clicked, forcing operators to leave the 3D view entirely. The Galaxy Map (P67) was updated to open the SpotlightDrawer instead, but `graph3d` was not updated. Inconsistent click behavior between graph views creates UX confusion.

### Proposed Solution

Update `ForceGraph3D.tsx` and the `/graph3d` page to open `?spotlight=<slug>` on node click instead of navigating away, matching the Galaxy Map behavior. The SpotlightDrawer will slide in over the 3D view. Add a "full page" link inside the drawer (addressed by P71) for users who need the full timeline.

### Acceptance Criteria

- AC1: Clicking a node in `/graph3d` adds `?spotlight=<slug>` to the URL; SpotlightDrawer opens
- AC2: The 3D graph remains visible in the background while the drawer is open
- AC3: Closing the drawer (Escape or backdrop) returns to the graph without re-rendering
- AC4: Node click behavior consistent with Galaxy Map

---

## P73 — Broadcast Send History

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The `/broadcast` page lets operators send a message to all or selected channels, but has no record of what was sent. After a broadcast, operators cannot verify which channels received the message, what the exact text was, or when it was sent. A typo or mis-targeted broadcast leaves no audit trail in the UI.

### Proposed Solution

Add a local-storage-backed send history panel below the broadcast form on `/broadcast`. Each entry records: timestamp, target slug list (or "all"), message text (truncated), and a success/partial-fail indicator. Retain the last 20 entries. Add a "Re-send" button per entry that pre-fills the form with the same message and targets. A "Clear history" button purges localStorage.

### Acceptance Criteria

- AC1: After each successful broadcast, an entry is appended to history (localStorage)
- AC2: History shows: relative timestamp, target count, message excerpt (80 chars), status badge
- AC3: "Re-send" pre-fills slug selector and message textarea with the historical values
- AC4: History persists across page reloads; cleared by "Clear history" button
- AC5: Maximum 20 entries retained; oldest pruned on overflow

---

## P74 — Metrics Drill-Down to Flamegraph

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The `/metrics` page shows per-project p50/p90/p99 turn latency, but clicking a project row does nothing. Operators who see an outlier (e.g. p99 of 8 minutes) have no way to jump directly to the flamegraph for that project to diagnose which tool calls dominated. The gap between the aggregate metric and the turn-level breakdown requires manual navigation.

### Proposed Solution

Add a "View turns →" link/button on each project row in the Metrics page that deep-links to `/flamegraph` with the project pre-selected. The `/flamegraph` page already supports selecting a project via dropdown — update its URL to accept a `?project=<slug>` query param that pre-selects the project on load.

### Acceptance Criteria

- AC1: Each project row in `/metrics` has a "↬ Turns" button that links to `/flamegraph?project=<slug>`
- AC2: `/flamegraph` reads `?project=<slug>` on load and pre-selects that project in the dropdown
- AC3: If the slug from the URL is not in the fleet list, the dropdown defaults to the first available
- AC4: The button is visually small (ghost/icon) so it doesn't dominate the row layout

---

## P75 — On-Demand Fleet Report

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The `/reports` page displays pre-generated weekly fleet reports, but there is no way to generate a report on-demand. Operators who want a status snapshot mid-week, before a release, or after an incident must wait for the scheduled generation or trigger it externally. The page is read-only with no generation controls.

### Proposed Solution

Add a "Generate now" button on the `/reports` page that calls a new `/api/reports/generate` POST endpoint. The endpoint runs the same aggregation logic as the weekly report but snapshots the current fleet state immediately. The response is streamed back as SSE and the new report appears at the top of the table when complete. A spinner with elapsed-time counter is shown during generation. The generated report is tagged as "on-demand" in the source column.

### Acceptance Criteria

- AC1: "Generate now" button visible on `/reports` page (top right, or below header)
- AC2: Click triggers POST `/api/reports/generate`; button shows spinner + elapsed time
- AC3: On completion, new report row appears at top of table with "on-demand" badge in source column
- AC4: Generation errors surface inline (toast or error row) without crashing the page
- AC5: Button disabled while generation is in progress to prevent duplicate submissions

---

## P76 — Cross-Project Memory Similarity Matrix

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

No view reveals which projects share similar memory topics or concerns. Operators cannot identify when two projects are independently solving the same problem, when a memory from one project would be valuable to another, or which projects are most topically isolated.

### Proposed Solution

Add a `/similarity` page showing a project × project heatmap where each cell's intensity represents co-mention overlap between the two projects' memory content (word-frequency intersection-over-union after stop-word removal). Rows and columns sorted by cluster. Cell colored dark (0%) to bright cyan (100%). Hovering shows top 5 shared keywords. Diagonal excluded from sorting. Threshold slider (default 10%) grays cells below threshold. Data computed server-side at `/api/similarity` reading all `~/.claude/projects/<encoded>/memory/*.md`.

### Acceptance Criteria

- AC1: `/similarity` page renders N×N heatmap (N = projects with memory files)
- AC2: Cell intensity maps to word-overlap score (intersection/union of non-stop keywords, 0–1)
- AC3: Rows/columns sorted by cluster (greedy: highest-average-similarity row first)
- AC4: Hover tooltip shows top 5 shared keywords
- AC5: Threshold slider (0–50%) grays cells below threshold
- AC6: `/api/similarity` computes server-side; cached 5 min
- AC7: Nav link added under Intelligence

---

## P77 — Project Health Score Card

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The fleet dashboard shows per-project state (idle/active/stalled) but gives no aggregate quality signal. Operators cannot tell at a glance which projects are "healthy" (active, low stall rate, recent PR output, fresh memories) vs "degraded" (high stall rate, no output, old transcripts, stuck watchdog kills).

### Proposed Solution

Add a Health Score (0–100) computed server-side per project, weighting: stall rate (−30), recent turns (+ up to 30), PR output last 7 days (+ up to 20), memory write recency (+ up to 10), watchdog kills (−10 each, max −30). Expose `/api/fleet/health` endpoint. Show health badge on each InstanceGrid card: green ≥70, amber 40–69, red <40. Clicking the badge opens a breakdown tooltip: "−15 stall rate, +20 activity, +10 PRs…".

### Acceptance Criteria

- AC1: `/api/fleet/health` returns `{ slug, score, breakdown }[]`
- AC2: InstanceGrid card shows colored health badge (green/amber/red) next to state
- AC3: Clicking badge shows tooltip with score breakdown (per-factor +/- values)
- AC4: Tooltip auto-hides on click-outside or Escape
- AC5: Score updates with fleet refresh (30s poll)

---

## P78 — Agent Turn Diff Viewer

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The flamegraph shows turn duration and tool call counts but does not show what files changed during a turn. After a long autonomous turn, operators have no way in Mission Control to see "what did Claude actually produce?" without switching to a terminal and running `git diff`.

### Proposed Solution

Add a "Diff" tab to the `/projects/<slug>` page (alongside Timeline). The tab shows a virtual file diff for each turn: read the JSONL transcript, extract Edit/Write/Bash tool results, and reconstruct a summary of changed files with +/− line counts. For turns where git is available, call `/api/projects/<slug>/diff?commit=<sha>` which runs `git diff <parent>..<sha>` and returns the patch. Display as a unified diff viewer (syntax-highlighted, collapsible per file).

### Acceptance Criteria

- AC1: Diff tab visible on `/projects/<slug>` alongside Timeline/Memory tabs
- AC2: Turn list on left; selecting a turn shows diff on right
- AC3: For git-tracked projects, diff comes from `git diff <parent>..<sha>`; for others, synthesized from JSONL tool results
- AC4: Files collapsed by default; click to expand; +lines green, −lines red
- AC5: `/api/projects/<slug>/diff` route accepts `?commit=<sha>` and returns git patch

---

## P79 — Scheduler Visual Calendar

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

The existing `/scheduler` view shows scheduled jobs as a flat list of slugs and times. Operators cannot visualize the spread of scheduled tasks across the day/week, identify conflicts (two heavy jobs at the same time), or see when jobs last fired.

### Proposed Solution

Add a calendar/timeline view to the Scheduler page. Render a 24-hour horizontal band (midnight to midnight) with each scheduled job as a colored bar at its HH:MM position. Jobs on the same project share a color. Hovering a bar shows: slug, time, message excerpt, last-fired timestamp. A "week view" toggle shows Mon–Sun columns with job bars. The list view remains as a tab alongside the calendar view.

### Acceptance Criteria

- AC1: Scheduler page has "Calendar" tab alongside existing "List" tab
- AC2: 24-hour band renders jobs as colored position markers at HH:MM
- AC3: Hover tooltip shows slug, time, message excerpt, last-fired
- AC4: "Week view" toggle shows 7-column grid (Mon–Sun), each column is the 24h band
- AC5: Jobs on same project share color; color derived from slug hash

---

## P80 — Fleet Command History

**Status:** `[x] done`
**Created:** 2026-06-21

### Problem

Operators issue `!project` commands via Discord but have no searchable record of what was done. The audit log records command_executed events, but the Audit Log page requires knowing what to search for. There is no dedicated view for "recent operator commands" with quick replay.

### Proposed Solution

Add a `/commands` page showing recent `!project ...` command executions sourced from the audit log (verb = "command"). Each row: timestamp, operator, verb, target, status (success/error). Clicking a row shows the full command text and any error message. A "Re-run" button sends the exact command text back via `/api/inject` to the master channel. Filter by verb (create/clone/set/rm/etc) and operator. Paginate 50 per page.

### Acceptance Criteria

- AC1: `/commands` page lists command_executed audit entries, newest first
- AC2: Columns: timestamp, operator, verb, target, status
- AC3: Row expand shows full command text + error if any
- AC4: "Re-run" button POSTs command to `/api/inject` targeting master channel
- AC5: Verb filter (multi-select) and operator filter (text substring)
- AC6: Pagination: 50/page with prev/next
- AC7: Nav link added under Operations

---

## P81 — Project Comparison Panel

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators managing multiple similar projects (e.g., two agent channels working on related codebases) have no way to compare them side-by-side. Spotting divergence — one active, one stalled; one burning tokens, one idle — requires cross-referencing four different pages.

### Proposed Solution

Add a `/compare` page with two project pickers (dropdowns from `/api/instances` + channels.json slugs). Each column shows: state badge, last-reply time, total turns, token totals, estimated cost, avg/p95 latency, memory count, and most-recent 5 timeline events. A diff-style banner highlights where the two projects diverge significantly (e.g., cost >2× or latency >3×). URL encodes both slugs as query params so comparisons are shareable.

### Acceptance Criteria

- AC1: `/compare` page with two project selector dropdowns populated from known projects
- AC2: Each column shows state, last-reply, turns, input/output tokens, cost, latency, memory count
- AC3: Diff banner flags metrics where ratio between projects exceeds 2×
- AC4: Last 5 timeline events shown per project (newest first)
- AC5: URL encodes `?a=<slug>&b=<slug>`; page loads pre-selected from URL params
- AC6: Nav link added under Intelligence category

---

## P82 — Fleet Turn Density Heatmap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators don't know when their agents are most active during the day. A project that fires 20 turns per day might cluster them all at 2am or spread evenly — this matters for deciding when to schedule heavy jobs.

### Proposed Solution

Add a `/heatmap` page showing a 2D grid: rows = projects, columns = hours-of-day (0–23). Each cell shaded by turn count in the last 7 days. Uses existing transcript JSONL files for data (same parsing as `/api/metrics`). Hovering a cell shows: project slug, hour, turn count. A row summary column shows total daily turns. Cells above a threshold pulse amber. Color scale: zero = dark slate, max = neon cyan.

### Acceptance Criteria

- AC1: `/heatmap` page with projects × hours grid
- AC2: Cells shaded by turn count (last 7 days), zero = dark, max = neon cyan
- AC3: Hover tooltip: slug, hour (UTC), turn count
- AC4: Row summary column with total turns
- AC5: Cells at or above 75th-percentile turn count pulse amber
- AC6: Nav link under Observability

---

## P83 — Proposal → Commit Traceability View

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The backlog has 80+ implemented proposals but no visual link between a proposal (P-number) and the git commits that fulfilled it. Operators reading the changelog cannot tell which commit corresponds to which feature, and the specclaw pipeline view shows changes but not the original proposal context.

### Proposed Solution

Add a `/traceability` page that reads BACKLOG.md, extracts all proposals (P-number, title, status), then reads `git log --oneline` for the main repo and attempts regex matching on P-number references in commit messages (e.g., `P78`, `feat(mc): P78`). Renders a two-column table: left = proposal row (number, title, status), right = linked commit list (sha, message, date). Proposals with no linked commits show "untraced". Filter by status (done/pending) and search by title.

### Acceptance Criteria

- AC1: `/traceability` page listing all backlog proposals with linked commits
- AC2: Commit linking via regex match of `P\d+` in commit message subject
- AC3: Proposals with no commit matches show "untraced" in amber
- AC4: Filter by status (done / pending / all) and free-text search on title
- AC5: Clicking a commit sha opens `github.com/<repo>/commit/<sha>` in new tab if remote is detected
- AC6: Nav link under Intelligence

---

## P84 — Agent Behavior Scorecard

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The `/metrics` page shows per-project token totals and turn counts, but doesn't surface behavioral patterns: which tools get called most, how many tool calls happen per turn, or how turn duration correlates with tool count. These patterns reveal whether an agent is working efficiently or spinning.

### Proposed Solution

Extend the existing per-project metrics API (`/api/metrics/[slug]`) to add a `toolStats` field: top-10 tools by call count, avg calls per turn, avg output tokens per turn. Add a `ScoreCard` section to the `/metrics` page (collapsible per project) showing: efficiency score (output tokens / tool calls ratio), top tools bar chart (horizontal, neon bars), and a "turn profile" showing the distribution of tool calls per turn as a small histogram.

### Acceptance Criteria

- AC1: `/api/metrics/[slug]` returns `toolStats`: top tools, avg calls/turn, avg output tokens/turn
- AC2: `/metrics` page shows collapsible ScoreCard per project
- AC3: ScoreCard: top-5 tools as horizontal bars, avg calls/turn, efficiency score
- AC4: Efficiency score = output tokens / total tool calls, displayed as a gauge (0–100 scale)
- AC5: ScoreCard expands in-place on click; default collapsed

---

## P85 — Fleet State Snapshot & Diff

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When debugging a fleet regression ("why did three projects stall after the weekend?"), operators have no point-in-time record of fleet state to compare against. The audit log has individual events but no holistic "snapshot" of what everything looked like at a specific moment.

### Proposed Solution

Add a `/snapshots` page with a "Take Snapshot" button. Snapshots capture: all project slugs, states, last-reply timestamps, turn counts, and token totals as a JSON blob stored in the MC database. Snapshots are listed newest-first with a timestamp and project count. Selecting two snapshots shows a diff view: projects added/removed, state changes, turn delta, token delta. Each snapshot is tagged with a user-provided label (optional).

### Acceptance Criteria

- AC1: `/snapshots` page with "Take Snapshot" button; snapshots stored in MC SQLite DB
- AC2: Snapshot captures: all projects, states, last-reply ts, turn count, token totals
- AC3: Snapshot list newest-first with timestamp, label, and project count
- AC4: Select two snapshots → diff view: added/removed projects, state changes, delta metrics
- AC5: Optional label field when taking snapshot
- AC6: Nav link under Operations

---

## P86 — Backlog Dashboard Page

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

A `/api/backlog` endpoint already exists but there is no dedicated `/backlog` page in the mission control app. Operators wanting to track proposal progress must read the raw BACKLOG.md file. There is no quick way to see how many proposals are done vs pending, or to navigate from a proposal to its linked commits.

### Proposed Solution

Add a `/backlog` page that calls `/api/backlog` to render a kanban-style summary: a "Done" column and a "Pending" column, each showing proposal cards (P-number, title, created date). Clicking a card links to `/traceability?search=P<N>` to show its commit coverage. A top bar shows total counts with a mini progress bar (done / total). Nav link under Intelligence.

### Acceptance Criteria

- AC1: `/backlog` page renders two columns: Done and Pending
- AC2: Each card shows P-number, title, and created date
- AC3: Clicking a card navigates to `/traceability` pre-filtered to that proposal
- AC4: Top bar shows done count, pending count, and a progress bar
- AC5: Empty pending column shows a green "All caught up ✓" state
- AC6: Nav link under Intelligence sidebar group

---

## P87 — Unified Alert History Log

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The `StallAlertPanel` (P3) and budget alert banner (P40) show live alerts, but once a stall resolves or a budget threshold clears the alert disappears with no history. Operators debugging "why did project X restart three times last night?" have no alert timeline to consult.

### Proposed Solution

Persist alert events (stall detected, stall resolved, budget threshold hit, watchdog kill, inject triggered) to a new `alert_events` table in the MC SQLite DB via the existing SSE event pipeline. Add a `/alerts` page showing a reverse-chronological log: timestamp, project slug, alert type (color-coded), and description. A filter row lets operators narrow by project or alert type. Each row links to the relevant project in InstanceGrid. Retain 30 days of history; purge older rows on startup.

### Acceptance Criteria

- AC1: Alert events written to `alert_events` SQLite table on: stall detected/resolved, budget threshold, watchdog kill, inject
- AC2: `/alerts` page shows reverse-chronological event log
- AC3: Filter by project slug and alert type (stall / budget / watchdog / inject)
- AC4: Each row links to `/?project=<slug>` to highlight the source project
- AC5: Rows older than 30 days purged automatically on MC startup
- AC6: Nav link under Operations

---

## P88 — Per-Project Detail Page

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Getting a complete picture of a single project requires navigating to five different pages: Dashboard (health), Metrics (token usage), Goals (goal status), Branches (git status), and Scheduler (upcoming jobs). The SpotlightDrawer (P67) shows a summary but is read-only and lacks git and scheduler context.

### Proposed Solution

Add a `/projects/[slug]` page that aggregates all available project signals in one scrollable page: health score ring (from P77), last-5-turns sparkline, goal status and text, git status (current branch, ahead/behind, uncommitted), next scheduled job, memory count, total tokens (last 7 days), and an Inject button pinned at the top. Data sourced from existing `/api/fleet`, `/api/metrics/[slug]`, `/api/goals`, `/api/branches`, and `/api/schedules` endpoints. No new API needed.

### Acceptance Criteria

- AC1: `/projects/[slug]` page accessible; 404 if slug not in channels.json
- AC2: Health score ring, goal chip, git status, memory count, token total all visible without scrolling on ≥ 1280px
- AC3: Inject button opens InjectTerminal pre-filled with the project slug
- AC4: Page auto-refreshes every 30s
- AC5: "Open in Graph" link navigates to `/graph?highlight=<slug>`
- AC6: Back-link from SpotlightDrawer → `/projects/[slug]`

---

## P89 — Session Replay Mode

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Flamegraph (P66) shows timing across turns and the Turn Diff Viewer (P78) shows changes between two specific turns, but there is no way to step through an agent session sequentially — reading what the agent said, which tools it called, and how the output changed — without manually cross-referencing the raw JSONL transcript.

### Proposed Solution

Add a "Replay" button to the Flamegraph page (and SpotlightDrawer). Clicking it opens a full-screen Replay panel for the selected project's latest session. The panel shows: current turn number / total, the agent's reply text, tool calls made (name + truncated input/output), and a diff strip showing the change from the previous turn. Previous / Next buttons step through turns. A timeline scrubber at the bottom allows jumping to any turn. Auto-play mode advances every 3 seconds. Data sourced from existing `/api/diff` and `/api/flamegraph` endpoints.

### Acceptance Criteria

- AC1: "Replay" button on Flamegraph page opens the replay panel
- AC2: Replay panel shows: turn N/total, reply text, tool calls, diff from prior turn
- AC3: Previous / Next navigation; keyboard arrow keys work
- AC4: Timeline scrubber at bottom; clicking a turn jumps to it
- AC5: Auto-play mode (3s per turn) with pause/resume button
- AC6: Panel dismissible with Escape key

---

## P90 — Inject Command Templates

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators frequently inject the same message types (e.g. "continue", "summarize progress", "run tests") into multiple projects. The InjectTerminal (command palette) has no memory — each inject starts with a blank textarea. There is no way to save, name, or recall common messages without copy-pasting from a separate document.

### Proposed Solution

Add a "Templates" section to the InjectTerminal sidebar. Templates are saved in localStorage (up to 20 entries). Each template has a name (1–30 chars) and body text. A "Save as template" button in the InjectTerminal saves the current text. Clicking a template populates the textarea. A manage view lists all templates with delete/rename. Templates are also surfaced in the CommandPalette under a "Templates" group.

### Acceptance Criteria

- AC1: "Save as template" button in InjectTerminal; prompts for a name
- AC2: Template list shown in InjectTerminal sidebar; click to populate textarea
- AC3: Manage view: list all templates with delete and rename (inline edit)
- AC4: Templates persisted in localStorage; survive page refresh
- AC5: CommandPalette shows templates under a "Templates" group; selecting one opens InjectTerminal with the text pre-filled
- AC6: Max 20 templates enforced; oldest evicted when limit reached

---

## P91 — Proposal Dependency Graph

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Backlog Dashboard (P86) shows proposals as a flat list sorted by number. Operators cannot see which proposals build on others, which ones are preconditions for new work, or how the roadmap clusters by theme. There is no graph-based exploration surface for the proposal space.

### Proposed Solution

Add a `/proposal-graph` page with a force-directed graph (D3) where each node is a BACKLOG.md proposal. Edges are derived by scanning proposal body text for mentions of other proposal numbers (e.g. "extends P66", "see P83"). Node size encodes linked commit count from the traceability API. Color encodes status (green = done, amber = pending). Nodes cluster by inferred theme category (graph, memory, alerts, scheduler, metrics, etc.) derived from title keywords. Clicking a node opens a detail drawer with the full proposal body and acceptance criteria.

### Acceptance Criteria

- AC1: All proposals from BACKLOG.md appear as nodes; loaded via `/api/traceability`
- AC2: Edges drawn for cross-proposal body references (PXX mention in another proposal's text)
- AC3: Node size proportional to linked commit count (min size enforced for untraced nodes)
- AC4: Node color: green = done, amber = pending; stalled nodes pulse
- AC5: Click opens side drawer with proposal title, status, ACs, and linked commits
- AC6: Theme clusters rendered as soft halos (D3 hull) around keyword-grouped proposals
- AC7: Empty-state placeholder when no proposals loaded

---

## P92 — Fleet Turn Volume Treemap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators have no at-a-glance view of which projects are consuming the most compute (turns, tool calls). The metrics page shows per-project averages but not relative consumption across the fleet in a single visual. Heavy channels go unnoticed until they stall or run out of budget.

### Proposed Solution

Add a `/turns` page with a D3 treemap. Each rectangle is a project; area encodes turn count in the trailing 24 hours (sourced from transcript `.jsonl` files via a new `/api/fleet/turns` endpoint). Color encodes project state: cyan = idle, green = active, red = stalled. Hovering shows slug, turn count, avg tool calls/turn, last active. Clicking navigates to `/projects/[slug]`. A time-range selector (1h / 6h / 24h / 7d) controls the window.

### Acceptance Criteria

- AC1: Treemap renders within 2s; all projects with ≥ 1 turn appear
- AC2: Rectangle area proportional to turn count in selected time window
- AC3: Color encodes state: cyan = idle, green = active, red = stalled (pulsing)
- AC4: Hover tooltip: slug, turn count, avg tool calls, last-active timestamp
- AC5: Click navigates to `/projects/[slug]`
- AC6: Time-range selector: 1h / 6h / 24h / 7d; default 24h; state in URL param
- AC7: Zero-turn projects shown as thin placeholder strip, not omitted

---

## P93 — Project Lifecycle Gantt

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

There is no way to see the full lifecycle of each project on a shared time axis. Operators cannot compare when projects were created, when they last received an inject, when they stalled, or how activity overlaps across channels. The Cross-Channel Timeline (P10) shows events chronologically but not per-project lanes.

### Proposed Solution

Add a `/gantt` page with a horizontal Gantt chart. Each row is a project. The X axis is wall-clock time (scroll horizontally; default view = last 7 days). Events are plotted as icons on the lane: ● = turn, ⚡ = inject, ✗ = stall, 🔀 = PR merge. Data sourced from transcript `.jsonl` timestamps and the unified alert log. A project row can be collapsed to a thin bar (showing only high-signal events). Hover over any event shows a tooltip with timestamp and brief description.

### Acceptance Criteria

- AC1: All active projects appear as rows; inactive projects hidden unless toggled
- AC2: Turn events plotted as dots on the lane at correct timestamps
- AC3: Inject, stall, and PR events rendered with distinct icons and colors
- AC4: X axis scrollable; default view = last 7 days; zoom in/out with +/- buttons
- AC5: Hover tooltip: event type, timestamp, brief description
- AC6: Row click expands to show turn count per day as a mini-sparkline below the lane
- AC7: Export as PNG button

---

## P94 — Memory Audit Trail

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Memories written by Claude accumulate across projects but there is no unified view of what was remembered, when, or why. The Memory Graph (P13) shows connections between memories but not their creation timeline. Operators cannot audit what Claude has learned or detect stale/incorrect memories without SSHing into the server.

### Proposed Solution

Add a `/memory-audit` page with a filterable, sortable table of all memory files across all projects. A new `/api/memory-audit` endpoint scans each project's `memory/` directory (e.g. `~/.claude/channels/discord-multi/projects/<slug>/memory/`), reads frontmatter (name, type, description) and file mtime. Table columns: project, memory name, type (user/feedback/project/reference), description excerpt, last modified. Filter chips by type. Search by name/description. Clicking a row opens a drawer with the full memory body.

### Acceptance Criteria

- AC1: Table loads within 3s; all memory files across all projects shown
- AC2: Filter chips by type: user / feedback / project / reference / all
- AC3: Search by name or description excerpt (client-side, debounced)
- AC4: Sort by last-modified (default desc), project, name, type
- AC5: Click row opens drawer: full memory body (markdown rendered), file path, edit timestamp
- AC6: Stale memories (not updated in 30+ days) flagged with a clock icon
- AC7: Empty state if no memories exist

---

## P95 — Dashboard Mode Presets

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The main dashboard accumulates panels (Fleet Health Bar, Stall Alerts, Instance Grid, Event Feed, etc.) but shows them all simultaneously, which is overwhelming for focused tasks. An operator triaging stalls needs different panels visible than one reviewing pipeline progress. There is no way to save or switch named "modes."

### Proposed Solution

Add a preset switcher (pill-shaped toggle group) to the dashboard header. Three built-in presets: **Triage** (Fleet Health Bar + Stall Alerts + Inject Terminal), **Review** (Pipeline Kanban + Replay + Diff Viewer), **Ambient** (Galaxy Map + Event Feed + Turn Ticker). Custom presets can be saved from the current panel layout. Preset selection stored in localStorage. Each preset stores which dashboard sections are visible. Section visibility toggles animate via CSS transition.

### Acceptance Criteria

- AC1: Preset switcher visible in dashboard header; three built-in presets (Triage, Review, Ambient)
- AC2: Switching preset shows/hides the correct panels with CSS fade transition (≤ 200ms)
- AC3: "Save current layout as preset" button; prompts for name (1–30 chars)
- AC4: Custom presets stored in localStorage; survive page refresh
- AC5: Delete button on custom presets (built-ins cannot be deleted)
- AC6: Active preset name shown in header; "Custom" shown when layout diverges from any saved preset

---

## P96 — Live Session Terminal View

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When a project agent is misbehaving or stuck, debugging requires SSH into the server to inspect the tmux pane. There is no in-browser way to see the live Claude TUI output for a session. Operators lose visibility and must context-switch to a terminal.

### Proposed Solution

Add a `/projects/[slug]/terminal` page (linked from the per-project detail page) that streams the current tmux pane output in real time. A new `/api/projects/[slug]/terminal/stream` endpoint runs `tmux capture-pane -pt mcd-<slug>-* -e` on a 1.5s poll and SSE-streams the output as plain text. The browser renders it in a `<pre>` block with ANSI color stripping. The view is **read-only** — no input. A "Refresh" button forces a re-capture. A "Full history" toggle switches to `tmux save-buffer -S -` (full scrollback). Access-controlled: same auth as the dashboard.

### Acceptance Criteria

- AC1: `/projects/[slug]/terminal` page renders; linked from per-project detail quick-links
- AC2: SSE stream delivers pane captures at ≤ 2s latency
- AC3: ANSI color codes stripped (not shown as raw escape sequences)
- AC4: Read-only — no keyboard input forwarded to tmux
- AC5: "Full history" toggle fetches full pane scrollback
- AC6: Page shows "session offline" state when no tmux session matches the slug
- AC7: Stream auto-reconnects on SSE disconnect without page refresh

---

## P97 — Fleet Cost Breakdown

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Token usage is tracked per project in `/api/metrics/[slug]` but there is no fleet-level cost attribution view. Operators cannot see which projects are most expensive, how cost trends over time, or what proportion of spend comes from tool calls vs. generated text. Budget alerts exist (P41) but show no historical breakdown.

### Proposed Solution

Add a `/cost` page with three panels: (1) a stacked bar chart showing estimated USD cost per project per day (last 30 days), with input/output/cache token tiers color-coded; (2) a pie chart of cumulative spend by project (trailing 30 days); (3) a sortable table: project slug, total tokens, cache-hit %, estimated cost, cost trend (↑↓). A new `/api/cost` endpoint aggregates token counts from transcript `.jsonl` files and applies Claude Sonnet 4.6 pricing ($3/$15 per M in/out). Hover on bar chart shows day's breakdown by project.

### Acceptance Criteria

- AC1: `/cost` page renders within 3s; all projects with token data appear
- AC2: Stacked bar chart: one bar per day, color per project, last 30 days
- AC3: Cost calculated using current model pricing (Haiku $0.80/$4, Sonnet $3/$15, Opus $15/$75 per M tokens)
- AC4: Pie chart shows % share of cumulative 30-day cost by project
- AC5: Table sortable by total cost, tokens, cache %, trend
- AC6: Trend column shows 7-day delta: green (cost down ≥10%), red (up ≥10%), grey (flat)
- AC7: JSON export via direct API link

---

## P98 — CLAUDE.md Version History

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

`CLAUDE.md` is the system prompt for each project agent. It evolves over time — operators add guidance, fix behavior, tune constraints. But there is no in-dashboard way to see what changed, when, or compare versions. Prompt regressions (e.g. removing a critical constraint) go undetected until the agent misbehaves.

### Proposed Solution

Add a `/projects/[slug]/claude-md` page (linked from per-project detail) that shows the full CLAUDE.md version history. A new `/api/projects/[slug]/claude-md/history` endpoint runs `git log --follow -p -- CLAUDE.md` in the project's working directory and parses the output into a list of commits with diff hunks. The page renders a timeline: each commit is a row showing timestamp, short SHA, and commit message. Clicking a row expands an inline diff (red/green line diff). A "Compare" mode lets the user select any two versions for a side-by-side diff.

### Acceptance Criteria

- AC1: `/projects/[slug]/claude-md` page renders git log within 2s
- AC2: Each commit row shows: SHA (7 chars), date, author, message
- AC3: Clicking a row expands inline line diff (red = removed, green = added)
- AC4: "Compare" mode: select two commits → side-by-side diff panel
- AC5: Works for symlinked project dirs (uses realpath before git log)
- AC6: "No history" state when CLAUDE.md not yet committed or project has no git
- AC7: Current live content shown at top; diff against HEAD available in one click

---

## P99 — Multi-Project Workflow Canvas

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Orchestrating multi-step work across projects requires manually composing inject commands in sequence: inject to project A, wait, inject to project B with A's output, etc. The Inject Terminal (P7) and Broadcast (P9) handle single-shot operations, but there is no way to design, save, or trigger a multi-step inject workflow visually.

### Proposed Solution

Add a `/canvas` page with a drag-and-drop workflow builder. Nodes are projects (drag from a sidebar panel). Edges represent inject dependencies: "after project A replies, inject its output to project B." A "trigger text" field on each node seeds the first inject. A "wait for reply" checkbox on each edge controls whether the pipeline halts for confirmation before advancing. Saved workflows stored in `~/.claude/channels/discord-multi/canvas-workflows.json`. A "Run" button executes the workflow via sequential inject calls with the resolved outputs. A workflow execution log appears in a right-side panel.

### Acceptance Criteria

- AC1: `/canvas` page renders drag-and-drop canvas; project nodes draggable from sidebar
- AC2: Edges can be drawn between nodes; directed (source → target)
- AC3: Each node has: trigger text input, project selector, "wait for reply" toggle
- AC4: "Save" button persists workflow to `canvas-workflows.json`; list of saved workflows in sidebar
- AC5: "Run" button executes the workflow: injects in topological order; waits for reply when edge has "wait" set
- AC6: Execution log panel shows: step, inject text sent, reply received, timestamp
- AC7: Cycles detected and blocked (show error, not infinite loop)

---

## P100 — Agent Tool Permission Heatmap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Each project agent has a different tool permission configuration (`allowedTools`, `disallowedTools`, `permissionMode` in `channels.json`). There is no fleet-level view of which tools are available to which agents. Security audits are manual. Operators cannot spot misconfigured projects (e.g., a project accidentally granted Bash access) without reading raw JSON.

### Proposed Solution

Add a `/permissions` page with a matrix heatmap. Rows are projects; columns are known tool names (derived from the union of all `allowedTools` across the fleet). Each cell is colored: green = explicitly allowed, red = explicitly disallowed, grey = not configured (inherits default), yellow = permissionMode bypass. A `/api/permissions` endpoint reads `channels.json` defaults and per-project overrides and returns the matrix. Clicking a cell opens a tooltip showing the raw config value. A "Risky configs" panel below the matrix lists projects with `permissionMode: "bypass"` or broad `allowedTools: ["*"]`.

### Acceptance Criteria

- AC1: `/permissions` page renders matrix within 2s; all projects as rows, all known tools as columns
- AC2: Cell colors: green = allowed, red = disallowed, grey = default, yellow = bypass mode
- AC3: Clicking a cell shows tooltip with raw config value from `channels.json`
- AC4: "Risky configs" panel lists projects with bypass mode or wildcard allow (sorted by risk level)
- AC5: Column headers are tool names; truncated to 12 chars with full name on hover
- AC6: Matrix scrollable horizontally when tool count exceeds viewport
- AC7: Export as CSV: project × tool permission matrix

---

## P101 — Full Conversation History Viewer

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The existing `/projects/[slug]/terminal` shows the live tmux pane and the transcript endpoint returns only the last 20 entries. There is no way to browse the full conversation history between operator and Claude for a given project in a readable, chat-like UI. Debugging agent behavior requires SSH and manual JSONL parsing.

### Proposed Solution

Add a `/projects/[slug]/conversation` page with a paginated chat log. A new `/api/projects/[slug]/conversation` endpoint reads all JSONL transcript files, extracts `human` and `assistant` turns (including tool calls inline), and returns them newest-first with cursor-based pagination. The page renders messages as a chat thread: human turns left-aligned (cyan), assistant turns right-aligned (slate), tool calls shown as collapsed inline chips (expand on click). Date separators between calendar days. Search bar filters by content (client-side). Scroll to top loads older messages.

### Acceptance Criteria

- AC1: `/projects/[slug]/conversation` page renders newest messages first; linked from per-project detail
- AC2: Human/assistant turns distinguishable by alignment and color
- AC3: Tool use blocks rendered as collapsed chips showing tool name + truncated input; expand on click
- AC4: Date separator lines between calendar days
- AC5: "Load older" button (or scroll-triggered) fetches prior page via cursor
- AC6: Search bar filters visible messages by content (client-side, debounced 300ms)
- AC7: Empty state when no transcript found for slug

---

## P102 — Inject Template Library

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators repeatedly type the same inject messages: daily standup prompts, code review requests, status checks, progress reports. The Inject Terminal (P7) has no memory — every session starts blank. There is no way to save, organize, or quickly reuse inject phrases across projects.

### Proposed Solution

Add a template library to the Inject Terminal drawer. A new `/api/inject-templates` endpoint (CRUD) stores templates in `~/.claude/channels/discord-multi/inject-templates.json`. Each template has: name (1–40 chars), body (with optional `{{slug}}`, `{{date}}`, `{{time}}` placeholders), category tag, use count, last-used timestamp. The Inject Terminal gains a "Templates" button that opens a searchable panel: click a template to insert (with variables resolved) into the message box. A `/inject-templates` management page lists all templates with edit/delete and a use-count leaderboard.

### Acceptance Criteria

- AC1: "Templates" button in Inject Terminal opens searchable template panel
- AC2: Clicking a template inserts it into the message box with `{{slug}}`, `{{date}}`, `{{time}}` resolved
- AC3: `/api/inject-templates` supports GET (list), POST (create/update), DELETE (by id)
- AC4: Templates stored in `inject-templates.json`; survive server restarts
- AC5: `/inject-templates` page: list all templates, edit name/body, delete, show use count + last used
- AC6: Category filter chips (e.g. standup / review / report / custom) on both panel and management page
- AC7: "Use count" shown on each template; incremented on each use

---

## P103 — Fleet Anomaly Detection

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The dashboard shows current state but cannot tell operators when a project is behaving unusually compared to its own history. A project that normally turns every 2 minutes but suddenly goes silent for 30 minutes might not be stalled yet — but it is anomalous. Statistical deviation from a project's own baseline is a strong early-warning signal that no current view surfaces.

### Proposed Solution

Add an `/anomalies` page powered by a new `/api/anomalies` endpoint. The endpoint reads transcript JSONL for each project, computes 7-day baseline stats (mean and stddev of: turn duration, tool calls per turn, tokens per turn), then flags any project whose last 3 turns deviate > 2σ from its baseline in any dimension. Each anomaly entry includes: slug, metric name, current value, baseline mean, z-score, severity (warn ≥ 2σ, critical ≥ 3σ). The InstanceGrid adds an amber ⚠ icon on anomalous projects. The `/anomalies` page shows a table sortable by z-score with sparkline of the anomalous metric.

### Acceptance Criteria

- AC1: `/anomalies` page renders within 3s; all projects with ≥ 7 days of data included
- AC2: Anomaly detected when last 3-turn mean deviates > 2σ from 7-day baseline
- AC3: Metrics checked: inter-turn gap minutes, tool calls per turn, output tokens per turn
- AC4: Table columns: project, metric, current value, baseline (mean ± σ), z-score, severity
- AC5: Sort by z-score descending; severity color: amber ≥ 2σ, red ≥ 3σ
- AC6: Sparkline showing the metric over last 20 turns with anomaly region highlighted
- AC7: Empty state ("No anomalies detected") with last-checked timestamp

---

## P104 — Project Relationship Radial Map

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Each project is an island in the current UI. There is no single view that holistically shows a project's connections to memories, goals, scheduled jobs, recent injects, open PRs, and sibling proposals. Operators switch between many pages to understand one project's full context.

### Proposed Solution

Add a `/projects/[slug]/map` page with a radial mind map. The center node is the project. Radiating out: memory nodes (purple, from memory/ dir), goal node (amber), schedule nodes (green), recent inject nodes (cyan, last 5 injects from alert log), open branch nodes (blue, from git branches API), proposal nodes (orange, proposals mentioning the slug). Node sizes encode recency/size. Clicking any satellite node opens a detail drawer. SVG rendering, no external library. Pan and zoom via mouse wheel + drag.

### Acceptance Criteria

- AC1: `/projects/[slug]/map` page renders radial SVG within 2s; linked from per-project detail
- AC2: Center node shows slug + state color; satellite node types: memory, goal, schedule, inject, branch, proposal
- AC3: Clicking a satellite opens a side drawer with the full detail (memory body, goal text, schedule prompt, etc.)
- AC4: Pan (drag canvas) and zoom (mouse wheel or +/- buttons) with smooth transform
- AC5: Node count shown in legend; "no data" nodes omitted with empty-type indicators shown greyed out
- AC6: Refresh button re-fetches all data without page reload
- AC7: Deep-link: `/projects/[slug]/map?focus=memories` pre-expands that node type

---

## P105 — Agent Health Trend Timeline

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Health Score Ring (per-project and fleet-level) shows the current score but has no historical view. A project's health score could have been declining for a week before it finally stalls — the operator has no way to see that trend without manual transcript analysis. Point-in-time scores cannot distinguish a recovering agent from a deteriorating one.

### Proposed Solution

Add a `/health-trends` page with per-project health score time series. A new `/api/health/trends` endpoint computes a daily health score snapshot for each project across the last 30 days, reading transcript JSONL bucket by day (reusing the `dayBuckets` logic from `/api/metrics/[slug]`). Four sub-scores tracked daily: recency (hours since last turn), stall rate (stalls/turns), efficiency (output tokens/tool call), freshness (new memories in last 24h). Each project renders as a sparkline row. A "deep dive" mode selects one project and shows all four sub-scores as separate trend lines.

### Acceptance Criteria

- AC1: `/health-trends` page renders within 3s; all projects shown as sparkline rows
- AC2: Each row: slug badge, 30-day health score sparkline (line graph), current score, trend arrow (↑↓→)
- AC3: Color encodes trend: green (improving ≥ 5pts over 7d), red (declining), grey (flat)
- AC4: Click a row enters "deep dive" mode: four sub-score trend lines (recency, stall rate, efficiency, freshness) as a multi-line chart
- AC5: Hover on any sparkline point shows: date, score, sub-score breakdown tooltip
- AC6: Sort rows by: current score (default), trend magnitude, slug
- AC7: Export as CSV: slug × date health score matrix

---

## P106 — Cross-Project Message Dependency Graph

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When the operator broadcasts a message or injects context from one project into another, there is no way to visualize which projects depend on information from which other projects. Cross-pollination is invisible, making it hard to understand information flow or reason about cascading effects when one project's context changes.

### Proposed Solution

Add a `/dependency-graph` page that renders a directed graph of inter-project message flows. Read `inject` history from each project's transcript JSONL (look for `mcp__mcd__inject` tool calls which include a `source` slug field). Build an adjacency list of `source → target` edges. Render with a D3-force simulation: nodes = project slugs (colored by state), edges = inject flows (label: count). Edge thickness proportional to inject frequency. Clicking a node highlights its direct in/out edges and shows a side panel with inject count, last inject date, and the most recent injected message snippet.

### Acceptance Criteria

- AC1: `/dependency-graph` page renders within 3s; force layout settles within 2s
- AC2: Nodes colored by project state (idle/active/stalled/autonomous) matching fleet badge colors
- AC3: Directed edges with arrowheads; edge thickness = log(inject_count); hover shows count + last date
- AC4: Click a node: highlights in/out edges (others dim to 15% opacity), side panel shows inject history
- AC5: "Reset" button returns to full graph view
- AC6: Node count + edge count shown in top-right legend
- AC7: Added to NavDropdown → Observability

---

## P107 — Live Token Burn Rate Gauge

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Metrics page shows historical token totals and cost estimates but there is no real-time view of how fast tokens are being consumed right now. Operators cannot tell if the fleet is in a quiet period or actively burning through budget without navigating to individual project pages.

### Proposed Solution

Add a `TokenBurnGauge` component to the fleet header (next to fleet health badges). The gauge shows tokens/minute for the last 5 minutes, computed from the fleet broadcaster's SSE stream. A rolling 5-minute window of tool_result + assistant events from all active projects feeds a live tokens/min number. Display as a horizontal bar with color zones: green (<500 tok/min), amber (500–2000), red (>2000). Also add a `/api/burn-rate` endpoint that returns `{ tokensPerMin: number, activeProjects: number, windowMs: number }`.

### Acceptance Criteria

- AC1: `TokenBurnGauge` appears in fleet header; updates every 5s from SSE stream
- AC2: Color zones: green <500, amber 500–2000, red >2000 tok/min
- AC3: Tooltip on hover shows: "X tok/min over last 5 min (N active projects)"
- AC4: `/api/burn-rate` endpoint returns current rate, active project count, window duration
- AC5: Gauge shows "—" when no SSE data for > 30s (server disconnect)
- AC6: On mobile (< 640px), gauge collapses to a colored dot in the header

---

## P108 — Project Lifecycle Heatmap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The fleet has projects that were created at different times and have different activity patterns. There is no holistic view of when each project was most active across its entire lifetime. The existing Turn Volume page shows fleet-level activity but not per-project temporal patterns.

### Proposed Solution

Add a `/lifecycle-heatmap` page with a GitHub-style contribution heatmap per project. X-axis = weeks (up to 52 weeks back), Y-axis = projects. Each cell = turn count for that week. Color: white (0), light cyan (1–5), medium cyan (6–20), bright cyan (>20), with a glowing effect on the max cell. Hovering a cell shows: project slug, week, turn count. Projects sorted by creation date (oldest first). A "normalize" toggle scales each row independently (showing relative activity pattern) vs fleet-absolute scale.

### Acceptance Criteria

- AC1: `/lifecycle-heatmap` renders within 3s; up to 52 columns × N project rows
- AC2: Color scale: 0=transparent, 1–5=dim, 6–20=mid, >20=bright with glow
- AC3: Hover tooltip: slug, ISO week, exact turn count
- AC4: Toggle between absolute and per-row normalized color scales
- AC5: Y-axis labels (slug) link to `/projects/[slug]`
- AC6: Added to NavDropdown → Observability

---

## P109 — Memory Decay Visualizer

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Project memories accumulate over time but there is no view of which memories are "fresh" vs "stale" or likely to be forgotten. Operators cannot tell which projects need a memory refresh or which memories are anchoring outdated assumptions.

### Proposed Solution

Add a `/memory-decay` page. For each project, list its memory files sorted by staleness (mtime). Render each memory as a card with a decay bar: bright green (written today) fading to red (>60 days). Cards show: slug, memory name, age in days, first 2 lines of body. A "most stale" section shows the top 10 stalest memory files fleet-wide. A "refresh needed" flag appears on any project with >50% of memories older than 30 days. Clicking a card expands to show full memory body.

### Acceptance Criteria

- AC1: `/memory-decay` renders within 3s; shows all projects with at least one memory file
- AC2: Decay bar color: green (0–7d), yellow (7–30d), red (>30d), based on mtime
- AC3: "Most stale" fleet leaderboard shows top 10 oldest individual memories with slug + age
- AC4: "Refresh needed" badge on projects with majority of memories > 30d old
- AC5: Click card expands full body (no navigation away)
- AC6: Sort: by most stale project (default), by most memories, by slug
- AC7: Added to NavDropdown → Intelligence

---

## P110 — Conversation Turn Diff Viewer

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When reviewing a project's session history in the Session Replay page, it is hard to see what changed between consecutive assistant turns — what new tool calls were added, what output changed, how the context evolved. Debugging stuck agents or unusual behavior requires manually comparing turns.

### Proposed Solution

Add a diff mode to the Session Replay page. When two turns are selected (hold shift and click a second turn), render a side-by-side diff of their `tool_use` arrays and text content. Highlight new tool calls in green, removed tool calls in red, changed input parameters in amber. Also show token delta (Δ input, Δ output) between the two turns. A "diff URL" button copies a deep link with `?from=<turn_idx>&to=<turn_idx>` so operators can share specific comparisons.

### Acceptance Criteria

- AC1: Shift-click second turn in replay page activates diff mode; side-by-side view replaces single-turn view
- AC2: New tool calls highlighted green, removed red, changed amber (input param diff)
- AC3: Token delta shown: `Δ in: +1234 / Δ out: −456`
- AC4: "Copy diff link" button generates `?from=X&to=Y` deep link
- AC5: "Exit diff" button returns to single-turn view
- AC6: Works with keyboard: D key toggles diff mode when two turns are selected

---

## P111 — Keyboard Shortcuts Reference Modal

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The dashboard exposes a growing set of keyboard shortcuts (`V` for nav, `A` for advisor, `T` for thought stream, `B` for backlog overlay, `Ctrl+K` for command palette, arrow keys in replay, `D` for diff mode) but there is no discoverable reference. New operators learn shortcuts by reading source code or documentation. There is no in-app way to see what shortcuts are available on the current page.

### Proposed Solution

Add a `?` key that opens a full-screen modal listing all keyboard shortcuts grouped by context: **Global** (V, A, Ctrl+K, Esc), **Graph** (T, B, Pulse toggle), **Replay** (←/→, D, Space for autoplay), **Diff** (D, Esc). Each shortcut row shows: key badge, description, which page/component it applies to. Modal closeable with `?` or `Esc`. A `?` icon button in the dashboard header also opens it. Shortcut definitions stored in a single `keybindings.ts` constant so they stay in sync between the modal and the actual handlers.

### Acceptance Criteria

- AC1: `?` key (and `?` header button) opens the shortcuts modal from any dashboard page
- AC2: Modal lists all shortcuts grouped by context (Global / Graph / Replay / Replay-Diff)
- AC3: Each row shows: key badge, description, applicable page/component
- AC4: Modal closeable with `?` or `Esc`; backdrop click also closes
- AC5: No new shortcuts are added — modal only documents existing ones
- AC6: `keybindings.ts` is the single source of truth for shortcut definitions used by both the modal and the actual event listeners

---

## P112 — In-App Notification Center

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Browser push notifications (P29) fire when a stall is detected, but once dismissed they are gone. Budget alerts (P40), circuit-open events (P35), and watchdog kills are surfaced only in the live dashboard views — there is no persistent bell-style inbox. Operators who acknowledge a notification cannot revisit what triggered it without navigating to the audit log.

### Proposed Solution

Add a notification bell icon in the dashboard header (right of the `?` button). Clicking opens a slide-down panel listing the last 50 alerts with: timestamp, type badge (stall/budget/circuit/watchdog), project slug, and a description. Unread count shown as a red badge on the bell. Notifications sourced from the SSE `stall-alert`, `budget-alert`, and `circuit-open` events (already emitted by P28/P35/P40). Stored in a `useRef`-backed ring buffer in `FleetContext`; no new server state. Each notification has a "Mark read" (×) button; "Mark all read" in panel header. Notification state stored in `sessionStorage` (clears on tab close, intentionally ephemeral).

### Acceptance Criteria

- AC1: Bell icon in header shows unread count badge (red, pulsing when > 0)
- AC2: Click bell opens notification panel; lists last 50 events newest-first
- AC3: Each notification: timestamp, type badge (color-coded), slug, description
- AC4: Clicking a notification slug navigates to `/?project=<slug>` and marks it read
- AC5: "Mark all read" button clears unread count
- AC6: Notifications sourced from SSE events already in `FleetContext`; no new API needed
- AC7: Panel closes on `Esc` or click outside

---

## P113 — CLAUDE.md Template Library

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Every new project needs a CLAUDE.md system prompt. Operators currently either copy-paste from an existing project or write from scratch. The CLAUDE.md Live Editor (P48) lets operators edit, but there is no template bank. Common prompt patterns (coding assistant, research agent, code reviewer, autonomous builder) are reimplemented manually per project, leading to inconsistency.

### Proposed Solution

Add a `/claude-templates` management page and a template picker to the CLAUDE.md editor (P48). Templates stored in `~/.claude/channels/discord-multi/claude-templates.json`. Each template has: name, description, category (coding/research/review/custom), body. A `/api/claude-templates` endpoint provides CRUD. The CLAUDE.md editor gains a "Load template" button that opens a searchable modal listing templates; selecting one populates the editor (with confirmation if there is existing content). A "Save as template" button saves the current CLAUDE.md as a new template. Built-in read-only templates: `coding-agent`, `research-agent`, `code-reviewer`.

### Acceptance Criteria

- AC1: `/claude-templates` page lists all templates with name, category, description, action buttons (edit/delete/use)
- AC2: "Load template" button in CLAUDE.md editor opens searchable modal; selecting a template populates textarea (confirms if content present)
- AC3: "Save as template" button saves current content with a name + category prompt
- AC4: `/api/claude-templates` supports GET, POST (create/update), DELETE
- AC5: Templates stored in `claude-templates.json`; survive restarts
- AC6: 3 built-in read-only templates included (coding-agent, research-agent, code-reviewer)
- AC7: Category filter chips on management page and picker modal

---

## P114 — Turn Annotation System

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Session Replay (P89) and Conversation History Viewer (P101) show turns but operators have no way to flag interesting turns, mark regressions, or attach notes. Debugging an agent's behavior requires remembering which turn showed the problem — without annotation, operators re-read the same conversation repeatedly.

### Proposed Solution

Add a turn annotation system. Operators can click a `🏷` flag icon on any turn in the Replay or Conversation viewer to open a small popover with: a text input (max 200 chars), a severity tag selector (note/warning/bug), and save/cancel buttons. Annotations stored in `mc.db` (`turn_annotations` table: `id, slug, sessionFile, turnIndex, tag, note, createdAt`). A `/api/annotations` CRUD endpoint. Annotated turns show a colored tag chip. A `/annotations` page lists all annotations fleet-wide, filterable by slug and tag. Annotations survives session restarts.

### Acceptance Criteria

- AC1: 🏷 icon on each turn in Replay and Conversation viewer; click opens annotation popover
- AC2: Popover: text input (max 200 chars), tag selector (note=cyan/warning=amber/bug=red), Save/Cancel
- AC3: Saved annotation shows as colored chip on the turn (color matches tag)
- AC4: `turn_annotations` table in `mc.db`; `/api/annotations` supports GET/POST/DELETE
- AC5: `/annotations` page lists all annotations fleet-wide; filter by slug + tag; sort by date
- AC6: Clicking an annotation row opens Replay at that turn (`?turn=<index>` deep link)

---

## P115 — Outbound Webhook Alerts

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Critical fleet events (stall detected, circuit-open, budget exhausted, watchdog kill) are surfaced only inside the dashboard. Teams using Slack, PagerDuty, or other incident management tools have no way to receive these alerts without keeping the dashboard open. The only external notification is the Discord master-channel message, which requires the operator to be in Discord.

### Proposed Solution

Add a `/admin/webhooks` sub-page to the admin panel. Operators register webhook URLs (HTTP POST endpoints) with a name, URL, and an event-type filter (stall/budget/circuit/watchdog/all). Webhooks stored in `mc.db` (`webhooks` table). When a matching SSE event fires server-side (inside the fleet broadcaster), the server POSTs a JSON payload `{ event, slug, timestamp, detail }` to all registered URLs with a 5s timeout. Delivery status (success/fail/timeout) logged per webhook per event. A "Test" button sends a sample payload. Supports Slack-compatible format (optional `useSlackFormat` flag that wraps the payload in `{ text: "..." }` with emoji).

### Acceptance Criteria

- AC1: `/admin/webhooks` page: list registered webhooks with name, URL (masked), event filter, last delivery status
- AC2: "Add webhook" form: name, URL, event filter (multiselect), optional Slack format toggle
- AC3: Webhook fired server-side on matching events (stall/budget/circuit/watchdog); 5s timeout; failure logged
- AC4: `webhooks` table in `mc.db`; delivery log in `webhook_deliveries` table
- AC5: "Test" button sends `{ event: "test", slug: "test", timestamp: "...", detail: "Test webhook delivery" }` to the URL
- AC6: Slack format wraps payload as `{ text: "⚠ [slug] stall detected: <detail>" }` when enabled
- AC7: Delivery log visible per webhook: last 20 deliveries with status and response code

---

## P116 — Agent Collaboration Network

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators can see individual project health (fleet grid, 3D graph, galaxy) and per-project knowledge (knowledge graph), but have no view of *how projects relate to each other* — shared knowledge domains, aligned goals, or overlapping proposal topics. Two projects might be solving identical problems in parallel, or could usefully share context, with no way to notice.

### Proposed Solution

Add a `/collaboration` page with a D3 force-directed graph. **Nodes** = projects (sized by activity level). **Edges** = cross-project topic overlap extracted from memory files, GOAL.md, and specclaw proposals. Edge thickness scales with similarity score; edge color encodes connection type: memory-overlap (purple), goal-overlap (cyan), proposal-overlap (amber). Clicking an edge opens a popover listing the shared keywords. Sidebar shows legend + min-score threshold slider to declutter weak links. A new `/api/collaboration-graph` endpoint reuses the keyword-extraction logic from `/api/similarity` but builds a graph structure with typed edges.

### Acceptance Criteria

- AC1: `/collaboration` page renders D3 force-directed graph; nodes = projects, edges = topic connections
- AC2: Edge color: purple=memory, cyan=goal, amber=proposal; edge thickness proportional to similarity score
- AC3: Click edge → popover lists shared keywords (max 10) and connection types present
- AC4: Sidebar: legend, min-score threshold slider (0–1, default 0.1), connection-type checkboxes (memory/goal/proposal)
- AC5: `/api/collaboration-graph` returns `{ nodes, edges: [{source, target, score, types, sharedKeywords}] }`; header link from `/graph` page

---

## P117 — Fleet Mind Map

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Understanding the full "knowledge state" of the fleet requires navigating multiple pages: knowledge graph for memory, goals page for GOAL.md content, backlog/proposal-graph for proposals. No single view gives operators a holistic picture of what each project is trying to do and what it knows.

### Proposed Solution

Add a `/mindmap` page with a radial D3 tree layout. The center node is "Fleet". First ring = project nodes. Each project node expands into three branch types: **GOAL** (active goal text truncated), **MEMORY** (top 3 memory entry titles), **PROPOSALS** (open proposal titles from .specclaw). Clicking a branch node navigates to the relevant detail page. Toggle controls hide/show each branch type. Node coloring matches existing cyber-cyan palette. `/api/mindmap` aggregates data from fleet API + memory files + .specclaw STATUS.md.

### Acceptance Criteria

- AC1: `/mindmap` page renders D3 radial tree; center=Fleet, ring-1=projects, ring-2=branches (goal/memory/proposals)
- AC2: Branch toggle bar: GOAL (cyan), MEMORY (purple), PROPOSALS (amber); each toggle shows/hides that ring globally
- AC3: Clicking a project node navigates to `/projects/<slug>`; clicking a memory node navigates to `/knowledge?slug=<slug>`; clicking a proposal node navigates to `/pipeline?slug=<slug>`
- AC4: `/api/mindmap` returns `{ nodes, links }` with type annotations; refreshes every 60s
- AC5: Node label truncated to 24 chars with tooltip on hover showing full text

---

## P118 — Mission Sequence Planner

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The backlog has 115+ proposals with dependencies (cross-refs between P-numbers) but no way to sequence them visually. Operators can't see what to build next, what depends on what, or estimate a rough schedule across categories. The proposal-graph shows connections but not ordering or effort.

### Proposed Solution

Add a `/sequence` page with two panels: left panel = filterable proposal list (by category/status); right panel = horizontal Gantt-style swim lanes (one lane per category). Drag proposals from the list into a lane to schedule them in order. An "effort" chip on each card (S/M/L, editable inline) determines its width. Dependency arrows render between cards that reference each other (P-number cross-refs). An "Export" button copies the sequence as a markdown schedule. State persisted in localStorage (no server write required).

### Acceptance Criteria

- AC1: `/sequence` page: left proposal list (filter by category/status), right Gantt lanes (one per category)
- AC2: Drag proposals from list onto lanes; order within lane is preserved; duplicates prevented
- AC3: Effort chip (S=1w / M=2w / L=4w) on each card; click to cycle; card width scales with effort
- AC4: Dependency arrows rendered between cards that cross-reference each other (P-number regex)
- AC5: "Export" button copies markdown table: `| P# | Title | Category | Effort | Depends On |` to clipboard

---

## P119 — Project Deep Dive Modal

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Seeing full context for a project — goal, recent conversation turns, memory summary, and active proposals — requires navigating to 4+ different pages. When operators need to decide whether to inject a message or check project status, the context-gathering overhead is high.

### Proposed Solution

Add a "Deep Dive" slide-out drawer (full right-panel, 480px wide) accessible from any InstanceGrid card via a `[D]` button or keyboard shortcut `Shift+D` while hovering a card. The drawer shows: (1) goal chip with status toggle, (2) last 5 conversation turns (summary from .jsonl transcript), (3) top 5 memory entry titles + first line, (4) active proposals from `.specclaw/STATUS.md`, (5) quick-inject textarea with send button. A new `/api/projects/[slug]/deepdive` endpoint aggregates all data in one call.

### Acceptance Criteria

- AC1: `[D]` button on InstanceGrid card opens deep-dive drawer; `Escape` closes; drawer is scrollable
- AC2: Goal section: text + status pill (active/paused/completed), editable inline (mirrors P44 goal editor)
- AC3: Turns section: last 5 turns from .jsonl, each showing role (user/assistant), first 120 chars, timestamp
- AC4: Memory section: top 5 memory entries (title + first line); "View All" links to `/knowledge?slug=<slug>`
- AC5: Quick-inject form: textarea pre-filled with `[OPERATOR]` prefix; "Send" calls `POST /api/inject/<slug>`; response shown inline

---

## P120 — Fleet Convergence Score

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators have no single metric for whether the fleet is making *meaningful progress toward its goals* versus spinning on tool calls or waiting for input. Activity metrics (turns/hour, tool calls) measure busyness, not effectiveness. A project could have 200 turns and still be stuck in a loop making no progress on its stated goal.

### Proposed Solution

Add a "Convergence Score" per project: ratio of goal-advancing turns (turns where `mcp__mcd__reply` was called AND the reply text matches ≥1 goal keyword) to total turns in the last 24h. Score 0–100. Fleet score = weighted average (weight = turn count). Surface as: (1) a `convergenceScore` field in `/api/fleet`, (2) a large animated radial gauge on the main dashboard summary bar, (3) a trend sparkline (7-day history stored in `mc.db`). Projects with score < 20 for 2+ consecutive hours trigger a `convergence-alert` SSE event.

### Acceptance Criteria

- AC1: `convergenceScore: number` (0–100) added to `/api/fleet` `FleetProject`; fleet-level `avgConvergence` in root response
- AC2: Main dashboard shows fleet convergence gauge (radial, animated fill) next to the health bar; color green/amber/red by score band
- AC3: Per-project convergence chip visible in InstanceGrid card (small pill, color-coded)
- AC4: `convergence_history` table in `mc.db`: `(slug, date, score)`; 7-day sparkline on project detail page
- AC5: Score < 20 for ≥2h emits `convergence-alert` SSE event and posts master-channel notification (once per 6h per project)

---

## P121 — Live Fleet Topology Map

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Existing graph views (collaboration network, mind map, proposal graph) show static relationships computed from files. Operators have no real-time view of *active* cross-project message flows: which projects are referencing each other right now, which are silent, and which are blocked waiting for input. This makes coordinating parallel work streams opaque.

### Proposed Solution

Add a `/topology` page with a force-directed graph that updates live via SSE. Nodes = active projects, sized by turns/hour. Animated particle streams flow along edges when a project sends an inject or references another project's slug in a reply. Node border pulses cyan when a reply was sent in the last 30s; red when stuck (convergence < 20). Sidebar shows a live event log (project + action + timestamp). Edge weight = message volume in last 10 min. Controls: pause animation, filter by status (active/idle/stuck), time-window selector (last 1m/5m/15m).

### Acceptance Criteria

- AC1: `/topology` page renders force-directed graph; nodes = projects, edges = cross-project references; auto-refresh every 5s via SSE or polling
- AC2: Node size scales with turns/hour (last 1h); node border color: cyan=active (<30s reply), amber=idle, red=stuck (convergence <20)
- AC3: Animated SVG particles flow along edges when activity detected; particle count proportional to message volume
- AC4: Sidebar live event log: scrollable list of (project slug, action type, timestamp), max 50 entries, newest first
- AC5: Controls: pause/play button, status filter chips (active/idle/stuck), time-window dropdown (1m/5m/15m); `/api/topology` endpoint returns `{ nodes, edges, events }`

---

## P122 — Goal Achievement Radar

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Goals are tracked as free-text GOAL.md files with no structured progress measurement. Operators can't tell whether a project is 10% or 90% toward its stated goal, compare goal health across projects, or detect projects that have silently drifted from their goals. The convergence score (P120) measures turn efficiency but not goal *specificity*.

### Proposed Solution

Add a `/goal-radar` page with two panels. Left: a D3 radar chart (spider chart) where each axis = a project, and the plotted value = estimated goal advancement (0–100). Advancement = keyword overlap between the last 20 replies and the GOAL.md text, normalized by goal length. Right: per-project goal detail card showing GOAL.md text, top 5 matched keywords, advancement %, and a 7-day advancement sparkline. A "Reset Baseline" button re-anchors the keyword model to today's replies. Fleet-wide radar renders one polygon per project; colors match the existing palette.

### Acceptance Criteria

- AC1: `/goal-radar` page: D3 radar chart with one axis per project; plotted value = goal advancement score (0–100)
- AC2: Goal advancement = keyword overlap between last 20 replies and GOAL.md, normalized; stored in `goal_advancement` table in `mc.db` (slug, date, score)
- AC3: Right panel: per-project card with GOAL.md text snippet, top-5 matched keywords highlighted, advancement %, 7-day sparkline
- AC4: `/api/goal-radar` returns `{ projects: [{ slug, goalText, score, keywords, history }] }`; refreshes every 60s
- AC5: Fleet summary bar shows average goal advancement next to convergence gauge (from P120); color-coded green/amber/red

---

## P123 — Context Window Pressure Monitor

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Claude projects silently approach context window limits with no operator visibility. When a project nears its context ceiling, turn quality degrades, tool calls get dropped, and the session eventually fails. Operators discover this only after observing erratic behavior, not proactively.

### Proposed Solution

Add a `/context-pressure` page showing a per-project stacked bar chart of estimated context window usage: system prompt tokens (fixed), conversation history tokens (grows), tool result tokens (variable). Estimates derived from `.jsonl` transcript byte counts (rough proxy). A "pressure score" 0–100 = `used / max_context`. Projects over 70% show an amber warning; over 90% show a red alert + trigger a `context-pressure` SSE event. A "Compact" button sends a `[OPERATOR] Please summarize your context and continue.` inject. 7-day trend line shows pressure growth rate.

### Acceptance Criteria

- AC1: `/context-pressure` page: stacked bar chart per project (system/history/tool segments); bar color green/amber/red by pressure score
- AC2: Pressure score = estimated tokens used / model context limit; stored in `context_pressure` table (slug, timestamp, score, breakdown JSON)
- AC3: Projects > 70% show amber chip in InstanceGrid; > 90% emit `context-pressure` SSE event and post master-channel DM (once per 2h)
- AC4: "Compact" quick-action button per project calls `POST /api/inject/<slug>` with summary prompt; visible in both this page and the deep-dive drawer (P119)
- AC5: `/api/context-pressure` returns `{ projects: [{ slug, score, segments, trend }] }`; 7-day trend line rendered per project

---

## P124 — Multi-Project Narrative Timeline

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators managing 5+ parallel projects have no unified chronological view of what happened across the fleet. Each project's conversation is isolated in its own turn viewer. Reconstructing a "story" of a day's work — which project advanced, when, what was said — requires clicking through individual project pages.

### Proposed Solution

Add a `/narrative` page with a single vertical timeline showing all projects' turns interleaved chronologically. Each entry is a "turn card": project badge (color-coded), role (user/assistant), first 140 chars of text, timestamp, and a `[→]` link to the full turn viewer. Filter bar: date-range picker, project multi-select, role filter (user/assistant/tool), keyword search. Virtualized scroll (react-virtual or similar) for large turn sets. "Playback" mode steps through turns at 1×/5×/10× speed with auto-scroll — useful for post-mortem reviews. Export as markdown log.

### Acceptance Criteria

- AC1: `/narrative` page: virtualized timeline of all projects' turns interleaved by timestamp; each card shows project badge, role, text preview (140 chars), timestamp
- AC2: Filter bar: date-range picker (default today), project multi-select, role filter (user/assistant), keyword search (client-side); filters persist in URL params
- AC3: "Playback" mode: play/pause button, speed selector (1×/5×/10×); auto-scrolls through turns at selected speed; current card highlighted
- AC4: `[→]` link on each card navigates to `/turns?slug=<slug>&turn=<id>`; keyboard shortcut `J`/`K` to step through turns
- AC5: `/api/narrative` returns paginated `{ turns: [{ slug, role, text, ts, turnId }], total, nextCursor }`; page size 100

---

## P125 — Fleet Command Palette

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Navigating Mission Control requires multiple clicks: open nav, find page, click in, interact. Power operators — especially those managing 10+ projects — lose significant time to navigation overhead. Keyboard-driven workflows are impossible without a unified command interface.

### Proposed Solution

Add a global command palette triggered by `Cmd+K` / `Ctrl+K` on any MC page. Fuzzy-search across: (1) page navigation ("go to metrics", "open mindmap"), (2) project quick-actions ("inject message to claude-mcd", "stop project foo", "show deep dive for bar"), (3) recent turns search ("find turns mentioning 'deployment'"), (4) !project commands executed server-side ("!project list", "!project ps"). Results grouped by type with keyboard navigation (up/down arrows, Enter to execute). Overlay renders as a centered modal with blurred backdrop; `Escape` closes. Command history stored in localStorage (last 20).

### Acceptance Criteria

- AC1: `Cmd+K`/`Ctrl+K` opens command palette overlay on any MC page; `Escape` closes; overlay has blurred backdrop and cyber-themed border
- AC2: Fuzzy search across: navigation targets (all MC pages), project names, and static !project command templates; results grouped by type with icons
- AC3: Project quick-actions: "inject <slug>", "stop <slug>", "deep dive <slug>" — inject opens pre-filled inject modal; stop calls `POST /api/stop/<slug>`; deep dive opens the P119 drawer
- AC4: `!project` command execution: typing `!project <verb>` → execute button → calls `POST /api/master-command` → streams output in palette result area
- AC5: Keyboard navigation: up/down arrows move selection; Enter executes; command history (last 20) shown when query is empty; history stored in localStorage

---

## P126 — Turn Quality Heatmap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The narrative timeline (P124) shows turns in order but gives no signal about *quality*. Operators can't tell at a glance which turns were productive vs. stuck loops vs. brief acks. After post-mortem reviews, the only way to find "the turn where it went wrong" is to read each card manually.

### Proposed Solution

Add a `/turn-quality` page showing a 2-D heatmap: X-axis = time of day (hour buckets), Y-axis = project slug, cell color = average turn quality score for that hour. Quality score = composite of: reply length (proxy for depth), tool-call count, and absence of error keywords ("Error", "failed", "undefined"). Cell tooltip shows the 3 highest-quality and 3 lowest-quality turn previews for that hour. Click a cell opens the Narrative Timeline filtered to that slug + hour window.

### Acceptance Criteria

- AC1: `/turn-quality` page: 2-D heatmap grid (projects × hours), cells colored green/amber/red by average quality score
- AC2: Quality score per turn = `0.4 * (replyLenScore) + 0.3 * (toolCallDensity) + 0.3 * (1 - errorRatio)`; stored in `turn_quality` table (slug, ts, score)
- AC3: Cell tooltip on hover: top-3 and bottom-3 turn text previews for that project/hour bucket
- AC4: Click cell → opens `/narrative?slug=<slug>&since=<hourStart>&until=<hourEnd>` in same tab
- AC5: `/api/turn-quality` returns `{ rows: [{ slug, hour, score, turnCount }] }` for past 24h; refresh every 5 min

---

## P127 — Session Health Dashboard

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators have no single page that aggregates all health signals for a specific project session: context pressure, convergence trend, stuck events, goal advancement, alert history, and recent errors in one place. Diagnosing a struggling project requires clicking through 6+ pages to assemble a picture.

### Proposed Solution

Add a `/session-health/[slug]` page as a per-project health aggregate. Top section: 4 KPI cards (context pressure %, convergence score, goal advancement %, active turns today). Middle: sparklines for each metric over the last 7 days. Bottom: recent alert events list + last 5 stuck events from the `.jsonl` transcript. A "Session Actions" panel offers: Compact, Stop, Restart, Inject buttons. Link from the InstanceGrid card "⚕" chip.

### Acceptance Criteria

- AC1: `/session-health/[slug]` page: 4 KPI cards (context %, convergence, goal %, turns today) + 7-day sparklines for each
- AC2: Recent alerts section: last 10 `alert_events` rows for the slug, with type badge and description
- AC3: Stuck events section: last 5 times a "stuck" keyword appeared in the transcript, with timestamp and surrounding text snippet
- AC4: Session Actions panel: Compact (inject summary prompt), Stop (`POST /api/stop/<slug>`), Inject (opens inject modal); buttons disable after click for 3s
- AC5: InstanceGrid card gains a `⚕` chip linking to `/session-health/<slug>`; chip color matches context pressure score

---

## P128 — Operator Digest Email / Webhook Summary

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators are not always watching Mission Control. Fleet events (stuck agents, context pressure warnings, goal drift) accumulate silently. The existing webhook system (P87) fires raw JSON per event but produces noise without aggregation. There is no "morning brief" that summarizes overnight activity.

### Proposed Solution

Add a scheduled digest job (configurable: daily 08:00 UTC or on-demand via `POST /api/digest`) that compiles: projects with score changes > 10% (convergence, goal, context), stuck events since last digest, new alert events, and top-5 most active slugs. Digest is rendered as a Markdown-formatted summary, then pushed to configured webhook URLs with `event_type = "digest"` (which Slack-formatted webhooks render nicely). Digest history stored in `digest_log` table; viewable at `/reports`.

### Acceptance Criteria

- AC1: `POST /api/digest` computes and stores a digest; `GET /api/digest/latest` returns the last one; digest rendered in `/reports` page with a "Digest" tab
- AC2: Digest content: projects with metric changes > 10%, stuck events count, alert events count, top-5 active slugs by turn count
- AC3: Digest pushed to all webhooks where `event_filter` includes `"digest"` or `"*"`; Slack-formatted version uses blocks API
- AC4: Scheduler entry at `08:00` UTC sends digest automatically; configurable via `channels.json` `defaults.digestTime`
- AC5: `/reports` page gains "Digest History" tab showing last 30 digests with date, project count, and preview text

---

## P129 — Fleet Topology Edge Weights from Shared Memory

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Fleet Topology graph (P121) draws edges based on cross-project slug references in transcripts, which produces sparse graphs for projects that collaborate via shared memory rather than explicit mentions. Projects that read each other's MEMORY.md or GOAL.md files are functionally coupled but appear isolated in the topology.

### Proposed Solution

Augment the topology edge computation to also detect: (1) shared keyword overlap between projects' MEMORY.md files (high overlap → stronger edge), (2) shared GOAL.md keyword overlap, (3) same git remote URL (hard dependency edge, styled differently). Edge weight formula: `0.5 * transcriptRef + 0.3 * memoryOverlap + 0.2 * goalOverlap`. Shared-remote edges rendered as solid thick lines; inferred-overlap edges remain dashed. Edge tooltip shows top-3 shared keywords.

### Acceptance Criteria

- AC1: `/api/topology` edge weight incorporates memory overlap (MEMORY.md keyword jaccard) and goal overlap (GOAL.md keyword jaccard)
- AC2: Shared-git-remote edges: detected by reading `.git/config` remote URL; rendered as solid `#EF4444` line of width 3
- AC3: Inferred-overlap edges: weight ≥ 0.1 rendered as dashed `#22D3EE` line, width proportional to weight
- AC4: Edge tooltip on hover: top-3 shared keywords between the two projects
- AC5: `/api/topology` response gains `edgeDetail: { source, target, breakdown: { transcript, memory, goal } }` per edge

---

## P130 — Proposal Impact Estimator

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The Proposal Graph (P83) shows proposals as nodes but gives no estimate of how much work a pending proposal represents or how it affects the fleet. Operators approve proposals without knowing if they will take 1 hour or 1 week, or whether they conflict with in-progress work.

### Proposed Solution

Add an "Impact Estimate" panel to the Proposal Graph page. For each `[ ] pending` proposal in BACKLOG.md, compute: estimated complexity (word count of ACs × 0.5 minutes/word proxy), file surface area (count of file types mentioned in the solution text), and dependency count (other proposal IDs referenced in the text). Display as a 3-axis radar mini-chart per proposal node. A "Risk Score" 0–100 = `complexity * 0.4 + surface * 0.4 + deps * 0.2`. Proposals with Risk > 70 get a red border; < 30 get a green "quick win" badge.

### Acceptance Criteria

- AC1: Proposal Graph node for each pending proposal gains a mini radar chart overlay (complexity / surface / deps axes)
- AC2: Risk score computed server-side in `/api/proposal-graph`; response gains `riskScore`, `complexityScore`, `surfaceScore`, `depsScore` per node
- AC3: Proposals with risk > 70 render with `#EF4444` border; risk < 30 render `#10B981` "quick win" badge
- AC4: Click proposal node → side panel shows full impact breakdown: AC count, estimated minutes, referenced file types, linked proposals
- AC5: Filter control: "Show quick wins only" toggles display to only risk < 30 nodes; URL param `?quickWins=1` persists state

---

## P131 — Live Turn Diff Viewer

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When Claude edits a file across multiple turns, operators have no way to see what changed between turn N and turn N+1. The turn viewer shows raw text but no before/after diff. Debugging "what did Claude change?" requires reading two full turns and mentally diffing them.

### Proposed Solution

Add a "Diff" mode to the turn viewer (`/turns`) page. When two assistant turns are selected (via shift-click), render a unified diff between their text content side by side. Diff computed client-side using `diff` library or custom Myers diff. Changed lines highlighted in red/green. A "Copy diff" button exports the diff as a patch file. If the turn contains tool_use blocks with file edits, extract and diff only the file content segments.

### Acceptance Criteria

- AC1: `/turns` page: shift-click a second turn card selects a range; a "Diff selected" button appears when exactly 2 turns selected
- AC2: Clicking "Diff selected" opens a split-pane diff view: left = older turn text, right = newer turn text; changed lines red/green highlighted
- AC3: If turns contain `str_replace_editor` or `write_file` tool calls, extract file content and diff those instead of raw text
- AC4: "Copy diff" button exports unified diff format to clipboard; "Download .patch" exports as file
- AC5: Diff view accessible via URL `?diffA=<turnIdx>&diffB=<turnIdx>` so operators can share specific diffs

---

## P132 — Fleet 3-D Constellation

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The 2-D Galaxy Map and Graph views show project relationships well in two dimensions but lose depth when 10+ projects are active. Related projects cluster visually but overlap with unrelated ones, making cluster membership unclear at a glance.

### Proposed Solution

Add a `/constellation` page using Three.js (or react-three-fiber) rendering projects as stars in 3-D space. Position determined by UMAP-like clustering of memory keyword vectors (computed server-side, passed as pre-computed 3-D coordinates). Camera auto-orbits slowly; click a star pauses orbit and opens the session-health panel. Stars pulse at a rate proportional to turn activity. Constellation lines (edges) drawn between memory-similar projects. Color = convergence score (green=high, red=low).

### Acceptance Criteria

- AC1: `/constellation` page: Three.js scene with projects as glowing spheres; camera slow-orbits; click pauses and opens session-health panel
- AC2: 3-D coordinates computed by `/api/constellation` using pre-computed keyword similarity PCA (2 passes, deterministic); stored in `constellation_coords` table
- AC3: Stars pulse (scale 1→1.3→1 over 2s) at rate proportional to turns/hour; pulsing stars emit a brief trail particle
- AC4: Constellation edges between projects with memory Jaccard ≥ 0.1; edge opacity proportional to similarity score
- AC5: Star color encodes convergence: green (#10B981) ≥60, amber (#F59E0B) 30–60, red (#EF4444) <30; size encodes context pressure

---

## P133 — Operator Presence & Cursor Sharing

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

When multiple operators access Mission Control simultaneously (e.g. two engineers on the same fleet), they have no awareness of each other. One operator may inject a message while another is reviewing the same project, causing conflicts. There is no "who is looking at what" visibility.

### Proposed Solution

Add lightweight presence tracking via SSE. Each MC client announces itself on connect with a random operator handle (stored in localStorage). A `/api/presence` SSE endpoint broadcasts the list of active operators and what page/slug they are currently viewing. A presence bar in the MC header shows avatars (first 2 chars of handle) for other operators, with a tooltip showing their current page. Clicking an avatar opens a "Follow" mode that mirrors their navigation. No auth required — presence is ephemeral and only within the session.

### Acceptance Criteria

- AC1: MC header shows presence avatars for other connected operators; tooltip shows handle + current page; updates within 3s of navigation
- AC2: `/api/presence` SSE endpoint streams `{ operators: [{ handle, page, slug?, ts }] }` every 3s; clients POST `/api/presence/ping` with current page on each navigation
- AC3: "Follow" mode: clicking an avatar enables follow-mode; MC navigates when that operator navigates; `Esc` exits follow-mode
- AC4: Operator handle derived from localStorage `mc_operator_handle` (auto-generated adjective+noun if not set); editable in a small popover on the avatar
- AC5: Presence state is in-memory only (no DB); operators inactive >30s are evicted from the list

---

## P134 — Scheduled Inject Templates

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators manually send daily standups ("What did you work on today?"), check-ins, and prompts to projects. This is repetitive and easy to forget. The scheduler only supports `!project` command strings, not rich inject payloads with per-project variable substitution.

### Proposed Solution

Extend the scheduler to support "inject templates": schedule entries that inject a message into one or more project sessions at a configured time. Template body supports variables: `{{slug}}`, `{{date}}`, `{{turnsToday}}`, `{{contextPct}}`. A new `!project schedule inject <time> <template>` verb registers the template. The `/scheduler` MC page gains an "Inject Templates" tab showing scheduled injects with next-fire time, template preview, and enable/disable toggle. Variables resolved at fire time using current fleet data.

### Acceptance Criteria

- AC1: `!project schedule inject HH:MM "<template>"` registers a global inject template; `!project schedule inject --slug <slug> HH:MM "<template>"` registers per-project
- AC2: Template variables `{{slug}}`, `{{date}}`, `{{turnsToday}}`, `{{contextPct}}` resolved at fire time; unresolved vars left as-is
- AC3: Scheduler fires inject by calling `POST /api/inject/<slug>` with rendered message; success logged to audit_log with verb `scheduled_inject`
- AC4: `/inject-templates` page gains "Scheduled" tab listing all inject schedules: time, template preview, target slugs, last-fired, toggle
- AC5: `GET /api/schedules` response includes inject entries with `type: "inject"` and `templateBody` field; stored in `schedules.json`

---

## P135 — Memory Diff Timeline

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Project MEMORY.md files evolve over time but operators have no visibility into how memory changed: what was added, removed, or modified between sessions. The memory audit page (P89) shows current state. There is no changelog of memory evolution.

### Proposed Solution

Add a `/memory-diff` page showing a per-project memory changelog. On each assistant turn that modifies MEMORY.md (detected by checking git log of the project repo), record a snapshot diff. Timeline shows entries: timestamp, turn reference, +/- line counts, and a toggle to expand the full unified diff. Filter by project and date range. A "Drift score" per project measures how much memory changed in the last 7 days (total lines changed / total lines). High drift (>50%) flagged in amber — indicates memory churn that may signal context instability.

### Acceptance Criteria

- AC1: `/memory-diff` page: per-project timeline of MEMORY.md git diffs; each entry shows timestamp, commit SHA, +lines, -lines, expand toggle
- AC2: Diff data from `git log -p MEMORY.md` for each project repo; parsed server-side in `/api/memory-diff`; cached in `memory_diff_log` table (slug, ts, sha, diff_text)
- AC3: Filter bar: project multi-select, date range picker; default = last 7 days all projects
- AC4: Drift score = total changed lines / total lines in last 7 days; displayed as a percentage chip per project; >50% shows amber warning
- AC5: `/api/memory-diff` returns `{ projects: [{ slug, driftScore, entries: [{ ts, sha, added, removed, diff }] }] }`

---

## P136 — Holographic Fleet Overview Panel

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The dashboard root page (`/`) has project cards but no single view that fuses all critical signals — memory health, proposal pipeline state, convergence trends, and active goals — into one holographic overview. Operators must navigate multiple pages to build a mental picture of fleet health.

### Proposed Solution

Add a full-viewport "Holographic Overview" mode to the dashboard root, toggled by pressing `H` or clicking a "Holographic" button in the header. In this mode, the project grid is replaced by a split panel: left half shows a live force-directed graph of all projects with convergence coloring and pulse rings for active turns; right half shows a scrollable "fleet narrative" — one line per project, auto-generated from latest memory keywords, goal text, and last turn summary. Below both panels, a horizontal "proposal pipeline bar" shows a mini Kanban of pending → in-progress → done proposal counts per project. Pressing `H` again returns to normal grid mode.

### Acceptance Criteria

- AC1: Pressing `H` on the dashboard root toggles Holographic mode; button in header also toggles; state persisted in `localStorage`
- AC2: Left panel: force-directed graph using existing `ProjectGraph` component, bounded to 50% width, convergence colors, pulse rings for active projects
- AC3: Right panel: "Fleet Narrative" — one line per project showing slug, latest memory headline (first non-empty MEMORY.md heading or top keyword), goal snippet (first 60 chars), and last-turn age
- AC4: Bottom bar: horizontal scroll of project mini-kanbans; each project shows count of pending/in-progress/done proposals as colored chips
- AC5: Holographic mode is responsive — on viewport <900px wide, switches to stacked layout (graph top, narrative below, pipeline bar collapsed)

---

## P137 — Proposal Velocity Sparkboard

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The backlog page shows proposals as a static list. There is no visual way to see proposal throughput over time — how many proposals are opened per week, how fast they move from pending to done, or which projects generate the most proposals. Velocity matters for capacity planning.

### Proposed Solution

Add a `/proposal-velocity` page with a multi-panel velocity dashboard. Top panel: a stacked area chart (D3) showing proposals opened vs closed per day over the last 30 days. Middle panel: a per-project bar chart of proposal counts (pending, in-progress, done) sorted by total. Bottom panel: "Velocity leaderboard" — projects ranked by proposals completed in the last 7 days, with a sparkline of daily completion rate. Data sourced from BACKLOG.md parse + git log timestamps of status changes.

### Acceptance Criteria

- AC1: `/proposal-velocity` page: stacked area chart of opened vs closed proposals per day, last 30 days; uses D3 with cyber-cyan/amber color scheme
- AC2: Per-project bar chart: grouped bars (pending, in-progress, done) for each project; sorted by total descending; click a bar deep-links to `/backlog?project=<slug>`
- AC3: Velocity leaderboard: top 10 projects by completions last 7 days; each row has sparkline of daily completions, total count, and trend arrow (up/down vs prior week)
- AC4: Data from `/api/proposal-velocity` parsing BACKLOG.md + git log of BACKLOG.md for timestamp of each `[x] done` status transition; 1-hour cache
- AC5: NavDropdown adds "Proposal Velocity" under Intelligence group

---

## P138 — Memory Health Radar

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Memory is the long-term context for each project agent, but there is no holistic view of memory quality across the fleet. Individual pages show memory content and diffs, but there is no score or visualization that tells an operator "these 3 projects have degraded memory health" at a glance.

### Proposed Solution

Add a `/memory-health` page with a fleet-wide memory health radar. Each project is a spoke on a radar chart (D3 radar/spider). Each spoke scores the project on 5 memory health dimensions: Recency (last modified < 7 days = good), Coverage (memory file count ≥ 3), Stability (drift score < 20%), Density (total memory word count ≥ 500), Freshness (memory last modified since last turn). The radar chart is interactive: hover a spoke to see the raw metric; click a project name to open its memory-audit page.

### Acceptance Criteria

- AC1: `/memory-health` page: D3 radar chart with one spoke per active project, scoring 5 dimensions (0–100 each); default = all projects overlaid with 30% opacity fills
- AC2: Toggle "per-project" view: shows one project at a time with a selector dropdown; large radar, full labels, score breakdowns below
- AC3: Five dimensions computed server-side in `/api/memory-health`: Recency, Coverage, Density, Stability (inverse drift score), Freshness (1 if memory modified after last transcript write, else 0)
- AC4: Fleet average pentagon displayed as a bold white line; project lines colored by composite score (average of 5 dims): green ≥70, amber 40–70, red <40
- AC5: NavDropdown adds "Memory Health" under Intelligence group; clicking a spoke label deep-links to `/memory-audit?slug=<slug>`

---

## P139 — Live Goal Progress Heatmap

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

The goal board (`/goals`) shows goal text and status per project but no quantitative progress over time. Operators can not see whether a project is making steady progress toward its goal or has plateaued. A temporal heatmap of goal-keyword frequency in turns would reveal effort patterns.

### Proposed Solution

Add a `/goal-heatmap` page: a 2D heatmap (D3) where rows = projects with active goals, columns = days (last 30), cell color = goal-keyword hit rate in that day's turns (0 = dark, 100% hit rate = bright cyan). An operator can select a cell to see that day's turns filtered to goal-relevant content. A summary row shows fleet-wide goal activity. Data computed from transcript JSONL files, matching assistant turn text against goal keywords.

### Acceptance Criteria

- AC1: `/goal-heatmap` page: D3 heatmap, rows = active-goal projects, columns = last 30 days; cell color = goal-keyword match rate (0 = #0a1628, max = #00F5FF); missing data = dim grey
- AC2: Click a cell opens a side drawer showing that day's matching turns for that project (turn text excerpts, up to 5); drawer slides in from right
- AC3: Summary row at bottom: fleet-wide average goal-keyword rate per day; displayed as a bold pulse line above the heatmap
- AC4: Data from `/api/goal-heatmap`: reads goal text per project from channels.json, tokenizes into keywords, scans JSONL transcripts for keyword hits per day; 30-min cache
- AC5: NavDropdown adds "Goal Heatmap" under Intelligence group

---

## P140 — Agent Capability Map

**Status:** `[x] done`
**Created:** 2026-06-22

### Problem

Operators configure `allowedTools` and `disallowedTools` per project but have no visual overview of what capabilities each project agent has vs. what it actually uses. There is no fleet-wide map of tool capability coverage — which projects are running with minimal permissions vs. full access.

### Proposed Solution

Add a `/capability-map` page: a grid where rows = tool names (aggregated from all projects' allowed/disallowed lists + observed usage from transcripts), columns = projects. Each cell is a colored square: green = allowed + used, cyan = allowed + unused, amber = used but not explicitly allowed (inherited via permissionMode), red = explicitly disallowed. Hovering a cell shows use count from last 7 days. A "coverage score" per project (used / allowed) shown as a bar below each column.

### Acceptance Criteria

- AC1: `/capability-map` page: grid heatmap rows=tools, columns=projects; cell states: green=allowed+used, cyan=allowed+unused, amber=used+implicit, red=disallowed; scrollable in both axes
- AC2: Tool list from union of all projects' `allowedTools` / `disallowedTools` arrays in channels.json + observed tool names from JSONL transcripts (last 7 days)
- AC3: Use counts from JSONL scan: count `tool_use` blocks per tool per project per day; `/api/capability-map` endpoint; 1-hour cache
- AC4: Coverage score per project = distinct tools used / distinct tools allowed; shown as a small bar chart below each project column header
- AC5: NavDropdown adds "Capability Map" under Intelligence group; clicking a row label deep-links to `/permissions?tool=<name>`

---

## P141 — Goal Editor UI

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The `/goals` page shows goal text and allows status cycling (active → paused → completed) but cannot create, edit, or delete goal text from the browser. Goals are stored in per-project `.goal` files that must be hand-edited on the filesystem. This creates friction for operators who want to set or update goals without SSH access.

### Proposed Solution

Add inline edit controls to the `/goals` page. Each goal card gets an Edit button (pencil icon) that opens an inline textarea pre-populated with the goal text. Save calls a new `PUT /api/goals` endpoint that writes the `.goal` file atomically. A "New Goal" button at the top creates a `.goal` file for projects that don't have one yet, with a placeholder prompt. Delete (trash icon, confirm dialog) removes the `.goal` file.

### Acceptance Criteria

- AC1: Edit button on each goal card opens inline textarea; Save/Cancel buttons; ESC cancels
- AC2: `PUT /api/goals` endpoint accepts `{ slug, text }`, writes `MCD_CHANNELS_DIR/projects/<slug>/.goal` atomically (write-rename); returns updated goal object
- AC3: `POST /api/goals` endpoint with `{ slug }` creates a new `.goal` file with placeholder text "Define goal here…"; shown as a new card in active state
- AC4: `DELETE /api/goals?slug=<slug>` removes `.goal` file; card disappears from list
- AC5: Projects without a `.goal` file show an "Add Goal" ghost card with a + button; clicking opens the new-goal flow

---

## P142 — Composite Project Health Scorecard

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The dashboard has many specialized views — memory health radar, turn quality heatmap, context pressure monitor, anomaly detection — but no single page that aggregates all dimensions into one health score per project. Operators must cross-reference 5+ pages to understand if a project is healthy. A scorecard would surface the worst-performing projects at a glance.

### Proposed Solution

Add a `/scorecard` page: a sortable table where each row is a project and columns are health dimensions pulled from existing API endpoints (turn quality score, memory composite, goal progress rate, context pressure, anomaly count). Each cell is a color-coded badge. A final "Overall" column is the weighted average (turn 30%, memory 30%, goal 20%, context 10%, anomaly 10%). Row background pulses red for overall < 40, amber for 40–70. Clicking a row expands an accordion with quick-links to relevant detail pages.

### Acceptance Criteria

- AC1: `/scorecard` page: sortable table, one row per non-master project; columns: Turn Quality, Memory Health, Goal Progress, Context Pressure (inverted), Anomaly (inverted); Overall weighted composite
- AC2: Data from parallel fetch of existing `/api/turn-quality`, `/api/memory-health`, `/api/goal-heatmap`, `/api/context-pressure`, `/api/anomalies`; assembled client-side; 5-min auto-refresh
- AC3: Cell color: green ≥70, amber 40–70, red <40; Overall column bold with matching background tint
- AC4: Click row → accordion expands showing 5 quick-link buttons to detail pages for that slug
- AC5: Sort by any column; default sort = Overall ascending (worst first); sort state persists in URL query param

---

## P143 — Per-Project Config Editor

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Operators must edit `channels.json` by hand to change per-project settings like `model`, `progressMode`, `stuckThresholdMinutes`, `allowedTools`, and `disallowedTools`. There is no browser UI to do this. The `/permissions` and `/capability-map` pages are read-only. Editing channels.json is error-prone and requires filesystem access.

### Proposed Solution

Add a `/project-config` page: a form UI where operators select a project from a dropdown and see its current config fields. Editable fields: model (text input with autocomplete of known models), progressMode (select: off/post/edit), stuckThresholdMinutes (number input, 1–60), allowedTools (tag input), disallowedTools (tag input). Save calls `PUT /api/project-config` which updates the project's entry in channels.json atomically. A warning banner notes that process restart is needed for most changes to take effect.

### Acceptance Criteria

- AC1: `/project-config` page: project selector dropdown; form fields for model, progressMode, stuckThresholdMinutes, allowedTools (comma-sep or tag input), disallowedTools; Save + Reset buttons
- AC2: `GET /api/project-config?slug=<slug>` returns current effective config (merged with defaults); `PUT /api/project-config` accepts `{ slug, model?, progressMode?, stuckThresholdMinutes?, allowedTools?, disallowedTools? }`, writes channels.json atomically
- AC3: Unsaved changes show a dirty indicator (dot on Save button); Reset reverts to saved values; navigation-away prompt if dirty
- AC4: After save, a success toast shows "Config saved — restart session to apply"; link to `/admin` for session controls
- AC5: NavDropdown adds "Project Config" under Admin group

---

## P144 — Idle Fleet Detector

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Projects that have been idle (no turns) for days or weeks silently consume registry entries and confuse fleet overview visualizations. There is no view that surfaces dormant projects and tells operators how long they have been quiet. Operators discover stale projects by accident rather than by design.

### Proposed Solution

Add an idle-projects section to the `/projects` page (or a dedicated `/idle-fleet` page): a list of projects sorted by days since last turn, color-coded by idle duration (< 7d = white, 7–30d = amber, > 30d = red). Each row shows last turn timestamp, total turn count, memory file count. A "Nudge" button sends a templated inject to the project to resume work. An "Archive" button (with confirmation) calls `!project rm --yes` via master command.

### Acceptance Criteria

- AC1: `/idle-fleet` page: table sorted by days-since-last-turn descending; columns: slug, last turn (relative + absolute), total turns, memory files, idle badge
- AC2: Idle thresholds: < 7d = no badge, 7–30d = amber "Idle", > 30d = red "Dormant"
- AC3: Data from `/api/idle-fleet`: scans JSONL transcripts for most-recent assistant turn timestamp per project; response includes `{ slug, lastTurnAt, daysSince, turnCount, memoryFileCount }`; 15-min cache
- AC4: "Nudge" button POSTs to `/api/idle-fleet/nudge` with `{ slug }`, which injects "What are you working on? Summarize current status." into the project; returns success/error
- AC5: NavDropdown adds "Idle Fleet" under Fleet group

---

## P145 — Turn Volume vs Quality Correlation Chart

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The dashboard tracks turn quality scores and turn counts separately (heatmap page, quality page) but never shows their relationship. Operators cannot tell whether a busy project is doing high-quality work or thrashing — many low-quality turns. A scatter plot of volume vs quality would reveal burnout, thrash, and peak performance patterns across the fleet.

### Proposed Solution

Add a `/turn-correlation` page: a D3 scatter plot where each point is a (project, day) pair. X-axis = turn count for that day, Y-axis = average quality score for that day. Points colored by project (consistent color per slug). Hover shows tooltip: project, date, turn count, quality score. A fleet-average trend line (linear regression). Time range selector (last 7d / 14d / 30d). Clicking a point deep-links to the turn-quality heatmap filtered to that project and day.

### Acceptance Criteria

- AC1: `/turn-correlation` page: D3 scatter plot, X = daily turn count (0–max), Y = avg quality score (0–100); one point per (slug, day) pair; colored by project
- AC2: Linear regression trend line across all points; slope label ("quality ↑ with volume" vs "quality ↓ with volume")
- AC3: Hover tooltip: slug, date, turn count, quality score; point grows on hover
- AC4: Time range selector (7d / 14d / 30d) updates data; data from `/api/turn-quality` + `/api/turns` combined client-side; 30-min refresh
- AC5: NavDropdown adds "Turn Correlation" under Intelligence group; clicking a point deep-links to `/turn-quality?slug=<slug>&day=<YYYY-MM-DD>`

---

## P146 — Fleet Activity Calendar

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

There is no bird's-eye temporal view of fleet-wide activity across days and weeks. The Scheduler Heatmap shows per-project job history but not organic agent activity density. Operators cannot tell which days were "hot" (high fleet turn count) vs quiet without navigating multiple pages.

### Proposed Solution

Add a `/calendar` page with a GitHub-style contribution calendar. Each cell is one day; color intensity (dark → neon-cyan) encodes total assistant turns across all projects that day. Rows = weeks, columns = days. Clicking a day opens a slide-out panel showing per-project turn counts for that day as a horizontal bar chart. A `/api/metrics/calendar` endpoint reads transcript `.jsonl` files and returns `{ day: string, totalTurns: number, perProject: { slug: string, turns: number }[] }[]` for the last 52 weeks. A "Today" marker is highlighted in amber.

### Acceptance Criteria

- AC1: `/calendar` page renders a 52-week GitHub-style heatmap grid within 2s; newest day = bottom-right
- AC2: Cell color: 0 turns = `#0d1117`, 1–5 = `#0e4429`, 6–20 = `#006d32`, 21–50 = `#26a641`, 51+ = `#22D3EE`
- AC3: Hover tooltip shows: date, total turns, top 3 most active projects
- AC4: Clicking a day opens a side panel with a per-project bar chart for that day
- AC5: Today's cell highlighted with amber border; month labels shown above grid
- AC6: `/api/metrics/calendar` cached for 30 min; loading skeleton shown during first fetch

---

## P147 — Agent Focus Mode

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Operators monitoring a single project must switch between 4–6 different dashboard pages (Transcript, Diff, Goals, Health, Inject, Audit). There is no single full-screen view that combines all project-level signals into one immersive layout for deep focus on one agent.

### Proposed Solution

Add a `/focus/[slug]` page: a full-screen, dark-mode immersive layout with a fixed 3-column grid. Left column: GOAL.md content (editable inline, same as P44) + health score ring + watchdog countdown. Center column: live transcript tail (last 20 entries, auto-scroll, same as P12) + inject textarea (Ctrl+Enter to send). Right column: recent git diff stat (last 5 commits from P11) + memory chip (MEMORY.md size + "Distill" button from P42) + mini audit log (last 10 events). Accessible from the InstanceGrid slug chip via a new "Focus" icon. No polling — subscribes to SSE FleetContext for live updates.

### Acceptance Criteria

- AC1: `/focus/[slug]` renders within 1.5s; 404s if slug not found in channels.json
- AC2: Left: GOAL.md editable inline (PUT `/api/projects/[slug]/goal`); health ring + watchdog badge live from SSE
- AC3: Center: transcript tail auto-scrolls; inject textarea sends via `/api/inject`; Ctrl+Enter submits
- AC4: Right: git diff stat via `/api/diff/[slug]`; memory chip with distill button; audit events from `/api/audit?slug=<slug>&limit=10`
- AC5: "Focus" icon on InstanceGrid slug chip opens `/focus/[slug]` in same tab; `Esc` navigates back
- AC6: Page title shows slug + current state badge; browser tab title updates to `Focus: <slug>`

---

## P148 — Predictive Stall Forecaster

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The Stall Alert Panel (P3) detects stalls reactively — only after the agent has been silent past its threshold. By then, momentum is lost and the operator must diagnose and reinject. There is no forward-looking view that warns operators before a stall occurs.

### Proposed Solution

Add a "Stall Risk" widget to the Fleet Advisor panel (P52) and as a standalone `/stall-risk` page. A `/api/stall-risk` endpoint computes a risk score (0–100) for each active project using four heuristics: (1) context pressure trend (rising fast → high risk); (2) turn quality trend (falling over last 3 turns → high risk); (3) time since last reply (approaching watchdog threshold → high risk); (4) recent watchdog-kill history (killed > 2× in last 24h → structural risk). Score = weighted sum (30% context, 30% quality trend, 25% recency, 15% history). Projects with score ≥ 60 shown in amber; ≥ 80 in red. Each high-risk project shows top contributing factor + a one-click "Pre-inject" action that opens InjectTerminal with a suggested "check-in" prompt.

### Acceptance Criteria

- AC1: `/stall-risk` page lists projects with risk score ≥ 40; sorted by score desc; < 40 shown dimmed
- AC2: Risk score bar (0–100) with color: green < 40, amber 40–79, red ≥ 80
- AC3: Top contributing factor shown per project (e.g. "context at 87%", "quality dropping", "near threshold")
- AC4: "Pre-inject" button opens InjectTerminal with pre-filled "Please checkpoint your progress and confirm your next step."
- AC5: `/api/stall-risk` returns `{ slug, score, factors: string[], state }[]`; refreshes every 60s
- AC6: Widget in Fleet Advisor panel shows top 3 at-risk projects when stall-risk panel not open

---

## P149 — Fleet State Snapshot & Diff

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

After a deployment, configuration change, or model upgrade, operators have no way to compare fleet health before and after. Data from `/api/fleet` and `/api/health` is ephemeral — previous states are gone. Post-change analysis requires relying on memory of what the dashboard showed.

### Proposed Solution

Add a "Snapshot" button to the fleet dashboard header. Clicking saves a fleet snapshot to `mc.db` (`fleet_snapshots` table: id, ts, label, payload JSON). A `/snapshots` page lists all snapshots (newest first). Selecting two snapshots shows a side-by-side diff table: one row per project, columns = health score Δ, token usage Δ, state change (idle→active, etc.), goal status change. Changed cells highlighted (green = improved, red = degraded). A "Label" input lets operators annotate snapshots ("before model upgrade", "after stall incident"). A `/api/snapshots` POST endpoint saves; GET lists; DELETE removes.

### Acceptance Criteria

- AC1: "Snapshot" button in dashboard header; clicking saves current `/api/fleet` + `/api/health` payload to `mc.db` with ISO timestamp
- AC2: `/snapshots` page lists all snapshots: id, ts, label, project count; sorted newest-first
- AC3: Selecting two snapshots renders side-by-side diff table: slug, health Δ, token Δ, state change, goal Δ
- AC4: Improved cells green-highlighted; degraded cells red-highlighted; unchanged cells dim
- AC5: Each snapshot has an editable label input (PATCH `/api/snapshots/[id]`); delete button (soft-delete)
- AC6: `fleet_snapshots` table in mc.db; schema migrated on startup; snapshots older than 30 days auto-purged

---

## P150 — Token Burn Rate Forecaster

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The Token Budget Gauge (P18) shows current month usage vs budget but gives no forward projection. Operators cannot tell if a project will exhaust its monthly budget in 3 days or 3 weeks. Proactive budget reallocation is impossible without this forecast.

### Proposed Solution

Add a `/burn-rate` page (extends existing `/cost` page or standalone) with a per-project burn forecast. A `/api/metrics/burn-rate` endpoint computes: (1) tokens used this calendar month so far; (2) daily average burn rate (tokens/day over last 7 days); (3) projected end-of-month usage = current + rate × days_remaining; (4) days until budget exhausted (if `monthlyTokenBudget` set). Render as a table: slug, today's burn rate, projected month-end usage, budget %, "exhausts in N days" or "within budget". A sparkline (last 7 days daily token counts) per row. Projects on pace to exceed budget highlighted red; within 20% highlighted amber. A fleet-total row at the top.

### Acceptance Criteria

- AC1: `/burn-rate` page renders table within 2s; fleet-total row pinned to top
- AC2: Per-project: daily rate (tokens/day), projected month-end, budget % bar, exhausts-in badge
- AC3: "Exhausts in N days" badge: red ≤ 7 days, amber 8–14 days, green > 14 days or no budget set
- AC4: 7-day sparkline per row (inline SVG); each bar = one day's token count
- AC5: `/api/metrics/burn-rate` returns `{ slug, dailyRate, projectedMonthEnd, daysUntilExhausted?, budgetPct? }[]`
- AC6: NavDropdown adds "Burn Rate" under Intelligence group (replace or alongside existing Fleet Cost)

---

## P151 — Unified Nexus Map (Project · Memory · Proposal)

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Holistic fleet state is fragmented across separate views: `/knowledge` links projects↔memories↔goals, `/proposal-graph` shows proposals, `/backlog` lists per-project items. No single screen answers "for each project, how much memory has it accumulated, how many proposals are pending vs done, and is its goal active?" Operators must hop between 3+ pages to assess a project's overall footprint.

### Proposed Solution

Add a `/nexus` page rendering one deterministic radial map. Each project is a hub node arranged on a ring; around each hub orbit three satellite glyphs — Memory (cyan, sized by memory count), Proposal (amber, split pending/done), Goal (purple, colored by status). A `/api/nexus` endpoint aggregates per-project rollups from `channels.json` (projects + state), `memory.db` (memory count by `channel_slug`), per-project `BACKLOG.md` (pending/done counts), and `GOAL.md` (goal status). Hovering a hub shows a detail card (state, age, memory/proposal/goal breakdown). A fleet summary bar pins totals at top. No physics sim — coordinates computed server-trivially / client-deterministically so layout is stable across reloads.

### Acceptance Criteria

- AC1: `/nexus` renders within 2s; project hubs on a ring, three satellites each (memory/proposal/goal)
- AC2: `/api/nexus` returns `{ projects: { slug, state, ageMins, memoryCount, proposalPending, proposalDone, goalStatus }[], fleet: {...} }`
- AC3: Memory satellite sized by memoryCount; proposal satellite shows pending/done split; goal satellite colored by status (active/paused/completed/none)
- AC4: Hovering/tapping a hub opens a detail card with the full breakdown
- AC5: Fleet summary bar pins totals (projects, memories, pending proposals, active goals)
- AC6: NavDropdown adds "Nexus Map" under Observability group

---

## P152 — Fleet Momentum River

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

`/turns` shows turn volume and `/burn-rate` shows token forecasts, but neither shows the *shape* of fleet activity over time — which projects dominated activity on which days, and how the mix shifted. A stacked stream (streamgraph) reveals momentum shifts at a glance.

### Proposed Solution

Add a `/momentum` page with a 14-day streamgraph: x-axis = day, each band = one project, band thickness = that project's daily token (or turn) total. A `/api/metrics/momentum` endpoint reads per-project transcripts and buckets daily totals over 14 days. Bands colored per-project; legend toggles bands on/off. Hover shows day + project + value tooltip.

### Acceptance Criteria

- AC1: `/momentum` renders a 14-day streamgraph; one band per project
- AC2: `/api/metrics/momentum` returns `{ days: string[], series: { slug, values: number[] }[] }`
- AC3: Band thickness = daily token total; bands stack symmetrically (stream layout)
- AC4: Legend toggles individual bands; hover tooltip shows day/slug/value
- AC5: NavDropdown adds "Momentum River" under Observability group

---

## P153 — Proposal Flow Sankey

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Proposal lifecycle (pending → done) across the fleet has no flow visualization. Operators cannot see how proposal volume distributes across projects and statuses in one diagram.

### Proposed Solution

Add a `/proposal-flow` page with a Sankey diagram: left nodes = projects, flowing to right nodes = statuses (pending, done). Link width = count. Reuses `/api/backlog`. Built with d3-sankey (d3 already a dependency).

### Acceptance Criteria

- AC1: `/proposal-flow` renders a Sankey: project nodes → status nodes
- AC2: Link width proportional to proposal count; pending vs done color-coded
- AC3: Hover highlights a flow and shows project/status/count
- AC4: NavDropdown adds "Proposal Flow" under Intelligence group

---

## P154 — Holistic Spotlight (Omni-Search ⌘K)

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

`/search` is a dedicated page. There's no global keyboard-driven palette to jump across projects, memories, proposals, and goals from anywhere in the dashboard.

### Proposed Solution

Add a `⌘K` / `Ctrl+K` command palette overlay mounted globally. Typing fuzzy-matches across projects (→ project page), memories (→ knowledge), proposals (→ backlog), and nav destinations. Arrow keys navigate; Enter routes. A `/api/spotlight` (exists) or client-side index backs results.

### Acceptance Criteria

- AC1: `⌘K`/`Ctrl+K` opens palette from any page; `Esc` closes
- AC2: Fuzzy search across projects, memories, proposals, nav views; grouped results
- AC3: Arrow keys move selection; Enter routes to the destination
- AC4: Palette mounted in root layout; no per-page wiring needed

---

## P155 — Project Momentum Index

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

No single composite score ranks projects by overall momentum (recent activity + goal advancement + proposal throughput). The scorecard shows health but not forward momentum.

### Proposed Solution

Add a `/momentum-index` page ranking projects by a composite momentum score: weighted blend of 7-day token burn, goal advancement delta, and proposals-completed-this-week. A `/api/metrics/momentum-index` computes and returns ranked rows with a radial momentum gauge per project. Top mover and biggest decliner highlighted.

### Acceptance Criteria

- AC1: `/momentum-index` ranks projects by composite momentum score (0–100)
- AC2: `/api/metrics/momentum-index` returns `{ slug, score, burn7d, goalDelta, proposalsDone }[]` sorted desc
- AC3: Each row shows a radial gauge; top mover (green) and biggest decliner (red) badged
- AC4: NavDropdown adds "Momentum Index" under Intelligence group

---

## P156 — Backlog Burndown Chart

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The backlog page (P78) shows a static done-vs-pending split and the proposal-velocity page (P153) shows daily throughput, but neither shows the classic burndown trajectory — cumulative remaining work over time against total scope. Operators planning capacity cannot see whether the backlog is actually shrinking, when scope was added, or extrapolate a completion date.

### Proposed Solution

Add a `/burndown` page rendering a pure-SVG burndown chart of the main repo BACKLOG.md. A new `/api/metrics/burndown` endpoint parses BACKLOG.md proposals (P-number, status), maps each done proposal to its completion date (earliest linked commit date matching its P-number via `git log`, falling back to its `**Created:**` date), and builds a daily time series of `{ date, total, done, remaining }`. The chart draws: a grey "total scope" step line (rises when proposals are added), a green "completed" area, and a red "remaining" line. An "ideal" dashed guide runs from first-day remaining to zero at the latest completion. A header strip shows total / done / remaining counts and a projected completion date (linear extrapolation from the last 7 days' completion rate).

### Acceptance Criteria

- AC1: `/burndown` renders an SVG burndown chart with total, completed, and remaining series over time
- AC2: `/api/metrics/burndown` returns `{ series: { date, total, done, remaining }[], projectedDone: string | null }`
- AC3: Done proposals dated by earliest linked commit (P-number regex on `git log`), falling back to `**Created:**`
- AC4: Header shows total / done / remaining counts and a projected completion date (or "—" if no recent velocity)
- AC5: NavDropdown adds "Backlog Burndown" under the Intelligence group

---

## P157 — Fleet Pulse Radar

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The fleet's freshness is scattered across the Instance Grid and Fleet Health Bar as text counters. There is no single at-a-glance scope view where an operator can sweep the whole fleet and instantly spot which projects have gone quiet, ranked by how stale they are.

### Proposed Solution

Add a `/pulse` page rendering a radar-scope visualization (pure SVG). Each active project is a blip; angular position is assigned by hashing the slug into a stable sector, radial distance encodes staleness (centre = active in last minute, outer rim = stalled/idle for hours). An animated sweep line rotates continuously; blips brighten as the sweep passes. Blip colour follows `classifyChannel` state (green active, cyan idle, red stalled, purple autonomous). Data comes from the existing `/api/fleet` endpoint — no new server route. Hovering a blip shows slug, state, and minutes-since-last-turn.

### Acceptance Criteria

- AC1: `/pulse` renders a circular radar scope with one blip per project from `/api/fleet`
- AC2: Radial distance encodes staleness; angular sector is stable per slug across refreshes
- AC3: An animated sweep line rotates; blips brighten when swept
- AC4: Blip colour matches fleet state; hover tooltip shows slug, state, minutes idle
- AC5: NavDropdown adds "Fleet Pulse Radar" under the Observability group

---

## P158 — Proposal Theme Treemap

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The backlog has grown past 150 proposals but there is no view of how effort is distributed across themes (graph views, memory, scheduler, metrics, alerts, etc.). Operators cannot see which areas are over- or under-invested, nor how done-vs-pending splits within each theme.

### Proposed Solution

Add a `/themes` page with a squarified-treemap (pure SVG) of BACKLOG.md proposals grouped by inferred theme. A `/api/metrics/themes` endpoint parses BACKLOG.md, classifies each proposal into a theme by title/solution keyword matching (graph, memory, scheduler, metrics, alerts, git, whatsapp, ui, other), and returns `{ theme, total, done, pending }[]`. Treemap tile area encodes total proposal count per theme; tile fill is a done/pending gradient (proportion done shown as a filled bar within the tile). Clicking a tile filters a list below it showing that theme's proposals with status badges.

### Acceptance Criteria

- AC1: `/themes` renders a treemap where tile area ∝ proposal count per theme
- AC2: `/api/metrics/themes` returns `{ theme, total, done, pending }[]` sorted by total desc
- AC3: Each tile shows theme name, count, and a done/pending fill proportion
- AC4: Clicking a tile lists that theme's proposals with status badges below the map
- AC5: NavDropdown adds "Proposal Themes" under the Intelligence group

---

## P159 — Memory Growth Stream

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Each project accumulates memory entries over time, but there is no view of memory growth as a fleet-wide trend. Operators cannot see which projects are actively learning versus stagnant, or spot a sudden burst of memory writes that signals heavy autonomous activity.

### Proposed Solution

Add a `/memory-stream` page with a stacked-area "stream graph" (pure SVG) of memory entry counts per project over time. A `/api/memory/growth` endpoint reads each project's memory directory, derives a per-entry creation date from file mtime, buckets by day over the last 30 days, and returns a cumulative per-project series. The stream graph stacks each project's band; band thickness encodes that project's memory count. A legend lists projects by current memory total. Hovering shows the per-project count at that day.

### Acceptance Criteria

- AC1: `/memory-stream` renders a stacked-area stream graph of per-project memory counts over 30 days
- AC2: `/api/memory/growth` returns `{ projects: { slug, daily: { date, count }[] }[] }`
- AC3: Entry dates derived from memory file mtime, bucketed daily, cumulative per project
- AC4: Legend lists projects by current memory total; hover shows per-day per-project count
- AC5: NavDropdown adds "Memory Stream" under the Observability group

---

## P160 — Backlog Velocity Forecast

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Operators have no estimate of when the remaining backlog will clear. The burndown (P156) shows trajectory, but a dedicated forecast that models multiple velocity scenarios and surfaces a confidence band would help prioritise whether to add scope or accelerate.

### Proposed Solution

Add a `/forecast` page that projects backlog completion under three velocity scenarios: pessimistic (slowest 7-day rate in history), expected (trailing 14-day mean), and optimistic (fastest 7-day rate). A `/api/metrics/forecast` endpoint reuses the burndown series (P156) to compute historical daily completion rates, then extrapolates remaining work forward under each scenario, returning projected completion dates and a per-day fan-chart band. The page renders the fan chart (pure SVG): the historical remaining line continues into three forward rays with a shaded band between pessimistic and optimistic. A summary shows the three projected dates and current trailing velocity (proposals/week).

### Acceptance Criteria

- AC1: `/forecast` renders a fan chart with historical remaining line plus three forward scenario rays
- AC2: `/api/metrics/forecast` returns `{ scenarios: { name, rate, projectedDone }[], band: { date, low, high }[] }`
- AC3: Scenarios computed from historical 7/14-day completion rates over the burndown series
- AC4: Summary shows three projected completion dates and trailing velocity (proposals/week)
- AC5: NavDropdown adds "Velocity Forecast" under the Intelligence group

---

## P161 — Stale Data Sentinel

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The dashboard now has 80+ views that each poll their own `/api/*` endpoint on independent intervals (5s–60s). When an endpoint errors or the MCD server is down, most pages silently keep rendering the last good data with no indication it is stale — an operator can stare at a frozen radar or treemap believing the fleet is quiet when in fact the data feed died. There is no shared freshness signal across views.

### Proposed Solution

Add a tiny shared `useFreshness` hook (in `lib/`) wrapping the fetch+interval pattern these pages repeat. It tracks `lastSuccessAt`, `isStale` (no success within 2.5× the poll interval), and `lastError`. Render a small reusable `FreshnessBadge` in the page header: green dot + "live" when fresh, amber "stale Ns" when the last success is aging, red "offline" when the last fetch errored. Retrofit the most-trafficked polling pages first (`/pulse`, `/themes`, `/`, `/feed`, `/burndown`). No new server route — purely client-side derivation from existing fetch outcomes.

### Acceptance Criteria

- AC1: `useFreshness(url, intervalMs)` hook returns `{ data, isStale, lastError, lastSuccessAt }`
- AC2: `FreshnessBadge` shows live (green) / stale (amber, with seconds) / offline (red) states
- AC3: Stale threshold = 2.5× the page's poll interval; offline shown on any fetch rejection or non-2xx
- AC4: `/pulse`, `/themes`, `/`, `/feed`, `/burndown` headers render the badge
- AC5: No new API route; existing endpoints unchanged

---

## P162 — Blip & Tile Deep-Links

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The newest visualizations (P157 Fleet Pulse Radar, P158 Proposal Theme Treemap) are read-only: a radar blip only shows a hover tooltip and a treemap tile only toggles a list. Operators who spot an interesting project or theme cannot jump from the visual to the canonical detail surface — they must mentally note the slug/number and navigate elsewhere, breaking the investigation flow that these "at-a-glance" views are meant to start.

### Proposed Solution

Make blips and tiles click-through. On `/pulse`, clicking a blip navigates to the existing project spotlight (`/?spotlight=<slug>`), matching the pattern already used by the Momentum Index rows. On `/themes`, each proposal row in the drill-down list links to the Proposal Graph or backlog anchor for that P-number. Add a subtle "↗" affordance on hover so the click target is discoverable. No backend changes.

### Acceptance Criteria

- AC1: Clicking a radar blip on `/pulse` navigates to `/?spotlight=<slug>`
- AC2: Hovering a blip shows a click affordance (cursor + "↗" or ring) distinct from the tooltip
- AC3: Each proposal row in the `/themes` drill-down links to that proposal's canonical view
- AC4: Keyboard focus + Enter activates the same navigation (accessible)
- AC5: No new API route

---

## P163 — Recently Shipped Rail

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

New views ship most days (P151–P158 in the last week alone) but the only way to discover them is scrolling the increasingly long "All Views" NavDropdown. Operators have no sense of what was added recently, so freshly built capabilities go unused. There is no surface that answers "what's new in the dashboard."

### Proposed Solution

Add a `/api/whats-new` endpoint that parses `BACKLOG.md` for the most recently completed proposals (status done, ordered by linked git commit date) and maps each to its dashboard route via a small title→href lookup. Render a dismissible "Recently Shipped" rail on the home dashboard (`/`) showing the last ~6 shipped views as chips linking straight to them, with the ship date. Dismissal persists in localStorage and resets when a newer item appears.

### Acceptance Criteria

- AC1: `/api/whats-new` returns the last N done proposals with `{ number, title, href, shippedAt }`
- AC2: Home dashboard renders a "Recently Shipped" rail of chips linking to each view
- AC3: Proposals without a known route are omitted (no dead links)
- AC4: Rail is dismissible; dismissal persists and re-appears when a newer item ships
- AC5: Ship date derived from the proposal's linked commit date, falling back to Created date

---

## P164 — View Cycler Hotkeys

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

With 80+ views, comparing related visualizations (e.g. Pulse Radar → Constellation → Galaxy, or Burndown → Forecast → Velocity) means returning to the NavDropdown between each. There is no fast way to step through the views in a category, which discourages the side-by-side exploration these observability surfaces are built for.

### Proposed Solution

Add a global keyboard handler (in the shared layout) that cycles to the next/previous view within the current NavDropdown category using `[` and `]`. Reuse the existing `NAV_GROUPS` definition as the ordering source so no list is duplicated. Show a brief toast naming the destination view on each jump. Keys are ignored while an input/textarea is focused, consistent with the existing `V` toggle.

### Acceptance Criteria

- AC1: `]` navigates to the next view in the current page's NavDropdown category; `[` to the previous (wrapping)
- AC2: Category and ordering are derived from the existing `NAV_GROUPS`, not a duplicated list
- AC3: A transient toast shows the destination view label on each jump
- AC4: Hotkeys are suppressed while an INPUT/TEXTAREA is focused
- AC5: Pages outside any NavDropdown category are a no-op (no crash)

---

## P165 — Memory Footprint Treemap

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The fleet's memory files (`memory/MEMORY.md` and per-fact files) grow silently per project. Operators have no single view showing which projects carry the heaviest memory footprint, so memory bloat — a direct drain on the token budget the vision prioritises — goes unnoticed until a project feels sluggish.

### Proposed Solution

Add a `/memory-footprint` page rendering a squarified-treemap (pure SVG, same technique as `/themes`) where each tile is a project and tile area encodes total memory size in bytes (`memoryStatus.sizeBytes` from `/api/fleet`). Tile fill is a heat gradient by size (cool → hot). Tile label shows slug + human-readable size. A summary header shows total fleet memory and the heaviest project. Clicking a tile deep-links to that project's `/memory-audit?slug=`. Projects with no memory file are omitted.

### Acceptance Criteria

- AC1: `/memory-footprint` renders a treemap where tile area ∝ `memoryStatus.sizeBytes` per project
- AC2: Reuses `/api/fleet` (no new endpoint); projects lacking a memory file are excluded
- AC3: Each tile shows slug and human-readable size; fill color scales with size
- AC4: Header shows total fleet memory bytes and the single heaviest project
- AC5: Clicking a tile navigates to `/memory-audit?slug=<slug>`
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P166 — Goal Convergence Gauge Wall

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

`convergenceScore` (0–1, how close a project is to its goal) is computed and exposed in `/api/fleet` but only surfaced as a single fleet average. Operators cannot see, at a glance, which individual projects are converging vs. stalled relative to their goals.

### Proposed Solution

Add a `/convergence-wall` page rendering a responsive grid of radial gauges, one per project with a goal. Each gauge is a pure-SVG arc filled proportional to `convergenceScore`, colored by band (red <0.34, amber <0.67, green ≥0.67), with the slug and goal text beneath. Sort highest-convergence first. Header shows fleet average convergence. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/convergence-wall` renders one radial gauge per project that has a `goalText`
- AC2: Arc fill ∝ `convergenceScore`; color band red/amber/green by threshold
- AC3: Gauges sorted by convergenceScore desc; header shows fleet average
- AC4: Reuses `/api/fleet`; projects without a goal are omitted
- AC5: Added to `NAV_GROUPS` under Intelligence

---

## P167 — Fleet State Sunburst

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Fleet composition (how projects break down by runtime state and platform) is only available as flat counts in the health bar. There is no hierarchical view showing, e.g., how many `stalled` projects are on WhatsApp vs. Discord.

### Proposed Solution

Add a `/fleet-sunburst` page with a two-ring pure-SVG sunburst: inner ring = runtime state (idle/active/stalled/autonomous), outer ring = platform within each state. Arc angle ∝ project count. State colors match the existing palette. Hovering a segment shows count and the project slugs. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/fleet-sunburst` renders a 2-ring sunburst: inner=state, outer=platform
- AC2: Segment angle ∝ project count; inner colors match state palette
- AC3: Hover tooltip shows segment count and member slugs
- AC4: Reuses `/api/fleet` (no new endpoint)
- AC5: Added to `NAV_GROUPS` under Observability

---

## P168 — Budget Pressure Bullet Chart

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Per-project token budget consumption (`monthlyTokensUsed` vs `monthlyTokenBudget`, `budgetStatus`) is shown only as a color chip on InstanceGrid cards. Operators cannot quickly rank which projects are closest to exhausting their budget across the whole fleet.

### Proposed Solution

Add a `/budget-pressure` page rendering a horizontal bullet-chart row per project that has a `monthlyTokenBudget`: a track of the full budget, a filled bar of `monthlyTokensUsed`, and threshold ticks at 50%/80%/100%. Bar color follows `budgetStatus` (green/amber/red/grey). Rows sorted by usage fraction desc so the most-pressured projects float to the top. Header shows aggregate fleet usage. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/budget-pressure` renders one bullet row per project with a `monthlyTokenBudget`
- AC2: Filled bar ∝ usage fraction; 50/80/100% threshold ticks shown
- AC3: Bar color follows `budgetStatus`; rows sorted by usage fraction desc
- AC4: Header shows aggregate used/budget across the fleet
- AC5: Reuses `/api/fleet`; projects without a budget are omitted
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P169 — Proposal Aging Spectrum

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Pending proposals accumulate, but there is no view of *how long* each has been waiting. A proposal created weeks ago and still pending is a stronger signal than its mere presence in a list. The backlog page shows status but not age distribution.

### Proposed Solution

Add a `/proposal-aging` page rendering a horizontal spectrum (beeswarm-style dot strip, pure SVG) where the x-axis is age in days since `createdAt` and each dot is a pending proposal, colored by age band (fresh <7d green, aging <30d amber, stale ≥30d red). Dots are grouped/labeled by project. Header shows count of stale proposals and the oldest pending item. Reuses `/api/backlog`; proposals without a `createdAt` are bucketed as "undated".

### Acceptance Criteria

- AC1: `/proposal-aging` plots one dot per pending proposal positioned by age in days
- AC2: Dot color band: green <7d, amber <30d, red ≥30d
- AC3: Header shows stale (≥30d) count and the oldest pending proposal title
- AC4: Reuses `/api/backlog`; undated proposals shown in a separate "undated" lane
- AC5: Added to `NAV_GROUPS` under Intelligence
- AC3: A transient toast shows the destination view label on each jump
- AC4: Hotkeys are suppressed while an INPUT/TEXTAREA is focused
- AC5: Pages outside any NavDropdown category are a no-op (no crash)

---

## P170 — Inbound Queue & Circuit Board

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

`queuedCount` (messages buffered while a project is busy or budget-exhausted) and `circuitOpen` (the breaker that pauses inbound delivery) are both exposed in `/api/fleet` but only surfaced as small markers on the InstanceGrid card. There is no fleet-wide view that answers "which projects are backing up work, and whose circuit breaker has tripped" — the two clearest signals that a channel needs operator attention right now.

### Proposed Solution

Add a `/queue-board` page rendering a ranked board of horizontal bars, one per project that has `queuedCount > 0` or `circuitOpen === true`. Bar length encodes queued message count; rows with an open circuit get a pulsing red "BREAKER OPEN" badge and sort to the very top regardless of queue depth. Each row shows slug, queued count, runtime state, and platform. Header shows total queued messages across the fleet and the number of open breakers. Clicking a row deep-links to `/focus/<slug>`. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/queue-board` renders one row per project with `queuedCount > 0` or `circuitOpen`
- AC2: Bar length ∝ `queuedCount`; open-breaker rows show a pulsing "BREAKER OPEN" badge
- AC3: Open-breaker rows sort above all others; remaining rows sort by queuedCount desc
- AC4: Header shows total queued messages and count of open breakers
- AC5: Empty state ("no backlog, all breakers closed") when nothing qualifies
- AC6: Clicking a row navigates to `/focus/<slug>`; reuses `/api/fleet`; added to `NAV_GROUPS` under Operations

---

## P171 — Stuck Headroom Gauge

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Each project is killed by the watchdog when its idle age crosses `stuckThresholdMinutes`. Both `ageMins` and `stuckThresholdMinutes` are in `/api/fleet`, but no view shows how close each project is to that kill line. Operators learn a project was reaped only after the fact, instead of seeing it approach the threshold.

### Proposed Solution

Add a `/stuck-headroom` page rendering one horizontal gauge per active project: a track representing `stuckThresholdMinutes` with a fill of `ageMins`, colored by headroom band (green <60%, amber <85%, red ≥85% of threshold). Rows sort by headroom fraction desc so the closest-to-reap float to the top. Each row shows slug, `ageMins`/`stuckThresholdMinutes`, and remaining minutes. Header shows the single most-at-risk project. Reuses `/api/fleet`; projects in a terminal/idle-evicted state are omitted.

### Acceptance Criteria

- AC1: `/stuck-headroom` renders one gauge per active project with `stuckThresholdMinutes`
- AC2: Fill ∝ `ageMins / stuckThresholdMinutes`; color band green/amber/red at 60%/85%
- AC3: Rows sorted by headroom fraction desc; header names the most-at-risk project
- AC4: Each row shows ageMins, threshold, and remaining minutes to reap
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Observability

---

## P172 — Context Fill ETA Countdown

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

`contextUsagePct` and `contextFillEtaMinutes` (projected minutes until the context window fills and the session must compact) are computed in `/api/fleet` but only appear on the InstanceGrid card. There is no view that ranks projects by *time until forced compaction* — the metric that predicts an imminent session disruption.

### Proposed Solution

Add a `/context-eta` page rendering a ranked countdown list: one row per project with a finite `contextFillEtaMinutes`, sorted ascending (soonest to fill first). Each row shows slug, a small fill bar for `contextUsagePct`, and the ETA rendered as a human countdown (e.g. "12m", "1.4h"). Rows under 15 minutes are flagged red; under 60 amber. Header shows the soonest-to-fill project. Reuses `/api/fleet`; projects with no ETA (idle or plenty of headroom) are listed separately as "stable".

### Acceptance Criteria

- AC1: `/context-eta` renders one row per project with a finite `contextFillEtaMinutes`, sorted soonest-first
- AC2: Each row shows a `contextUsagePct` fill bar and the ETA as a human countdown
- AC3: ETA <15m flagged red, <60m amber, otherwise green
- AC4: Header names the soonest-to-fill project; projects with no ETA grouped as "stable"
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Observability

---

## P173 — Fleet Age Distribution Histogram

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Project `ageMins` (minutes since last activity) is shown per-card but never aggregated. Operators cannot see the shape of fleet freshness — whether most projects are recently active or the fleet has drifted into a long idle tail — in a single glance.

### Proposed Solution

Add a `/age-distribution` page rendering a pure-SVG histogram of `ageMins` across all projects, bucketed into log-ish age bands (<5m, 5–15m, 15–60m, 1–4h, 4–12h, 12h+). Bar height ∝ project count in each band; bars colored cool→warm by band age. Hovering a bar lists the member slugs. Header shows median fleet age and the count of projects idle >4h. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/age-distribution` renders a histogram of `ageMins` across fixed age bands
- AC2: Bar height ∝ project count per band; color scales cool→warm with age
- AC3: Hover lists member slugs of a band
- AC4: Header shows median fleet age and count idle >4h
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Observability

---

## P174 — Fleet Attention Scoreboard

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

An operator deciding "which channel needs me right now" currently has to scan four separate views — Budget Pressure, Stuck Headroom, Context Fill ETA, and the Queue/Circuit board. The signals that demand intervention are scattered. There is no single ranked pane that fuses them into one "needs attention" ordering.

### Proposed Solution

Add a `/scoreboard` page computing a composite **attention score** per project from `/api/fleet` signals: budget pressure (usage fraction, weighted up when `budgetStatus` is critical/exhausted), stuck headroom (`ageMins / stuckThresholdMinutes`), context fill urgency (inverse of `contextFillEtaMinutes`), and queue/circuit state (`queuedCount`, `circuitOpen`). Render a ranked list, highest score first, each row showing the score, a stacked mini-bar breaking the score into its contributing factors (color-coded), and the dominant reason as a short tag (e.g. "breaker open", "near-reap", "budget critical"). Header shows the count of projects above an "attention" threshold. Rows deep-link to `/focus/<slug>`. Pure client-side composite; reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/scoreboard` computes a composite attention score per project from budget, headroom, context-ETA, and queue/circuit signals
- AC2: Rows ranked by score desc; each shows the score and a stacked factor mini-bar
- AC3: Each row shows the dominant-factor reason tag
- AC4: Header shows count of projects above the attention threshold
- AC5: Rows deep-link to `/focus/<slug>`; reuses `/api/fleet` (no new endpoint)
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P175 — Convergence vs Budget Scatter

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Two of the most important per-project signals — how close a project is to its goal (`convergenceScore`) and how much of its token budget it has burned (`monthlyTokensUsed / monthlyTokenBudget`) — are never plotted against each other. The dangerous quadrant (high spend, low convergence: burning budget without progress) is invisible.

### Proposed Solution

Add a `/convergence-budget` page with a pure-SVG scatter plot: x-axis = budget usage fraction (0–1), y-axis = `convergenceScore` (0–1), bubble radius ∝ `ageMins`. Draw quadrant guides at x=0.5 / y=0.5 and label the four quadrants (e.g. top-left "efficient", bottom-right "burning — at risk"). Bubble color by `budgetStatus`. Hovering a bubble shows slug, convergence %, budget %, and age. Only projects with both a `monthlyTokenBudget` and a `convergenceScore` are plotted. Header counts projects in the at-risk (high-spend / low-convergence) quadrant. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/convergence-budget` plots a bubble per project with both budget and convergence data
- AC2: x = budget usage fraction, y = convergenceScore, radius ∝ ageMins
- AC3: Quadrant guides + labels at the 0.5/0.5 cross; bubble color by budgetStatus
- AC4: Hover shows slug, convergence %, budget %, age
- AC5: Header counts projects in the at-risk quadrant; reuses `/api/fleet`
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P176 — Memory vs Convergence Quadrant

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The vision prioritises token/memory efficiency, but there is no view testing whether heavier memory footprints actually correlate with goal progress. Operators can't tell apart projects that carry a lot of memory and converge (good) from those that hoard memory yet stall (bloat to prune).

### Proposed Solution

Add a `/memory-convergence` page with a pure-SVG scatter: x-axis = memory size (`memoryStatus.sizeBytes`, log-scaled), y-axis = `convergenceScore`. Bubble color by goal status. Quadrant guides split "lean & converging", "heavy & converging", "lean & stalled", "heavy & stalled (prune candidate)". Hover shows slug, human-readable memory size, convergence %, and goal text. A computed Pearson-style correlation hint is shown in the header ("memory↔convergence: weak/none/positive"). Only projects with both a memory footprint and a convergence score are plotted. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/memory-convergence` plots a bubble per project with both memory size and convergenceScore
- AC2: x = log-scaled `memoryStatus.sizeBytes`, y = convergenceScore; bubble color by goal status
- AC3: Quadrant guides + labels including a "heavy & stalled (prune candidate)" quadrant
- AC4: Hover shows slug, human-readable size, convergence %, goal text
- AC5: Header shows a coarse correlation hint and the prune-candidate count; reuses `/api/fleet`
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P177 — Fleet Attention Heat Strip

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The Attention Scoreboard (P174) ranks projects but takes a full row each, so a large fleet scrolls off-screen and there is no single dense glance at overall fleet health. Operators want a compact "is anything red?" overview that fits entirely above the fold regardless of fleet size.

### Proposed Solution

Add a `/heat-strip` page rendering one small square cell per project in a wrapping grid, each cell colored by its composite attention score (reusing the same four-factor scoring as P174: budget, headroom, context-ETA, queue/circuit) on a green→amber→red ramp. Cells sort by score desc so hot cells cluster top-left. Hovering a cell shows slug, score, and dominant reason; clicking deep-links to `/focus/<slug>`. A header bar shows fleet-wide min/median/max attention. Extract the P174 scoring into a tiny shared `lib/attention.ts` so both pages share one source of truth. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/heat-strip` renders one cell per project, colored by composite attention score
- AC2: Scoring is shared with P174 via `lib/attention.ts` (no duplicated formula)
- AC3: Cells sorted by score desc; hover shows slug/score/reason; click → `/focus/<slug>`
- AC4: Header shows fleet min/median/max attention score
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Intelligence

---

## P178 — Project Vitals Radar Cards

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Per-project health is spread across budget, convergence, freshness, and context views. There is no single small-multiples surface where each project's overall shape is legible at once, making it hard to compare whole-project profiles side by side.

### Proposed Solution

Add a `/vitals` page rendering a responsive grid of small pure-SVG radar charts, one per project. Each radar has four normalized axes (0–1): convergence (`convergenceScore`), budget headroom (`1 − usage fraction`), freshness (`1 − ageMins/stuckThresholdMinutes`, clamped), and context headroom (`1 − contextUsagePct/100`). The filled polygon area gives an at-a-glance "bigger = healthier" read. Card header shows slug; missing axes render at zero with a muted spoke. Cards sort by mean axis value desc. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/vitals` renders one 4-axis radar per project (convergence, budget headroom, freshness, context headroom)
- AC2: All axes normalized 0–1; missing data renders at zero, not omitted
- AC3: Cards sorted by mean axis value desc; each labeled with slug
- AC4: Clicking a card deep-links to `/focus/<slug>`
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Intelligence

---

## P179 — Platform × State Matrix

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The Fleet Sunburst (P167) shows state-within-platform as nested arcs, but reading exact counts off arcs is imprecise. Operators sometimes want the plain cross-tab: how many projects sit at each (platform, state) intersection, with row/column totals.

### Proposed Solution

Add a `/platform-matrix` page rendering a matrix heatmap: rows = platform (discord/teams/whatsapp), columns = runtime state (idle/active/stalled/autonomous), each cell a count with background opacity ∝ count and a numeric label. Row and column totals are shown in a margin, plus a grand total. Empty cells render faint. Clicking a cell deep-links to a filtered fleet view (`/?platform=&state=` if supported, else `/`). Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/platform-matrix` renders a platform×state count matrix with numeric cells
- AC2: Cell background opacity ∝ count; empty cells faint
- AC3: Row totals, column totals, and grand total shown in margins
- AC4: Reuses `/api/fleet`; added to `NAV_GROUPS` under Observability

---

## P180 — Fleet Command Center

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Holistic situational awareness is spread across many pages: who needs attention (`/scoreboard`), what's queued (`/queue-board`), what's about to compact (`/context-eta`), and how much backlog is pending (`/backlog`). There is no single "control room" landing that fuses the top signals from each into one above-the-fold digest an operator can open first thing.

### Proposed Solution

Add a `/command-center` page with a compact multi-panel grid: (1) **Top attention** — the three highest-scoring projects from the shared `lib/attention.ts`, each with score + reason; (2) **Queue/breakers** — count of queued messages and open breakers, with the worst offender; (3) **Context imminent** — the soonest-to-compact project and its ETA; (4) **Backlog** — pending proposal count from `/api/backlog` and the oldest pending title. Each panel links to its full view. Reuses `/api/fleet` + `/api/backlog`; no new endpoint.

### Acceptance Criteria

- AC1: `/command-center` renders four panels: top-attention, queue/breakers, context-imminent, backlog
- AC2: Top-attention reuses `lib/attention.ts` (no duplicated scoring)
- AC3: Each panel deep-links to its corresponding full view
- AC4: Backlog panel reads `/api/backlog` for pending count + oldest pending title
- AC5: Graceful empty states per panel; reuses existing endpoints only
- AC6: Added to `NAV_GROUPS` under Intelligence

---

## P181 — Goal Status Funnel

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

Per-project `goalStatus` (active / paused / completed) is exposed in `/api/fleet` but never aggregated into a lifecycle view. Operators cannot see, at a glance, how the fleet's goals distribute across the active→paused→completed lifecycle, nor how many projects have no goal at all.

### Proposed Solution

Add a `/goal-funnel` page rendering a horizontal funnel (pure SVG): stacked proportional bars for active, paused, completed, and "no goal", each labeled with count and percentage, colored by status. A header shows the completion rate (completed ÷ projects-with-a-goal). Clicking a band deep-links to `/goals` (the existing goals view). Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/goal-funnel` renders proportional bars for active/paused/completed/no-goal
- AC2: Each band labeled with count and percentage; colored by status
- AC3: Header shows completion rate among projects that have a goal
- AC4: Reuses `/api/fleet`; added to `NAV_GROUPS` under Intelligence

---

## P182 — Convergence Distribution Histogram

**Status:** `[x] done`
**Created:** 2026-06-23

### Problem

The Convergence Gauge Wall (P166) shows each project's `convergenceScore` individually, but there is no view of the *distribution shape* — whether the fleet clusters near goal completion or is spread thin across low convergence. A histogram answers "is the fleet broadly converging?" in one glance.

### Proposed Solution

Add a `/convergence-dist` page rendering a pure-SVG histogram of `convergenceScore` bucketed into ten 0.1-wide bins (0–0.1 … 0.9–1.0). Bar height ∝ project count; bars colored on a red→amber→green ramp by bin position. Hovering a bar lists member slugs. Header shows the fleet mean convergence and the count of projects in the top bin (≥0.9). Only projects with a `convergenceScore` are counted. Reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/convergence-dist` renders a 10-bin histogram of `convergenceScore`
- AC2: Bar height ∝ count; color ramps red→green by bin position
- AC3: Hover lists member slugs of a bin
- AC4: Header shows fleet mean convergence and count in the ≥0.9 bin
- AC5: Reuses `/api/fleet`; added to `NAV_GROUPS` under Intelligence

---

## P183 — Fleet Convergence Trend Line

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The `convergence_history` table records a daily per-project `score`, but every convergence view is a snapshot of *today*: the Convergence Gauge Wall (P166) shows current per-project scores and the Convergence Distribution Histogram (P182) shows today's shape. Nothing plots the fleet's convergence **over time**, so operators cannot tell whether the fleet is trending toward its goals week-over-week or quietly stalling.

### Proposed Solution

Add a `/convergence-trend` page backed by a new `/api/convergence-trend` route that aggregates `convergence_history` across all slugs into one row per day for the last 14 days: fleet mean `score` and the count of projects in the top bin (score ≥ 90). Render a pure-SVG line/area chart of the daily mean (green→red gradient fill under the curve) with a secondary thin bar/line for the ≥0.9 count. Header shows the 14-day delta (today's mean minus the mean 14 days ago) with an up/down arrow.

### Acceptance Criteria

- AC1: `/api/convergence-trend` returns ≤14 daily rows, each with `date`, `meanScore`, `topBinCount`, aggregated across all slugs
- AC2: `/convergence-trend` plots daily fleet-mean convergence as an SVG line with gradient area fill
- AC3: The ≥0.9 project count is shown as a secondary series
- AC4: Header shows the 14-day delta with direction (▲ green / ▼ red)
- AC5: Empty history renders a placeholder, no crash; added to `NAV_GROUPS` under Intelligence

---

## P184 — Pinned Views Bar

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The dashboard now exposes 90+ views across four `NAV_GROUPS` categories, all funnelled through a single "All Views" dropdown. Operators who live in three or four specific views must reopen the dropdown and hunt for them on every visit. Spotlight (P154) helps find a view by name but offers no persistent quick-access for the handful an operator uses daily.

### Proposed Solution

Add a pin affordance to the navigation. Each item in `NavDropdown` gets a star toggle; pinned hrefs persist to `localStorage` (key `mc:pinnedViews`). A thin Pinned Views bar renders directly beneath the dashboard header showing pinned items in pin order as compact icon+label chips linking to each route. Cap at 8 pins; further stars are ignored with an inline "max 8 pinned" hint. The bar is hidden entirely when nothing is pinned.

### Acceptance Criteria

- AC1: A star toggle on each `NavDropdown` item pins/unpins that view
- AC2: Pins persist across reloads via `localStorage` (`mc:pinnedViews`)
- AC3: A Pinned Views bar under the header renders pinned items in pin order; clicking a chip navigates to its route
- AC4: Pinning is capped at 8 with an inline hint when exceeded
- AC5: The bar is absent (no empty shell) when no views are pinned

---

## P185 — Convergence Movers Leaderboard

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Even with the current convergence views, an operator cannot quickly see *which projects changed* — a project that dropped from 0.8 to 0.3 overnight looks identical to a steadily-low one on the Gauge Wall, and the distribution histogram hides per-project movement entirely. Day-over-day momentum is the early-warning signal that matters, and it is invisible today.

### Proposed Solution

Add a `/convergence-movers` page backed by `/api/convergence-movers`, which reads the last two `convergence_history` entries per slug and computes each project's day-over-day delta. Render two ranked columns: Climbers (largest positive deltas, green) and Fallers (largest negative deltas, red), each row showing slug, yesterday→today scores, and a small delta sparkbar. Projects with only one history entry (no prior day) are listed separately as "new". Header shows the net fleet delta.

### Acceptance Criteria

- AC1: `/api/convergence-movers` returns per-slug `{ slug, prev, curr, delta }` from the latest two `convergence_history` rows
- AC2: `/convergence-movers` shows ranked Climbers and Fallers columns colored by sign
- AC3: Each row shows prev→curr scores and a delta indicator
- AC4: Projects lacking a prior-day entry are grouped as "new", not ranked
- AC5: Header shows net fleet delta; empty state handled; added to `NAV_GROUPS` under Intelligence

---

## P186 — Convergence × Context Risk Matrix

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Two independent signals decide whether a project is in trouble: how close it is to its goal (`convergenceScore`) and how close it is to running out of context window (`contextUsagePct`). They are shown on separate pages, so the operator cannot see the one combination that matters most — projects that are **both** far from done **and** nearly out of context, which will stall hardest. There is no view that crosses these two axes.

### Proposed Solution

Add a `/convergence-risk` page: a pure-SVG scatter with x = `contextUsagePct` (0–100) and y = `convergenceScore` (0–1). Draw quadrant guides at x=70% and y=0.5, tinting the high-context / low-convergence quadrant red as the "at-risk" zone. Each project is a dot colored by its existing state; hover shows slug, both metrics, and state. Header counts projects in the at-risk quadrant. Only projects reporting both metrics are plotted; reuses `/api/fleet`.

### Acceptance Criteria

- AC1: `/convergence-risk` plots a scatter of x=`contextUsagePct` vs y=`convergenceScore`
- AC2: Quadrant guides at x=70% / y=0.5; high-context low-convergence quadrant tinted red
- AC3: Dots colored by project state; hover shows slug + both metrics + state
- AC4: Header counts projects in the at-risk quadrant
- AC5: Only projects reporting both metrics plotted; empty state; reuses `/api/fleet`; added to `NAV_GROUPS` under Intelligence

---

## P187 — Fleet Snapshot Scrubber

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The `fleet_snapshots` table records the fleet's idle/active/stalled/autonomous composition over time, but the only consumers are the snapshot detail API routes — there is no UI to *replay* how the fleet evolved. Operators reconstructing "when did things start going sideways?" have no scrubbable point-in-time view of historical fleet state.

### Proposed Solution

Add a `/snapshot-scrubber` page with a horizontal time slider bound to `fleet_snapshots`. Dragging the slider selects a snapshot; the page renders that snapshot's four state counts as neon stat tiles plus a sparkline of total active+autonomous across all snapshots with a marker at the selected point. Play/pause auto-advances through snapshots at ~1/sec. Reuses the existing snapshots API (extended to list snapshots if needed).

### Acceptance Criteria

- AC1: `/snapshot-scrubber` loads available `fleet_snapshots` and renders a time slider
- AC2: Dragging the slider updates the displayed idle/active/stalled/autonomous counts
- AC3: A sparkline of active+autonomous over all snapshots shows a marker at the selection
- AC4: Play/pause auto-advances through snapshots
- AC5: Empty history handled; added to `NAV_GROUPS` under Observability

---

## P188 — Goal Advancement Stream

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The `goal_advancement` table logs each time a project's goal status changes, but that history is only consumed inside the digest and goal-radar aggregates. There is no chronological, fleet-wide feed of goal transitions, so operators cannot see at a glance "what goals moved, and when" across the whole fleet.

### Proposed Solution

Add a `/goal-stream` page backed by a new `/api/goal-stream` route returning recent `goal_advancement` rows across all slugs, newest first. Render a vertical timeline: each entry shows slug, the status transition (from → to) with arrow and status-colored chips, and a relative timestamp. Group entries by day with sticky day headers. Reuses goal-status color conventions from the existing goal views.

### Acceptance Criteria

- AC1: `/api/goal-stream` returns recent `goal_advancement` rows across all slugs, newest first
- AC2: `/goal-stream` renders a vertical timeline of goal transitions
- AC3: Each entry shows slug, from→to status with colored chips, and relative time
- AC4: Entries grouped by day with sticky day headers
- AC5: Empty state; added to `NAV_GROUPS` under Intelligence

---

## P189 — Memory Theme Constellation

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Memory visibility today is per-project (footprint, decay, stream) or pairwise (similarity). Nothing shows the *shared conceptual structure* of the fleet's collective memory — which topics recur across many projects versus which are isolated. Operators cannot see the fleet's knowledge themes as a whole.

### Proposed Solution

Add a `/memory-constellation` page: a force-directed graph where nodes are frequent memory keywords/tags extracted from all projects' `MEMORY.md`, sized by occurrence count, and edges connect keywords that co-occur within the same project. Node color encodes how many distinct projects reference the keyword (isolated → shared). Backed by a new `/api/memory-constellation` route doing the keyword extraction and co-occurrence counting server-side. Hover a node to list the projects referencing it.

### Acceptance Criteria

- AC1: `/api/memory-constellation` extracts frequent keywords across all `MEMORY.md` and returns nodes + co-occurrence edges
- AC2: `/memory-constellation` renders a force-directed graph; node size ∝ occurrence
- AC3: Node color encodes distinct-project count (isolated → shared)
- AC4: Hover a node lists referencing projects
- AC5: Empty/sparse memory handled; added to `NAV_GROUPS` under Observability

---

## P190 — Alert Calendar Heatmap

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`alert_events` records when fleet alerts fire (stalls, budget breaches, circuit trips), but there is no view of *when* trouble clusters. Recurring trouble windows — e.g. every weekday afternoon — are invisible, so operators cannot correlate incidents with time-of-day or day-of-week patterns.

### Proposed Solution

Add an `/alert-calendar` page backed by a new `/api/alert-calendar` route that buckets `alert_events` into a day-of-week × hour-of-day grid (7×24). Render a heatmap where cell intensity ∝ alert count, on a transparent→red ramp. Hovering a cell shows the count and a breakdown by alert type. Header shows the busiest window and total alerts in range (last 30 days).

### Acceptance Criteria

- AC1: `/api/alert-calendar` buckets `alert_events` into a 7×24 day×hour grid over the last 30 days
- AC2: `/alert-calendar` renders the grid as a heatmap; intensity ∝ count on a transparent→red ramp
- AC3: Hover a cell shows count + breakdown by alert type
- AC4: Header shows the busiest window and total alert count
- AC5: Empty history handled; added to `NAV_GROUPS` under Intelligence

---

## P191 — Goal × Convergence Quadrant Map

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Two of the strongest per-project health signals — goal advancement and convergence — live on separate pages. Operators cannot see them *together*, so they cannot tell at a glance which projects are thriving (both high), which are converging on the wrong thing (high convergence, low goal progress), which are making progress but unstable (high goal, low convergence), and which are stalled (both low). A single combined view would let an operator triage the whole fleet in one look.

### Proposed Solution

Add a `/quadrant` page backed by a new `/api/quadrant` route. The route joins each project's latest `convergence_history` score (x-axis) with its latest `goal_advancement` score (y-axis) and returns one point per slug that has both. The page renders a futuristic 2-D scatter plot with the plane divided into four labelled quadrants by a midline at 50 on each axis: **Thriving** (high/high), **Drifting** (high convergence, low goal), **Grinding** (low convergence, high goal), **Stalled** (low/low). Each point is a glowing dot labelled with its slug, colored by quadrant. Hovering a dot shows the exact scores. The header shows per-quadrant counts.

### Acceptance Criteria

- AC1: `/api/quadrant` returns one point per slug having both a latest convergence and a latest goal score, plus per-quadrant counts
- AC2: `/quadrant` renders a scatter plot with goal (y) vs convergence (x), axes 0–100
- AC3: Plane divided into four labelled quadrants by midlines at 50; points colored by quadrant
- AC4: Hover a point shows slug and exact convergence/goal scores
- AC5: Empty state handled; added to `NAV_GROUPS` under Intelligence

---

## P192 — Convergence Sparkline Wall

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Convergence trend is shown fleet-aggregated (P183) or as a movers leaderboard (P185), but there is no compact, scannable view of *every* project's individual convergence trajectory side by side. Operators cannot spot which projects are trending up, flat, or collapsing without opening each one.

### Proposed Solution

Add a `/sparkline-wall` page backed by a new `/api/sparkline-wall` route returning, per slug, the last N days of `convergence_history` scores. Render a dense responsive grid of cards, one per project: slug label, latest score, a delta chip (vs first point in window), and an inline SVG sparkline of the series colored by overall direction (green up / red down / slate flat). Sort by steepest decline first so the projects needing attention surface at the top.

### Acceptance Criteria

- AC1: `/api/sparkline-wall` returns per-slug convergence series for the last N days
- AC2: `/sparkline-wall` renders a responsive grid of per-project sparkline cards
- AC3: Each card shows slug, latest score, delta chip, and an inline SVG sparkline colored by direction
- AC4: Cards sorted steepest-decline first
- AC5: Empty/single-point series handled; added to `NAV_GROUPS` under Intelligence

---

## P193 — Context Pressure Ridgeline

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`context_pressure` history is recorded per project but only the latest value and a single project's history are surfaced. There is no fleet-wide view of how context pressure is distributed and trending across all projects over time, so operators cannot anticipate which projects are approaching a context-exhaustion compaction.

### Proposed Solution

Add a `/pressure-ridgeline` page backed by a new `/api/pressure-ridgeline` route returning, per slug, a recent time-ordered series of `context_pressure` scores. Render a ridgeline (joyplot): stacked, slightly-overlapping area sparklines, one row per project, ordered by latest pressure descending. High-pressure rows glow amber→red. Each row labels its slug and latest score. This makes fleet-wide pressure distribution and trends legible at a glance.

### Acceptance Criteria

- AC1: `/api/pressure-ridgeline` returns per-slug recent context-pressure series
- AC2: `/pressure-ridgeline` renders stacked overlapping area sparklines (ridgeline), one per project
- AC3: Rows ordered by latest pressure descending; high-pressure rows colored amber→red
- AC4: Each row labels slug and latest score
- AC5: Empty history handled; added to `NAV_GROUPS` under Observability

---

## P194 — Alert Type Flow

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`alert_events` can be listed and bucketed by time (P190), but there is no view of *which projects generate which kinds of alerts*. Operators cannot see, for example, that one project dominates stall alerts while another dominates budget breaches — the slug↔alert-type relationship is invisible.

### Proposed Solution

Add an `/alert-flow` page backed by a new `/api/alert-flow` route that aggregates `alert_events` over the last 30 days into slug→alert-type counts. Render a two-column flow diagram (lightweight Sankey): left nodes are projects, right nodes are alert types, ribbons sized by count connect them, colored by alert type. Hovering a ribbon or node highlights its connections and shows the count. Header shows total alerts and the dominant project/type.

### Acceptance Criteria

- AC1: `/api/alert-flow` aggregates `alert_events` (last 30d) into slug→type counts
- AC2: `/alert-flow` renders a two-column flow/Sankey diagram of projects → alert types
- AC3: Ribbon thickness ∝ count; ribbons colored by alert type
- AC4: Hover highlights connected nodes/ribbons and shows the count
- AC5: Empty history handled; added to `NAV_GROUPS` under Intelligence

---

## P195 — Webhook Delivery Health

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The outbound alerting pipeline writes every webhook POST result to `webhook_deliveries` (status, response_code, error), but this data is only surfaced per-webhook via the `/api/webhooks/[id]/deliveries` drill-in. There is no fleet-wide view of delivery reliability, so operators cannot tell at a glance whether alerts are actually reaching their destinations — a silently failing webhook means missed alerts with no visible signal.

### Proposed Solution

Add a `/webhook-health` page backed by a new `/api/webhook-health` route that aggregates `webhook_deliveries` across all webhooks over the last 7 days: per-webhook success rate, total deliveries, recent failure count, last-failure timestamp, and an HTTP response-code distribution. Render a card grid (one card per webhook) showing name, a success-rate gauge (green ≥99% / amber ≥90% / red below), spark of daily volume, and the most recent error string. A header shows overall delivery success rate and count of webhooks currently degraded.

### Acceptance Criteria

- AC1: `/api/webhook-health` aggregates `webhook_deliveries` (last 7d) per webhook: success rate, totals, recent failures, last-failure ts, response-code distribution
- AC2: `/webhook-health` renders a per-webhook card grid with a success-rate gauge color-coded by threshold
- AC3: Each card shows recent volume spark and most-recent error string
- AC4: Header shows overall success rate and degraded-webhook count
- AC5: No-webhooks and no-deliveries states handled; added to `NAV_GROUPS` under Observability

---

## P196 — Alert Triage State

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`alert_events` has no lifecycle state — every alert is permanently "open." Operators cannot acknowledge or resolve an alert, so the Alert Calendar (P190), Alert Flow (P194), and Alerts list keep counting handled alerts as if they were still active. Recurring known-noise alerts drown out new, actionable ones and there is no way to track what has been dealt with.

### Proposed Solution

Add an `ack_ts` (nullable unix seconds) and `ack_by` (text) column to `alert_events` via an additive migration. Expose `acknowledgeAlert(id, actor)` / `unacknowledgeAlert(id)` db helpers and a `POST /api/alerts/[id]/ack` route (gated by the existing admin auth). Add an "Ack" / "Unack" button to each row in the Alerts list, with an acknowledged row dimmed and stamped with who/when. Add an `?open=true` filter so the list defaults to unacknowledged alerts. Aggregation routes that count "active" alerts gain an `includeAcked=false` default so dashboards stop counting handled noise.

### Acceptance Criteria

- AC1: Additive migration adds nullable `ack_ts` + `ack_by` to `alert_events`; existing rows unaffected
- AC2: `POST /api/alerts/[id]/ack` (and unack) updates state, gated by admin auth, writes an `audit_log` entry
- AC3: Alerts list shows Ack/Unack control; acknowledged rows dim and show actor + timestamp
- AC4: Alerts list supports an open-only filter that hides acknowledged alerts by default
- AC5: Alert count aggregates can exclude acknowledged alerts; no regression for callers that pass nothing

---

## P197 — Feed Freshness Wall

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Every dashboard page polls its own API feed and shows a per-page `FreshnessBadge`, but there is no single place to see which feeds across the whole app are stale or erroring. With 110+ views, an operator only discovers a broken or stalled data feed by happening to open the page that uses it — there is no fleet-wide data-plane health view.

### Proposed Solution

Add a `/freshness` page backed by a new `/api/freshness` route that probes the key data-producing tables (`fleet_snapshots`, `convergence_history`, `goal_advancement`, `context_pressure`, `turn_quality`, `alert_events`, `memory_diff_log`, `digest_log`) and returns, per feed, the most-recent row timestamp and row count in the last 24h. Render a status board: one row per feed with a colored dot (green = updated within its expected cadence, amber = late, red = silent/empty), the last-update relative time, and 24h volume. Feeds are sorted most-stale first so dead pipelines surface at the top. A header shows count of healthy / late / silent feeds.

### Acceptance Criteria

- AC1: `/api/freshness` returns per-feed last-row timestamp and 24h row count for the key data tables
- AC2: Each feed has an expected-cadence threshold; status computed as healthy / late / silent
- AC3: `/freshness` renders a status board sorted most-stale-first with colored status dots and relative last-update time
- AC4: Header summarizes healthy / late / silent feed counts
- AC5: Empty/never-populated feeds render as silent (not an error); added to `NAV_GROUPS` under Observability

---

## P198 — Alert Response Time (Triage SLA)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

P196 added an acknowledgement lifecycle to `alert_events` (`ack_ts` / `ack_by`), but nothing surfaces *how fast* alerts get triaged. Operators cannot see whether stall alerts sit unacknowledged for hours, which alert types are handled promptly, or whether response time is trending worse — there is no SLA visibility on the alert pipeline.

### Proposed Solution

Add a `/alert-sla` page backed by a new `/api/alert-sla` route that, over the last 30 days, computes time-to-acknowledge (`ack_ts − ts`) per alert. Aggregate by alert type: count, ack rate (% acknowledged), median and p90 time-to-ack, and current open (unacked) backlog with oldest-open age. Render a table/bar view: one row per alert type with an ack-rate gauge, median/p90 latency chips colored by threshold (green < 1h / amber < 6h / red beyond), and an open-backlog badge. Header shows fleet median time-to-ack and total open backlog.

### Acceptance Criteria

- AC1: `/api/alert-sla` returns per-type count, ack rate, median + p90 time-to-ack, open backlog count, oldest-open age (30d)
- AC2: `/alert-sla` renders one row per alert type with ack-rate gauge and median/p90 latency chips
- AC3: Latency chips colored by threshold (green < 1h / amber < 6h / red beyond)
- AC4: Header shows fleet median time-to-ack and total open backlog
- AC5: No-alerts and all-open (zero acknowledged) states handled; added to `NAV_GROUPS` under Intelligence

---

## P199 — Fleet Activity EKG

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Activity from different sources (alerts, injects, memory diffs, digests, broadcasts) is each viewable in isolation, but there is no single view of the fleet's overall *rhythm* across all sources at once. Operators cannot tell at a glance whether the fleet is quiet, spiking on alerts, or churning memory — the cross-source tempo is invisible.

### Proposed Solution

Add an `/ekg` page backed by a new `/api/ekg` route that buckets the last 48 hours of activity into hourly bins per source (`alert_events`, memory_diff_log, digest_log, broadcasts, and inject-type alerts). Render a stacked multi-lane "EKG" strip: one horizontal lane per source, each an inline area/bar sparkline of hourly volume, all sharing the same time axis so spikes line up vertically. Lanes are color-coded by source; hovering a column shows the per-source counts for that hour. Header shows total events and the busiest hour.

### Acceptance Criteria

- AC1: `/api/ekg` returns hourly per-source counts for the last 48h across the tracked sources
- AC2: `/ekg` renders one horizontal lane per source on a shared time axis
- AC3: Lanes color-coded by source; hovering a column shows per-source hourly counts
- AC4: Header shows total events and busiest hour
- AC5: Empty/quiet windows handled; added to `NAV_GROUPS` under Observability

---

## P200 — Proposal Impact Trace

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The backlog ships proposals continuously, but there is no view connecting a *shipped* proposal to its downstream effect on the project. Did convergence improve after a change merged? The proposal→outcome link is invisible, so the team cannot tell which kinds of work actually move the needle.

### Proposed Solution

Add an `/impact` page backed by a new `/api/impact` route that parses completed proposals from `BACKLOG.md` (done markers + created date) and, for the master project, overlays the `convergence_history` / `goal_advancement` series with markers at each proposal's ship date. Render a timeline: the convergence line with labelled flags where proposals landed, and a computed before/after delta (mean score in the 7 days before vs after each flag). A side list ranks recently shipped proposals by their measured convergence delta. Empty-data and single-point series handled gracefully.

### Acceptance Criteria

- AC1: `/api/impact` returns shipped proposals (id, title, ship date) joined with the convergence/goal series
- AC2: `/impact` renders a convergence timeline with labelled markers at each proposal ship date
- AC3: Each proposal shows a before/after convergence delta (7-day mean window)
- AC4: A side list ranks recently shipped proposals by measured delta
- AC5: Missing/sparse score data handled; added to `NAV_GROUPS` under Intelligence

---

## P201 — Memory × Convergence Correlation

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Memory churn (`memory_diff_log`) and convergence trend (`convergence_history`) are tracked separately, but their relationship is unexplored. Does a project that actively writes memory converge faster, or does heavy memory churn signal thrashing? There is no view to test this hypothesis across the fleet.

### Proposed Solution

Add a `/memory-convergence-xy` page backed by a new `/api/memory-convergence-xy` route that, per project over the last 30 days, computes total memory-diff activity (sum of added+removed lines, x-axis) and convergence change (latest − earliest score in window, y-axis). Render a scatter plot: each project a dot positioned by churn vs convergence-delta, sized by total diffs, colored green (improving) / red (declining). Quadrant guides separate "productive churn" (high churn, rising) from "thrashing" (high churn, falling). Hover shows project stats. Header shows the fleet correlation sign.

### Acceptance Criteria

- AC1: `/api/memory-convergence-xy` returns per-project memory churn and convergence delta over 30d
- AC2: `/memory-convergence-xy` renders a scatter of churn (x) vs convergence delta (y)
- AC3: Dots sized by total diffs, colored by convergence direction; quadrant guides drawn
- AC4: Hover shows per-project churn + delta; header shows fleet correlation sign
- AC5: Projects missing either series excluded cleanly; empty state handled; added to `NAV_GROUPS` under Intelligence

---

## P202 — Fleet Convergence Forecast

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`convergence_history` shows where each project *has been*, but the operator has no forward-looking signal: which projects are on track to reach a healthy convergence (≥90) soon, which are flat and need a nudge, and which are sliding backwards. Spotting a stall today means eyeballing a dozen sparklines. There is no single view that projects each project's trajectory and ranks them by time-to-target.

### Proposed Solution

Add a `/convergence-forecast` page backed by a new `/api/convergence-forecast` route. For each project with ≥3 convergence points in a 30-day window, fit a least-squares linear trend, derive slope/day and current score, and forecast the number of days to reach the 90 target (null when slope ≤ 0 or already ≥90). Classify each as `reached` / `rising` / `stalled` / `declining`. Render a leaderboard of project rows sorted by soonest ETA: each row shows the historical convergence sparkline with a dashed forecast extension drawn to the target line, current score, a slope arrow, and the ETA (e.g. "~6d", "stalled", "✓ reached"). Header shows how many projects are forecast to reach target within the window. Pure client compute on top of `getConvergenceSparklines` — no new DB function.

### Acceptance Criteria

- AC1: `/api/convergence-forecast` returns, per project (≥3 points/30d), current score, slope/day, etaDays, and status
- AC2: `/convergence-forecast` renders a leaderboard sorted by soonest ETA (reached last, declining flagged)
- AC3: Each row draws the historical sparkline plus a dashed forecast segment to the 90 target line
- AC4: Header shows count of projects forecast to reach target within the window; slope arrow + ETA per row
- AC5: Projects with <3 points excluded; flat/declining slopes yield null ETA; empty state handled; added to `NAV_GROUPS` under Intelligence

---

## P203 — Proposal Burnup Chart

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The Backlog Burndown (P156) shows remaining work trending toward zero, but it hides *scope growth*: when new proposals are added as fast as old ones ship, a flat burndown looks like no progress when in fact the team is both shipping and expanding scope. A burnup separates the two lines — cumulative shipped vs cumulative total — so scope changes are visible.

### Proposed Solution

Add a `/burnup` page backed by `/api/burnup` that parses `BACKLOG.md` for every proposal's created date and done date (done date approximated from the BACKLOG.md git commit that flipped its status, reusing the velocity route's git-log helper). Build a daily series over the project's lifetime with two cumulative lines: total proposals created and total proposals completed. Render a layered area/line chart where the gap between the lines is the open backlog; an expanding gap signals scope outpacing delivery. Header shows current scope, shipped count, and the 14-day scope-growth vs ship-rate.

### Acceptance Criteria

- AC1: `/api/burnup` returns a daily cumulative series of created vs completed proposal counts
- AC2: `/burnup` renders both cumulative lines with the open-backlog gap shaded between them
- AC3: Header shows total scope, total shipped, and 14-day created-rate vs ship-rate
- AC4: Done dates derived from BACKLOG.md git history; proposals with no completion counted as open
- AC5: Empty/sparse history handled; added to `NAV_GROUPS` under Intelligence

---

## P204 — Fleet Vitals Marquee

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The home dashboard surfaces many tiles, but there is no continuously-scrolling, glanceable summary band that an operator can leave on a wall display — a single strip that cycles the most important live fleet numbers (active projects, mean convergence, alerts open, token burn, stalled count) without interaction.

### Proposed Solution

Add a `/marquee` page backed by `/api/marquee` that aggregates a compact set of headline fleet metrics from existing helpers (instance count, mean convergence, open alerts, recent token burn, stalled-project count, proposals shipped this week). Render a full-bleed, auto-scrolling horizontal ticker of large cyber-styled metric cards that loops seamlessly, each card color-coded by health and updating on the standard freshness poll. Designed for an always-on display; respects `prefers-reduced-motion` by falling back to a static wrap.

### Acceptance Criteria

- AC1: `/api/marquee` returns the headline metric set aggregated from existing DB helpers
- AC2: `/marquee` renders an auto-scrolling, seamlessly-looping ticker of metric cards
- AC3: Cards are color-coded by health thresholds and refresh on the freshness poll
- AC4: `prefers-reduced-motion` falls back to a static, non-animated layout
- AC5: Empty/zero-data handled; added to `NAV_GROUPS` under Observability

---

## P205 — Convergence vs Memory Quadrant Brief

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Several views expose convergence, memory churn, and alerts separately, but the operator still has to synthesize "which projects need attention and why" by hand. There is no auto-generated, plain-language brief that names the at-risk projects and the reason.

### Proposed Solution

Add a `/brief` page backed by `/api/brief` that joins per-project convergence direction, memory churn, open alerts, and stall signals into a ranked list of short natural-language findings (e.g. "alpha: declining convergence with high memory churn — likely thrashing", "beta: stalled 4d, no memory writes — may be idle"). Each finding carries a severity and a deep-link to the most relevant existing view. Render as a prioritized briefing card stack with severity color rails. Purely derived from existing helpers; deterministic rule-based phrasing (no LLM call).

### Acceptance Criteria

- AC1: `/api/brief` returns ranked findings (slug, severity, message, deep-link href) from joined signals
- AC2: `/brief` renders a severity-sorted briefing stack with color rails and per-finding deep-links
- AC3: Findings use deterministic rule-based phrasing covering thrashing, stall, idle, and healthy cases
- AC4: Severity drives sort order and color; healthy fleet shows an explicit "all nominal" state
- AC5: Empty fleet handled; added to `NAV_GROUPS` under Intelligence

## P206 — Fleet Brief History & Trend

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The Fleet Brief (P205) and Fleet Advisor are both point-in-time: each render recomputes findings live and discards them. There is no record of how many issues the fleet carried yesterday vs today, so the operator cannot tell whether attention load is trending up or down, nor whether a recurring finding (e.g. one project that thrashes every day) is chronic. Every other intelligence view (convergence, burnup, velocity) has a time dimension; the brief does not.

### Proposed Solution

Persist a daily snapshot of brief findings. Add a `brief_snapshot` table (date, critical/warn/info counts, and the finding set as JSON) written once per day by the existing snapshot/scheduler path that already runs convergence rollups. Add `/api/brief-trend` returning the per-day severity counts over a window, and surface a compact severity-stacked sparkline in the `/brief` header plus a "Δ vs yesterday" badge per recurring slug. No new compute — reuse the P205 finding generator and store its output.

### Acceptance Criteria

- AC1: `brief_snapshot` table created with idempotent daily upsert keyed on date
- AC2: `/api/brief-trend` returns per-day critical/warn/info counts over a configurable window
- AC3: `/brief` header shows a severity-stacked sparkline of the trend
- AC4: A slug appearing in the brief on consecutive days is flagged as recurring/chronic
- AC5: Snapshot write reuses the P205 finding generator (no duplicate rule logic); empty fleet writes a zero row

## P207 — Slug-Focused Deep-Links from Brief & Advisor

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

A per-project drill-down page already exists at `/focus/[slug]`, but the Fleet Brief findings and Fleet Advisor cards deep-link to fleet-wide views (`/convergence-trend`, `/feed`, `/idle-fleet`). Clicking a finding about project `alpha` dumps the operator onto a view of *all* projects, who must then re-find `alpha` by hand. The most relevant destination for a single-project finding is that project's own focus page.

### Proposed Solution

Route per-project findings (those carrying a non-empty `slug`) to `/focus/<slug>` as the primary deep-link, keeping the fleet-wide view as a secondary "see in context" link. Where a fleet-wide view is genuinely more relevant (e.g. open-alert backlog → `/alert-flow`), retain it. Confirm `/focus/[slug]` surfaces the signals a finding references (convergence, churn, alerts) and extend it if a referenced signal is missing so the deep-link never lands on an empty section.

### Acceptance Criteria

- AC1: Brief findings with a slug deep-link to `/focus/<slug>` as the primary destination
- AC2: Advisor cards with a slug do the same, consistently with the brief
- AC3: Findings with no natural per-project home (fleet-wide) keep their fleet-view link
- AC4: `/focus/[slug]` renders the convergence, memory-churn, and alert signals referenced by findings
- AC5: No dead or empty-section deep-links — verified against the current finding rule set

## P208 — Unify Fleet Advisor & Fleet Brief Attention Engine

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The Fleet Advisor panel (P-era advisor) and the new Fleet Brief (P205) are two separate rule engines that both answer "which projects need attention and why," with overlapping but divergent logic (advisor covers circuit/context/budget; brief covers thrashing/stall/idle/alerts). The operator now has two surfaces that can disagree, and a future signal must be added to both. This is UX friction and a maintenance hazard.

### Proposed Solution

Extract a single shared finding-generation module (`lib/attention-findings.ts`) that emits a typed finding set from the joined signals, consumed by both `/api/advisor` and `/api/brief`. The advisor panel keeps its actionable-card framing (inject/distill/command); the brief keeps its narrative briefing framing — but both draw from one rule set so coverage and phrasing stay consistent. Deduplicate the per-project transcript/convergence/churn/alert reads behind the shared module.

### Acceptance Criteria

- AC1: `lib/attention-findings.ts` exports a single rule engine returning typed findings with severity, slug, message, signal source
- AC2: `/api/advisor` and `/api/brief` both consume it; no duplicated rule logic remains
- AC3: Signal reads (transcript mtime, convergence, churn, alerts) are shared, not re-implemented per route
- AC4: Existing advisor actions (inject/distill/command) and brief deep-links both preserved
- AC5: Adding a new rule requires editing exactly one file; covered by a unit test asserting both routes see it

## P209 — Attention Signal Timeline Heatmap

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

P208 unified all attention rules behind one engine that emits typed findings with a `signal` source (circuit/context/stall/idle/memory/budget/thrashing/declining/alerts). But findings are only ever shown as a *current* snapshot — there is no way to see *when* a signal fired or which signals recur for which project over time. The operator cannot answer "has beta been thrashing all week?" or "which signal dominates the fleet's attention load?".

### Proposed Solution

Persist each computed finding to an `attention_event` table (date, slug, signal, severity) via the same best-effort write already used for `brief_snapshot`, deduped per (date, slug, signal). Add `/api/signal-timeline` returning a signal × day matrix (counts per signal per day, plus per-slug breakdown), and a `/signal-timeline` page rendering a GitHub-style heatmap: rows = signal types, columns = days, cell intensity = number of projects firing that signal that day. Clicking a cell deep-links to `/brief` filtered context. Reuses the P208 finding generator; no new rule logic.

### Acceptance Criteria

- AC1: `attention_event` table with idempotent (date, slug, signal) upsert, written when `/api/brief` computes findings
- AC2: `/api/signal-timeline` returns a signal × day matrix with per-slug breakdown over a configurable window
- AC3: `/signal-timeline` renders a signal-row × day-column heatmap with intensity by project count
- AC4: Empty/no-history state handled; added to `NAV_GROUPS` under Intelligence
- AC5: Reuses the P208 `computeFindings` engine — no duplicated rule logic

## P210 — Scheduled Fleet Brief Digest to Discord

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The Fleet Brief (P205) and unified attention engine (P208) only surface findings when the operator opens the dashboard. For an autonomous harness the critical/warn findings should reach the operator proactively — a stalled or thrashing project can sit unseen for hours. There is no push path from the attention engine to Discord.

### Proposed Solution

Add a digest endpoint `/api/brief/digest` that renders the current critical+warn findings as a compact Markdown summary suitable for a Discord message (severity-grouped, deep-links as absolute URLs). Document a scheduler recipe that POSTs/pulls this digest into the master channel on a daily cadence. Include a de-dupe guard so an unchanged finding set is not re-sent (hash of finding ids vs the last sent hash, stored in a small state row). Purely additive; reuses `computeFindings`.

### Acceptance Criteria

- AC1: `/api/brief/digest` returns Markdown of current critical+warn findings, severity-grouped with absolute deep-links
- AC2: De-dupe guard suppresses re-send when the finding-id set is unchanged since last digest
- AC3: Empty/all-nominal fleet returns an explicit "all nominal" digest (or a documented no-send signal)
- AC4: Reuses the P208 engine; no duplicated rule logic
- AC5: README/scheduler note documents the daily master-channel digest recipe

## P211 — Signal Co-occurrence Force Graph

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Some attention signals travel together — thrashing usually rides with high context pressure; stalls cluster with budget exhaustion. The unified engine now labels every finding with a `signal`, but there is no view of which signals co-occur on the same project, so the operator cannot see the structural patterns behind fleet attention.

### Proposed Solution

Add `/api/signal-cooccurrence` that, over a window of `attention_event` history (from P209) or the live finding set, builds a co-occurrence graph: nodes = signal types (sized by frequency), edges = how often two signals fire on the same project (weighted). Render `/signal-graph` as a d3 force-directed graph reusing the existing MemoryGraph force-sim pattern, edge thickness = co-occurrence strength, node color by dominant severity. Hovering a node lists the projects currently firing it. Depends on P209's `attention_event` table for history (degrades to live-only if absent).

### Acceptance Criteria

- AC1: `/api/signal-cooccurrence` returns weighted nodes (signal, count) + edges (signalA, signalB, weight)
- AC2: `/signal-graph` renders a force-directed graph (reusing the MemoryGraph sim) with edge weight = co-occurrence
- AC3: Node size by frequency, color by dominant severity; hover lists affected projects
- AC4: Degrades gracefully when no `attention_event` history exists (live finding set only)
- AC5: Empty state handled; added to `NAV_GROUPS` under Observability

## P212 — Fleet Attention Sankey

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The unified attention engine (P208) labels every finding with `slug`, `signal`, and `severity`, but there is no view of how attention *flows* across the fleet — which projects feed which signals, and how those signals roll up by severity. The co-occurrence force graph (P211) shows signal↔signal structure but not the project→signal→severity volume breakdown an operator needs to see where the fleet's attention budget actually goes.

### Proposed Solution

Add `/api/attention-sankey` that runs `computeFindings()` over the live fleet and returns a three-layer flow: project → signal → severity. Render `/attention-sankey` as a d3-sankey diagram (reusing the proposal-flow rendering pattern; `d3-sankey` is already a dependency). Link width = finding count; severity column colored critical/warn/info. Hovering a link isolates the project→signal→severity path. Project node labels deep-link to the project (P207 slug-focused deep-links).

### Acceptance Criteria

- AC1: `/api/attention-sankey` returns `{ nodes, links }` with three node kinds (project, signal, severity) and link `value` = finding count
- AC2: `/attention-sankey` renders a 3-layer sankey; link width scales with count; severity nodes colored by severity
- AC3: Healthy/`ok` findings excluded so the view shows only attention-worthy flow
- AC4: Hover isolates a single flow path; project labels deep-link to `/project/<slug>` (or the slug-focused view)
- AC5: Empty state handled when no attention findings exist; added to `NAV_GROUPS` under Observability

## P213 — Unified Entity Graph (Project ⇄ Memory ⇄ Proposal)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Project runtime state, memory files, and specclaw proposals each have their own views, but nothing shows them together as one connected graph. The north-star "holistic project/memory/proposal visibility" requires a single canvas where an operator can see a project, the memories it owns, and the proposals it is working — and how they interrelate.

### Proposed Solution

Add `/api/entity-graph` that returns a tri-partite node set (projects, memories, proposals) with edges project→memory (ownership, from `/api/memories`) and project→proposal (from `/api/backlog`). Render `/entity-graph` as a force-directed graph reusing the MemoryGraph sim; node shape/color by entity kind, project nodes sized by combined memory+proposal degree. Filter chips toggle each entity layer. Clicking a node opens a detail drawer.

### Acceptance Criteria

- AC1: `/api/entity-graph` returns typed nodes (kind: project|memory|proposal) and edges with no orphan references
- AC2: `/entity-graph` renders a force graph; project nodes sized by degree; color by kind
- AC3: Layer toggle chips show/hide memory and proposal nodes independently
- AC4: Node click opens a drawer with entity details and a deep-link
- AC5: Empty state handled; added to `NAV_GROUPS` under Observability

## P214 — Attention Radial Clock

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The attention signal timeline (P209) is a linear heatmap; it does not reveal *time-of-day* patterns — whether stalls cluster overnight, or context pressure peaks during scheduled-job windows. Operators tuning schedules need a circadian view.

### Proposed Solution

Add `/api/attention-clock` that buckets `attention_event` history into 24 hour-of-day slots × signal, returning per-hour counts and dominant severity. Render `/attention-clock` as a radial/polar chart (24 spokes = hours, concentric rings = signals, arc color by severity). Hovering a wedge shows the signal, hour, count, and affected projects.

### Acceptance Criteria

- AC1: `/api/attention-clock` returns 24 hour buckets × signal with counts and dominant severity
- AC2: `/attention-clock` renders a radial 24-hour chart; arc color by severity
- AC3: Hover shows signal, hour-of-day, count, affected project count
- AC4: Degrades to empty state when no `attention_event` history exists
- AC5: Added to `NAV_GROUPS` under Observability

## P215 — Memory ⇄ Proposal Theme Bridge

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Memories capture "what we learned" and proposals capture "what we plan", but the connection between them is invisible. When a proposal's theme overlaps an existing memory (e.g. a recurring pattern already recorded), the operator should see it — to avoid re-learning, and to ground proposals in prior knowledge.

### Proposed Solution

Add `/api/memory-proposal-bridge` that computes token-overlap (or shared theme tags) between memory descriptions and proposal titles/problem statements across the fleet, returning weighted memory↔proposal links above a threshold. Render `/memory-bridge` as a bipartite graph (memories left, proposals right) with edge weight = overlap strength. Hovering a link shows the matched terms.

### Acceptance Criteria

- AC1: `/api/memory-proposal-bridge` returns memory nodes, proposal nodes, and weighted overlap edges above a min threshold
- AC2: `/memory-bridge` renders a bipartite graph; edge thickness = overlap strength
- AC3: Hover shows the matched terms/themes driving the link
- AC4: Threshold tunable via query param; empty state when no overlaps found
- AC5: Added to `NAV_GROUPS` under Intelligence

## P216 — Fleet Command Bridge (Situational Overview)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

An operator returning to the dashboard must visit many views to reconstruct fleet state: who needs attention, what's stalled, which proposals are pending, which memories are stale. There is no single "command bridge" that fuses the top signals from each domain into one at-a-glance overview.

### Proposed Solution

Add `/command-bridge` — a composite dashboard that fuses the top N from the attention engine (advisor cards), pending proposal count + oldest age, stalled/circuit-open projects, and stalest memories into a single grid of compact status panels. Each panel reuses an existing API (`/api/advisor`, `/api/backlog`, `/api/fleet`, `/api/memory-health`) and deep-links to its full view. Auto-refreshes; panels reorder so the most urgent domain floats to the top.

### Acceptance Criteria

- AC1: `/command-bridge` renders ≥4 domain panels (attention, proposals, runtime/stalls, memory) from existing APIs
- AC2: Each panel shows a headline metric + top 1-3 items and deep-links to its full view
- AC3: Panels are ordered by urgency (most critical domain first)
- AC4: Auto-refreshes on an interval; empty/healthy states handled per panel
- AC5: Added to `NAV_GROUPS` under Observability

## P217 — Schedule Run History & Outcome Tracker

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Schedules fire and only `runCount` + `lastRunAt` are tracked. No record of whether a task succeeded, what reply snippet was produced, or how long it took. An operator cannot tell if scheduled tasks are actually working or silently failing — especially since scheduled messages are injected without producing Discord replies from the bot itself.

### Proposed Solution

Persist schedule run outcomes to a `schedule_run` SQLite table (id, schedule_id, slug, fired_at, reply_snippet, turn_duration_ms, status). Extend the scheduler's fire path to write a row after each run (best-effort, non-blocking). Add `/api/schedule-runs` returning per-schedule history and aggregate stats (success rate, avg duration). Add `/schedule-history` page: a per-schedule accordion with a run timeline (calendar heatmap of fire dates), outcome badges (ok / empty-reply / error), and expandable reply snippets. Reuses the `/schedules` API for the schedule list.

### Acceptance Criteria

- AC1: `schedule_run` table created with migration; existing DB unaffected
- AC2: Scheduler writes a row after each fire with status `ok` or `error`, reply snippet ≤ 200 chars, and duration
- AC3: `/api/schedule-runs` returns all rows grouped by schedule_id with success_rate and avg_duration_ms
- AC4: `/schedule-history` renders per-schedule calendar heatmap + outcome badge table; empty state when no runs
- AC5: Added to `NAV_GROUPS` under Automation

## P218 — Operator Command Log

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Master channel commands (`!project ...`) are ephemeral Discord messages. There is no audit trail of who ran what verb, when, and whether it succeeded. An operator reviewing an incident ("why did project X stop?") has no structured log to consult.

### Proposed Solution

Log each parsed master command to a `command_log` SQLite table (id, ts, user_id, username, verb, args_json, outcome_snippet, error). Write the row in `master-commands.ts` after each verb handler resolves (best-effort). Add `/api/command-log` returning time-ranged entries with verb frequency counts. Add `/command-log` page: filterable table (by verb, by user, by date range), a bar chart of verb frequency over time, and an error-rate summary. No PII beyond what's already in Discord messages.

### Acceptance Criteria

- AC1: `command_log` table created; verb, ts, user_id, outcome_snippet stored for every parsed master command
- AC2: Errors (thrown in handlers) recorded with error field set; successes set outcome_snippet to first 150 chars of reply
- AC3: `/api/command-log` supports `?verb=`, `?since=`, `?until=` filters; returns entries and verb frequency map
- AC4: `/command-log` renders sortable table + verb frequency bar chart; empty state handled
- AC5: Added to `NAV_GROUPS` under Observability

## P219 — Context Runway (Per-Project Turn Horizon)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

`/context-pressure` shows current % of context used but not "at this burn rate, how many turns until the session hits the limit?" Operators cannot proactively `!project stop` and resume a session before it stalls at the context ceiling, causing the next user message to fail or produce degraded output.

### Proposed Solution

From each project's active JSONL transcript, compute tokens consumed per turn (rolling 5-turn average) and extrapolate turns-remaining = `(context_limit - tokens_used) / avg_tokens_per_turn`. Add `/api/context-horizon` returning per-project `{slug, tokens_used, context_limit, avg_per_turn, turns_remaining, estimated_hours_remaining}` (using avg inter-turn interval). Add `/context-horizon` page: horizontal runway bars per project (green → yellow → red as turns_remaining shrinks), a fleet summary badge ("N projects within 5 turns of limit"), and a "Needs Reset" call-out list. Threshold for warning: < 10 turns remaining.

### Acceptance Criteria

- AC1: `/api/context-horizon` returns accurate tokens_used from active JSONL and a turns_remaining estimate
- AC2: avg_per_turn uses rolling 5-turn window, not lifetime average
- AC3: `/context-horizon` renders runway bars colored by turns_remaining (<5 red, <10 yellow, ≥10 green)
- AC4: Fleet summary badge counts projects with turns_remaining < 10
- AC5: "Needs Reset" panel lists projects below threshold with last-active time; added to `NAV_GROUPS` under Runtime

## P220 — Memory Type Distribution Sunburst

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Memory health (`/memory-health`) surfaces staleness but not *composition* — whether a project's memory set is dominated by `project` memories with no `user` or `feedback` coverage. An operator tuning a project's Claude behavior cannot see the memory type balance at a glance.

### Proposed Solution

Parse each project's memory files for the `type:` frontmatter field (user / feedback / project / reference). Add `/api/memory-distribution` returning per-project type counts and a fleet-level rollup. Render `/memory-distribution` as a two-level zoomable sunburst (d3, reusing the fleet-sunburst rendering pattern): outer ring = projects, inner ring segments = memory types colored by category. Click a project slice to drill into a filtered `/memory-health` view for that project. Fleet total shown in center. Hover tooltip shows type name + count + % of project total.

### Acceptance Criteria

- AC1: `/api/memory-distribution` reads all project memory files, parses `type:` from YAML frontmatter, returns per-project type breakdown and fleet rollup
- AC2: Unknown/missing type field bucketed as `other`
- AC3: `/memory-distribution` renders zoomable sunburst; clicking project slice navigates to filtered memory-health view
- AC4: Hover shows type label, count, and percentage
- AC5: Empty state (no memory files found) renders a blank sunburst with explanatory text; added to `NAV_GROUPS` under Memory

## P221 — Fleet Operational Timeline (Cross-Project Activity Swimlanes)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

No view shows cross-project *operational* activity over time: when was each project's last turn, how long did it run, which projects were active simultaneously, and where are the long idle gaps. The proposal gantt covers planning; this covers execution. Operators tuning schedules or diagnosing congestion periods have no timeline to consult.

### Proposed Solution

From all active JSONL transcripts, extract turn start/end timestamps and tool-call counts per turn. Add `/api/fleet-timeline` returning per-project turn segments `{slug, start, end, tool_count, token_count}` over a configurable window (default 24h). Render `/fleet-timeline` as a swimlane chart (one row per project, horizontal bars = turns) using d3 or a lightweight canvas approach, bar color intensity = tool_count. Hover shows turn summary (duration, tools, tokens). A vertical "now" line + idle gap highlights (gray fill between turns > 30 min). Window selector: 6h / 24h / 7d. Depends only on existing JSONL transcript files — no new DB writes.

### Acceptance Criteria

- AC1: `/api/fleet-timeline` parses JSONL transcripts and returns turn segments with start/end/tool_count/token_count for the requested window
- AC2: `/fleet-timeline` renders one swimlane per active project; bars sized proportionally to duration
- AC3: Idle gaps > 30 min highlighted; hover shows turn summary
- AC4: Window selector (6h/24h/7d) adjusts the query and re-renders without page reload
- AC5: Added to `NAV_GROUPS` under Observability; graceful empty state when no transcript data found

## P222 — Live Turn Activity Feed (Real-time JSONL Tail)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The fleet timeline (`/fleet-timeline`) shows historical swimlanes, but there is no live view of what is happening right now across all projects — which project is currently responding, how many tool calls it has made in the current turn, and when did it last produce output. Operators monitoring an active session must manually check individual project channels.

### Proposed Solution

Add `/api/live-turns` that reads the last N bytes of each project's active JSONL file, extracts the most recent assistant turn in progress (or the last complete turn), and returns per-project `{slug, state: 'active'|'idle', lastToolName, toolCountThisTurn, lastOutputAt, currentTurnStart}`. Poll every 5 seconds. Render `/live-turns` as a stacked live feed: projects sorted by `lastOutputAt` desc, each row shows slug + activity indicator (pulsing dot if active), current turn duration, last tool name, and tool count. Auto-refreshes via `useFreshness` at 5s. No DB writes.

### Acceptance Criteria

- AC1: `/api/live-turns` reads last 4KB of each project's active JSONL, returns per-project turn state
- AC2: Projects with assistant output in the last 60s classified as `active`; others `idle`
- AC3: `/live-turns` renders pulsing dot for active projects; rows sorted by recency
- AC4: Shows: current turn duration, last tool name, tool count this turn, time since last output
- AC5: Refreshes every 5s; empty state when no active transcripts; added to nav under Observability

## P223 — Token Budget Burn Comparison (Multi-Project Cost Race)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The cost page (`/cost`) shows per-project totals. The burn-rate page shows velocity. But there is no view that shows all projects on the same axis — a "race chart" of cumulative token spend over time — so an operator can see which project is consuming budget fastest relative to others and whether spending is accelerating or plateauing.

### Proposed Solution

Reuse JSONL transcript data (already parsed by `/api/cost`). For each project, build a daily cumulative token spend series (output_tokens per day from assistant turns). Add `/api/token-race` returning per-project daily cumulative series over a configurable window (default 30d). Render `/token-race` as a multi-line chart: x = days, y = cumulative output tokens, one line per project, colored by slug hash. Lines animate from left on load. Hover shows per-project cumulative at that day. A "today" vertical marker. Legend sorted by total spend desc. Toggle between absolute and normalized (pct of max) view.

### Acceptance Criteria

- AC1: `/api/token-race` returns daily cumulative output-token series per project from JSONL over configurable window
- AC2: `/token-race` renders multi-line chart with one colored line per project; x=day, y=cumulative tokens
- AC3: Hover shows all projects' values at hovered day (cross-hair or tooltip)
- AC4: Absolute/normalized toggle; legend sorted by total desc
- AC5: Added to nav under Intelligence; graceful empty state

## P224 — Session Health Heatmap (Per-Project Turn Quality Calendar)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Turn quality scores (`/turn-quality`) exist per turn but are shown as a table. There is no calendar view of whether a given project had good or bad days — whether quality is trending down week over week, or whether weekends produce worse turns (e.g. scheduled tasks with no human oversight).

### Proposed Solution

Reuse the `turn_quality` table (already populated). Add `/api/session-health-calendar` that aggregates per-project daily average turn quality over a configurable window (default 90d). Render `/session-health-calendar` as a GitHub-style per-project quality calendar: each project gets its own row of day squares (green=good/80+, yellow=medium/50-79, red=bad/<50, gray=no turns). Clicking a day square navigates to `/turn-quality?slug=X&date=Y`. Fleet aggregate row at top. Window: 30/60/90d selector.

### Acceptance Criteria

- AC1: `/api/session-health-calendar` returns per-project daily avg turn quality from `turn_quality` table
- AC2: `/session-health-calendar` renders per-project calendar rows (day squares colored green/yellow/red/gray)
- AC3: Fleet aggregate row at top showing worst-day and best-day markers
- AC4: Click day square navigates to `/turn-quality?slug=X&date=Y`
- AC5: 30/60/90d window selector; added to nav under Intelligence

## P225 — Idle Recovery Tracker (First-Turn Reactivation Quality)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Projects that were idle for hours or days often produce poor first turns after reactivation — context is stale, the session may have been resumed, and the model may hallucinate past state. There is no view that specifically tracks reactivation events (idle → active transitions) and whether the first turn back was a quality recovery or a confusion event.

### Proposed Solution

From transcript JSONL + `turn_quality` scores, detect reactivation events: idle gap ≥ 2h preceding a user turn. For each reactivation, record `{slug, gap_hours, first_turn_quality, first_turn_tool_count, resumed}`. Add `/api/idle-recovery` returning reactivation events over a 90d window. Render `/idle-recovery` as a scatter plot: x = idle gap hours (log scale), y = first-turn quality score, color = whether session was resumed (vs fresh). Tooltip shows slug + gap + quality. A horizontal line at quality=50 separates recovery/confusion. Trend line: does longer idle → worse quality?

### Acceptance Criteria

- AC1: `/api/idle-recovery` detects reactivation events (idle gap ≥ 2h) from JSONL, joins with `turn_quality`
- AC2: Returns events with gap_hours, first_turn_quality, tool_count, resumed flag
- AC3: `/idle-recovery` renders scatter plot x=log(gap_hours) y=quality, colored by resumed
- AC4: Hover tooltip; quality=50 reference line; optional trend line
- AC5: Added to nav under Intelligence; graceful empty state with explanation

---

## P226 — Tool Call Frequency Heatmap (Per-Project MCP Usage)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Operators have no view of which MCP tools each project calls most frequently, whether tool usage patterns are shifting over time, or which projects are outliers in tool diversity. The live-turns feed shows the last tool called, but there is no aggregated view of tool call distributions.

### Proposed Solution

Parse all project JSONL transcripts, extract `tool_use` blocks, group by `project slug × tool name × day`. Add `/api/tool-frequency` returning per-project tool call counts with optional `?slug=` and `?days=` filters. Render `/tool-frequency` as a heatmap grid: rows = tool names (sorted by total calls desc), columns = days (last 30d), cell intensity = call count. Project selector dropdown. Cells clickable to drill into that day's turns. Top-5 tools bar chart sidebar. Suppress `mcp__mcd__*` tools by default (toggle to include).

### Acceptance Criteria

- AC1: `/api/tool-frequency` parses JSONL `tool_use` blocks and returns slug×tool×day counts for configurable window
- AC2: `/tool-frequency` renders heatmap grid rows=tools, cols=days, intensity=count
- AC3: Project selector; clicking cell shows turn list for that day/tool combo
- AC4: Top-5 tools sidebar sorted by total; mcp__mcd__ suppressed by default with toggle
- AC5: Added to nav under Intelligence; graceful empty state

---

## P227 — Circuit Breaker Timeline (Open/Close Event Log)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The fleet view shows current circuit state (open/closed) per project but has no history of when circuits opened or closed, how long they stayed open, or whether certain projects trip repeatedly. Operators diagnosing flaky projects need a timeline of circuit events.

### Proposed Solution

Instrument `ClaudeProjectProcess` to append a line to `circuit-events.jsonl` (under project dir) whenever circuit state changes: `{ts, slug, event: 'open'|'close', reason, stuckCount}`. Add `/api/circuit-timeline` reading these files across all projects, returning events sorted by ts desc with pagination. Render `/circuit-timeline` as a vertical event stream (like a git log): each entry shows slug badge, event type (red OPEN / green CLOSE), timestamp, reason, and duration-open for close events. Filter by slug or event type. Rolling 30d window.

### Acceptance Criteria

- AC1: `ClaudeProjectProcess` writes `circuit-events.jsonl` on every state transition with ts/slug/event/reason/stuckCount
- AC2: `/api/circuit-timeline` reads all project `circuit-events.jsonl` files, returns sorted events with duration-open for CLOSE entries
- AC3: `/circuit-timeline` renders vertical event stream: OPEN=red badge, CLOSE=green, duration for each open period
- AC4: Slug and event-type filters; 30d window; pagination
- AC5: Added to nav under Observability; graceful empty state; bot restart not required (JSONL appended at runtime)

---

## P228 — Proposal Coverage Heatmap (BACKLOG.md Progress Calendar)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

The BACKLOG.md is the project's living roadmap, but there is no visual summary of how many proposals were completed per week, where implementation velocity is slowing, or how many items are in each status bucket at a glance.

### Proposed Solution

Parse `BACKLOG.md` from `MCD_CHANNELS_DIR/../projects/claude-mcd/BACKLOG.md` (resolved via git remote or a configured path). Extract proposal entries: number, title, status (`done`/`pending`/`in_progress`), created date. Add `/api/backlog-coverage` returning proposal list + per-week completion counts + status breakdown. Render `/backlog-coverage`: GitHub contribution-calendar-style weekly grid (green=done, yellow=in_progress, gray=pending), sorted by created date. Sidebar: total counts per status, velocity (proposals/week last 4 weeks vs prior 4 weeks), next 3 pending items listed.

### Acceptance Criteria

- AC1: `/api/backlog-coverage` parses BACKLOG.md, returns proposals with number/title/status/created + weekly completion series
- AC2: `/backlog-coverage` renders weekly calendar grid colored by completion density
- AC3: Sidebar shows status counts, velocity comparison (last 4w vs prior 4w), next-3 pending
- AC4: Clicking a week cell lists proposals completed that week in a drawer
- AC5: Added to nav under Intelligence; fallback when BACKLOG.md not accessible

---

## P229 — Agent Spawn Tree (Subagent Hierarchy Visualizer)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Many Claude turns spawn subagents via the `Agent` tool. The JSONL transcript records these as nested tool calls, but there is no visual showing how deep the spawn tree goes, how many subagents were created per turn, or which tools the subagents called. Operators debugging expensive turns have no tree view.

### Proposed Solution

Parse JSONL for turns containing `Agent` tool_use blocks. Recursively extract subagent tool calls from the tool_result content. Build a spawn tree: root = user message, level 1 = top-level agent calls, level 2+ = nested calls (if detectable). Add `/api/agent-tree?slug=X&turn=N` returning the spawn tree as a nested JSON. Render `/agent-tree` as a collapsible tree (CSS-only, no heavy library): each node shows tool name, duration, token cost. Color by depth. Total cost and depth stats in header. Project+turn selector.

### Acceptance Criteria

- AC1: `/api/agent-tree` parses JSONL and extracts nested Agent tool_use/tool_result chains, returns as nested JSON tree
- AC2: `/agent-tree` renders collapsible indented tree; depth color-coded; duration and tokens per node
- AC3: Total turn cost (tokens + time) shown in sticky header
- AC4: Project selector + turn picker (list of turns with agent calls)
- AC5: Added to nav under Intelligence; graceful empty state for projects with no agent calls

---

## P230 — Memory Staleness Radar (Per-Project Memory Age & Coverage)

**Status:** `[x] done`
**Created:** 2026-06-24

### Problem

Each project accumulates memory files under `memory/`. There is no view of how old memories are, whether a project has gone weeks without any memory updates, or whether memory coverage (number of memories vs project age) is declining. Operators cannot spot memory rot.

### Proposed Solution

For each project, scan `memory/*.md` files: read `mtime` and frontmatter type. Compute per-project stats: total memories, oldest memory age (days), newest memory age (days), type breakdown, memory density (memories per week of project age). Add `/api/memory-staleness` returning these stats. Render `/memory-staleness` as a radar/spider chart: 5 axes — freshness (newest age), density (memories/week), diversity (type count), depth (avg body length), coverage (memories vs turns ratio). One polygon per project (color = slug hash). Legend sorted by staleness score desc. Hovering a project's polygon highlights it and shows per-axis values.

### Acceptance Criteria

- AC1: `/api/memory-staleness` scans `memory/*.md` for all projects, computes freshness/density/diversity/depth/coverage axes
- AC2: `/memory-staleness` renders radar/spider chart with one polygon per project
- AC3: Hover highlights project polygon and shows all 5 axis values in tooltip
- AC4: Legend sorted by staleness score (weighted composite of all axes) desc
- AC5: Added to nav under Intelligence; graceful empty state when no memory files found

---

## P231 — Turn Duration Histogram (Wall-Clock Timing Per Project)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The JSONL transcript records `tool_use` and `tool_result` blocks with timestamps, but there is no view of how long individual Claude turns take wall-clock. Operators cannot tell whether a project consistently runs fast 30-second turns or slow 10-minute turns, making it hard to tune the stuck-watchdog threshold or spot performance regressions after a model change.

### Proposed Solution

Parse JSONL transcripts for each project: compute per-turn duration as `first_tool_use.ts → last_tool_result.ts` (or `human_message.ts → next_human_message.ts` as fallback). Add `/api/turn-duration?slug=X&window=30` returning a histogram (bucket by minute) and summary stats (p50, p90, p99, max). Render `/turn-duration` as a stacked histogram (all projects in one view, color-coded by slug); project selector to focus on one. Stats panel shows p50/p90/max per project. Dotted line at current `stuckThresholdMinutes` per project so operator can see how many turns would have been killed.

### Acceptance Criteria

- AC1: `/api/turn-duration` computes per-turn wall-clock durations from JSONL timestamps, returns histogram + percentiles
- AC2: `/turn-duration` renders stacked histogram with color per project slug
- AC3: Project selector focuses on one slug; stats panel shows p50/p90/max
- AC4: Dotted line overlay at each project's `stuckThresholdMinutes`; turns exceeding it highlighted in red
- AC5: Added to nav under Observability; graceful empty state when no turns with timing data

---

## P232 — Tool Co-occurrence Matrix (Which Tools Appear Together)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

P226 shows how often each tool is called individually, but not whether certain tools always appear together in the same turn. A co-occurrence matrix would reveal patterns like "Agent always precedes WebSearch" or "Read + Edit are always paired," helping operators understand workflow patterns and catch unexpected tool combinations.

### Proposed Solution

Parse JSONL `tool_use` blocks, grouping calls by turn (delimited by `human` role messages). For each pair of tools that appear in the same turn, increment a co-occurrence count. Add `/api/tool-cooccurrence?slug=X&window=30` returning a symmetric N×N matrix (tool × tool → count). Render `/tool-cooccurrence` as an SVG heatmap grid: rows and columns are tools sorted by total frequency, cell color = co-occurrence count, diagonal = solo count. Click a cell to see turns where that pair appears. Project selector; `mcp__mcd__*` suppressed by default with toggle.

### Acceptance Criteria

- AC1: `/api/tool-cooccurrence` groups JSONL tool_use by turn and returns symmetric co-occurrence matrix
- AC2: `/tool-cooccurrence` renders SVG grid; rows/cols sorted by total frequency; cell intensity = count
- AC3: Click a cell lists turns containing that tool pair in a side drawer
- AC4: Project selector; mcp__mcd__ tools hidden by default; toggle reveals them
- AC5: Added to nav under Intelligence; graceful empty state when fewer than 2 distinct tools found

---

## P233 — Circuit Breaker MTTR Dashboard (Recovery Time Analytics)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

P227 shows a timeline of circuit open/close events but provides no aggregate analysis. Operators need to know: which projects trip most frequently, what is the mean time to recovery (MTTR) once the circuit opens, and whether MTTR is improving or worsening over time. Without aggregates, operators must manually count events in the timeline.

### Proposed Solution

Read all `circuit-events.jsonl` files (already written by project-pool). Compute per-project: total opens, total closes, MTTR (avg duration-open from `durationMs` field), longest open window, opens per week, last event. Add `/api/circuit-mttr` returning these stats. Render `/circuit-mttr` as a sortable table (slug, opens, closes, MTTR, longest, opens/week) with a sparkline column showing opens-per-day last 30 days. Color MTTR green/amber/red by threshold. Click row drills into P227 circuit timeline filtered to that slug.

### Acceptance Criteria

- AC1: `/api/circuit-mttr` aggregates circuit-events.jsonl per project: total opens/closes, avg MTTR, longest open, opens-per-week
- AC2: `/circuit-mttr` renders sortable table with per-project rows + sparkline column (opens/day last 30d)
- AC3: MTTR cell color-coded green (<2min) / amber (<10min) / red (≥10min)
- AC4: Clicking a row opens `/circuit-timeline?slug=<slug>` for drill-down
- AC5: Added to nav under Observability; handles missing circuit-events.jsonl gracefully (project row omitted)

---

## P234 — Backlog Completion Forecast (Velocity → Done Date)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

P228 shows historical proposal completion velocity but gives no answer to "at this rate, when does the backlog clear?" Operators planning releases or setting milestones have no data-driven estimate of how many weeks of work remain.

### Proposed Solution

Extend `/api/backlog-coverage` (or add `/api/backlog-forecast`) to compute: rolling 4-week completion velocity (proposals/week), remaining pending count, and estimated weeks to completion = pending / velocity. If velocity is zero, report "stalled." Render `/backlog-forecast` as a burndown projection: X-axis = future weeks (up to 52), Y-axis = remaining pending count, actual line (historical), projected line (linear extrapolation from current velocity), confidence band (±1 stddev of weekly velocity). Show "estimated done" date in header. Toggle between linear and optimistic (p75 velocity) projections.

### Acceptance Criteria

- AC1: `/api/backlog-forecast` returns historical weekly completion series, rolling velocity, remaining count, estimated-done date
- AC2: `/backlog-forecast` renders burndown chart: solid actual line + dashed projected line + shaded confidence band
- AC3: Estimated done date shown in sticky header with velocity used
- AC4: Toggle linear vs optimistic (p75) projection
- AC5: Added to nav under Intelligence; "stalled" state when velocity is zero

---

## P235 — Inbound Message Heatmap (Operator Engagement by Hour & Day)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Operators have no view of when each project receives the most messages. A heatmap of inbound message volume by hour-of-day × day-of-week would reveal peak engagement windows, quiet periods, and whether certain projects are only active on weekdays or at specific hours. This helps tune scheduler timing and staffing.

### Proposed Solution

Parse JSONL transcripts for genuine user messages (role=user, content[0].type≠tool_result). Extract hour-of-day (0–23) and day-of-week (0=Mon…6=Sun) from each message timestamp. Add `/api/message-heatmap?slug=X&window=30` returning a 7×24 grid (day × hour → count) per project. Render `/message-heatmap` as a GitHub-contribution-style grid: rows=days-of-week, cols=hours, cell color intensity=message count. Project selector; fleet aggregate mode sums across all projects. Tooltip shows exact count and local time on hover.

### Acceptance Criteria

- AC1: `/api/message-heatmap` parses JSONL genuine user messages, returns 7×24 grid per slug + fleet aggregate
- AC2: `/message-heatmap` renders 7×24 heatmap grid (rows=Mon–Sun, cols=0–23h) with intensity = message count
- AC3: Project selector switches between per-slug and fleet-aggregate view
- AC4: Cell hover tooltip shows count + time label (e.g. "Wed 14:00–15:00: 12 messages")
- AC5: Added to nav under Observability; graceful empty state when no transcripts found

---

## P236 — Tool Error Rate Monitor (Per-Tool Failure Frequency)

**Status:** `[x] done`
**Created:** 2026-06-25
**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/235

### Problem

The JSONL transcript records `tool_result` blocks that include error content when a tool fails (content with `is_error: true` or error-type content). There is no view of which tools fail most often, whether error rates are improving, or which projects have the most tool failures. Operators debugging reliability issues have no signal-to-noise on tool stability.

### Proposed Solution

Parse JSONL `tool_result` blocks for each project: detect errors via `is_error: true` or content blocks with `type: "error"`. Compute per-tool stats: call count, error count, error rate (%), most recent error timestamp, most common error message prefix. Add `/api/tool-error-rate?slug=X&window=30`. Render `/tool-error-rate` as a table sorted by error rate desc: tool name, calls, errors, error%, trend sparkline (error/day last 14d), last error time, most common error snippet. Project selector; mcp__mcd__ suppressed by default.

### Acceptance Criteria

- AC1: `/api/tool-error-rate` parses JSONL tool_result for is_error/error-type blocks, returns per-tool stats
- AC2: `/tool-error-rate` renders sortable table: tool, calls, errors, rate%, sparkline, last error, common error
- AC3: Error rate cell color-coded: green(0%), amber(<10%), red(≥10%)
- AC4: Project selector; mcp__mcd__ hidden by default with toggle
- AC5: Added to nav under Observability; graceful empty state when no tool errors found

---

## P237 — Project State Transition Sankey (Activity Flow Visualization)

**Status:** `[x] done`
**Created:** 2026-06-25
**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/235

### Problem

Projects cycle through states (idle → active → stuck → circuit-open → reset) but there is no aggregate view of how often these transitions happen across the fleet, which states projects spend the most time in, or whether certain transitions (stuck → circuit-open) are becoming more frequent. A Sankey or flow chart would reveal the dominant paths through project lifecycle.

### Proposed Solution

Read `circuit-events.jsonl` (open/close events) and combine with fleet API state snapshots to reconstruct state transition sequences. Estimate idle↔active transitions from JSONL message timestamps (gap > 30min = idle). Build a transition matrix: from-state × to-state → count. Add `/api/state-transitions` returning the matrix + per-state time totals. Render `/state-transitions` as an SVG Sankey diagram: nodes=states (idle, active, stuck, circuit-open), edges=transitions, edge width=count. Color nodes by state severity. Tooltip on edge shows transition count and avg duration in source state.

### Acceptance Criteria

- AC1: `/api/state-transitions` builds transition matrix from circuit-events.jsonl + JSONL message gap analysis
- AC2: `/state-transitions` renders SVG Sankey: nodes=states, edges=transitions, width=count
- AC3: Tooltip on edge shows count and avg duration in source state
- AC4: Per-state total time shown as node label (e.g. "Active: 74% of time")
- AC5: Added to nav under Observability; graceful empty when no state data found

---

## P238 — Watchdog Kill Log (Stuck-Agent Kill History)

**Status:** `[x] done`
**Created:** 2026-06-25
**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/238

### Problem

The stuck-watchdog kills Claude processes that exceed `stuckThresholdMinutes` without progress. These kills are logged to stderr but not persisted anywhere queryable. Operators have no history of when kills happened, which projects are killed most often, or what the process was doing when killed (last tool call). Without this data, diagnosing recurring stuck issues requires reading tmux logs manually.

### Proposed Solution

Instrument `ClaudeProjectProcess` to append a line to `watchdog-kills.jsonl` (in the project dir) whenever the watchdog kills a process: `{ts, slug, runtimeMs, lastToolCall?, transcriptLines, reason}`. Add `/api/watchdog-kills` reading these files across all projects, returning events sorted by ts desc with pagination. Render `/watchdog-kills` as a table: timestamp, slug, runtime before kill, last tool called, reason. Summary header: total kills, kills/week, most-killed project. Added to nav under Observability.

### Acceptance Criteria

- AC1: `ClaudeProjectProcess` appends to `watchdog-kills.jsonl` on every watchdog-triggered kill with ts/slug/runtimeMs/lastToolCall/reason
- AC2: `/api/watchdog-kills` reads all project `watchdog-kills.jsonl` files, returns sorted events with pagination
- AC3: `/watchdog-kills` renders table: timestamp, slug, runtime, last tool, reason; summary header with total/week/worst project
- AC4: Slug filter; pagination; clicking slug links to `/circuit-timeline?slug=X`
- AC5: Added to nav under Observability; graceful empty state; bot restart not required (JSONL appended at runtime)

---

## P239 — Per-Project Token Usage Trend (Context Burn Rate Over Time)

**Status:** `[x] done`
**Created:** 2026-06-25
**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/240

### Problem

Operators cannot see how fast individual projects are consuming context window tokens over time. A project burning through context rapidly will hit limits before operators notice. There is no trend line, no per-project burn rate comparison, and no leading indicator of which channels are approaching their context ceiling.

### Proposed Solution

Parse JSONL `usage` fields per turn. Compute per-project: total tokens, burn rate (tokens/hour last 6h), context pressure % (cumulative session tokens / 200k limit). Add `/api/token-usage`. Render `/token-usage` as multi-line chart with sparklines, summary cards, context pressure color coding.

### Acceptance Criteria

- AC1: `/api/token-usage` parses JSONL `usage` blocks per turn, returns per-project series + burn rate
- AC2: `/token-usage` renders table: top-15 projects by burn rate, cumulative tokens, context%
- AC3: Color coding: green(<50%), amber(50-80%), red(≥80%)
- AC4: Summary cards: highest burn rate, avg tokens/turn, high-pressure count
- AC5: Project selector; added to nav under Observability; graceful empty state

---

## P240 — Scheduler Job History Log (Cron Execution Audit)

**Status:** `[x] done`
**Created:** 2026-06-25
**PR:** https://github.com/chan4lk/claude-multi-channel-discord/pull/242

### Problem

The scheduler fires daily HH:MM jobs but there is no record of when each job ran, whether the inject succeeded, or what the bot said in response. Operators debugging missed jobs or unexpected side-effects have no audit trail.

### Proposed Solution

Instrument `Scheduler.tick()` to append `{ts, scheduleId, slug, interval, message, injected, error}` to `scheduler-history.jsonl`. Add `/api/scheduler-history` and `/scheduler-history` page with event table + per-schedule accordion.

### Acceptance Criteria

- AC1: `Scheduler.tick()` appends to `scheduler-history.jsonl` on every fired job
- AC2: `/api/scheduler-history` reads file, returns events sorted ts desc with pagination + per-schedule stats
- AC3: `/scheduler-history` renders table: timestamp, schedule, slug, message snippet, status badge (ok/error)
- AC4: Per-schedule accordion showing fire count, last fired, error count, error message
- AC5: Added to nav under Operations; graceful empty state; no restart needed

---

## P241 — Cross-Project Goal Alignment Matrix

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Each project has a goal file, but there is no view showing how goals relate across the fleet. Operators cannot tell if two projects are working toward the same objective, if there are contradictory goals, or which projects have stale/missing goals.

### Proposed Solution

Read all project goal files. Use keyword overlap to compute similarity between every pair. Add `/api/goal-alignment` returning a similarity matrix. Render `/goal-alignment` as a heatmap grid with tooltip showing each project's goal. Outlier panel for projects with no goal or low similarity.

### Acceptance Criteria

- AC1: `/api/goal-alignment` reads all goal files, computes pairwise keyword overlap similarity (0-1), returns matrix + outliers
- AC2: `/goal-alignment` renders heatmap grid: slug labels on both axes, cell intensity = similarity
- AC3: Tooltip on cell shows first line of each project's goal
- AC4: Outlier panel: projects with no goal or similarity < 0.05 to all others
- AC5: Added to nav under Intelligence; graceful empty state; refreshes every 60s

---

## P242 — Context Pressure Alert Banner (Real-Time Threshold Warnings)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The Token Usage Trend page (P239) shows context pressure % per project, but operators must actively visit the page to see it. There is no proactive alert when a project's session approaches the context limit (e.g. ≥80%). Without a notification surface, a project can silently hit the 200k token wall, triggering a context-overflow distillation run, with no warning to the operator.

### Proposed Solution

Add `/api/context-alerts` that calls `/api/token-usage` internally, filters for projects with `contextPressurePct ≥ threshold` (default 80%), and returns alert objects `{slug, pressurePct, burnRatePerHour, eta}` where `eta = (remainingTokens / burnRatePerHour) * 3600` seconds. Render a `ContextAlertBanner` component (fixed bottom-right, z-50) that polls `/api/context-alerts` every 60s and displays a dismissible amber/red banner listing at-risk projects. Banner integrates into `ClientShell` so it appears on every page. Clicking a slug opens the Project Spotlight drawer.

### Acceptance Criteria

- AC1: `/api/context-alerts` returns projects with contextPressurePct ≥ configurable threshold (default 80%)
- AC2: Each alert includes: slug, pressurePct, burnRatePerHour, estimated seconds until limit (eta)
- AC3: `ContextAlertBanner` appears fixed bottom-right, polls every 60s, dismissible per-slug for 10 min
- AC4: Banner color: amber (80-90%), red (>90%); shows slug + pressure% + "~Xm until limit"
- AC5: Integrated into ClientShell so visible on all pages; no-op when no projects at risk

---

## P243 — Watchdog Kill → Circuit Trip Correlation

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The Watchdog Kill Log (P238) and Circuit Breaker Timeline (P227) are separate views. Operators cannot tell whether a watchdog kill was followed by a circuit-open event, or whether repeated watchdog kills are the root cause of circuit trips for a specific project. The causal chain (stuck → kill → circuit-open → cool-down → reset) is invisible across the two views.

### Proposed Solution

Add `/api/kill-circuit-correlation?slug=X` that reads both `watchdog-kills.jsonl` and `circuit-events.jsonl` for a project. For each watchdog kill, check if a circuit-open event occurred within 5 minutes after. Return a correlated timeline: `{killTs, slug, lastToolCall, circuitOpenTs?, circuitOpenMs?}`. Render `/kill-circuit-correlation` as a timeline view: each watchdog kill is a row, with a horizontal arrow showing whether a circuit-open followed (and how quickly). Summary: % of kills that triggered circuit trips, avg kill-to-trip latency. Project selector.

### Acceptance Criteria

- AC1: `/api/kill-circuit-correlation` reads watchdog-kills.jsonl + circuit-events.jsonl, correlates within 5min window
- AC2: Returns `{killTs, slug, lastToolCall, circuitOpenTs?, circuitOpenMs?}` per kill event
- AC3: `/kill-circuit-correlation` renders row-per-kill timeline with circuit-open arrow annotation
- AC4: Summary: total kills, kills-that-tripped (count + %), avg kill-to-trip latency
- AC5: Project selector; graceful empty state; added to nav under Observability

---

## P244 — Scheduled Job Definition Inspector (Active Schedules Dashboard)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The Scheduler History page (P240) shows *past* fires but not *current* schedule definitions. Operators cannot see at a glance: which schedules are active, what they will fire next, when they last ran, or whether they are paused. The `!project schedule list` master command shows this for one project at a time; there is no fleet-wide schedule inventory.

### Proposed Solution

Add `/api/schedules` that reads `schedules.json` from `MCD_CHANNELS_DIR`, joins with `channels.json` to resolve slugs, and returns all schedule entries enriched with: `{id, slug, chatId, enabled, interval, at, prompt(first 100 chars), lastRunAt, runCount, maxRuns, nextFireMs}`. Compute `nextFireMs` using the existing `nextFireMs()` helper. Render `/schedules` as a table: schedule id, project slug, interval/at, status badge (active/paused/exhausted), last run, next fire countdown, run count, message preview. Clicking a row navigates to Scheduler History filtered to that schedule.

### Acceptance Criteria

- AC1: `/api/schedules` reads schedules.json, joins slugs, computes nextFireMs for each entry
- AC2: `/schedules` renders table: id, slug, interval/at, status badge, last run, next fire, run count, message
- AC3: Status badge: active (green), paused (amber), exhausted (gray, maxRuns reached)
- AC4: Next fire shown as countdown (e.g. "in 23m") + absolute timestamp on hover
- AC5: Clicking row links to `/scheduler-history?schedule_id=X`; added to nav under Operations

---

## P245 — Live Agent Thought Stream (Real-Time Assistant Reasoning Viewer)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Operators can see tool calls and replies via the Tool Call Ticker and Project Feed, but cannot observe *what Claude is currently thinking* inside a turn. Long-running turns feel opaque — the operator has no leading indicator of whether the agent is making progress, stuck in a reasoning loop, or about to produce output. There is no way to distinguish "thinking deeply" from "stuck silently."

### Proposed Solution

Poll the active session `.jsonl` transcript every 2s for `thinking` content blocks (type `thinking`, field `thinking`). Add `/api/thought-stream?slug=X` that returns the most recent thinking block text and its timestamp. Render `/thought-stream` as a live feed: one card per active project, showing the latest thinking excerpt (truncated to 300 chars) with a shimmer animation while the turn is in flight. Clicking a card expands the full thought. Auto-clears when a turn ends (tool_result or assistant reply follows).

### Acceptance Criteria

- AC1: `/api/thought-stream` reads active session JSONL, extracts latest `thinking` block per project
- AC2: Returns `{slug, thinkingText, ts, inFlight: boolean}` — inFlight true if no assistant reply after the thinking block
- AC3: `/thought-stream` renders live cards per active project, shimmer animation while in-flight
- AC4: Cards auto-clear within 5s of turn completion; expandable full-text on click
- AC5: Added to nav under Observability; graceful empty state when no active turns

---

## P246 — Fleet 3D Force Graph (Three.js Project Constellation)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The existing Galaxy Map and Nexus Map use 2D SVG layouts. With 20+ projects the 2D plane becomes crowded and edges overlap. A 3D force-directed graph would reveal cluster structure (projects that share goals, tools, or memory entries) that is invisible in flat layouts, and would give the mission control dashboard a distinctive futuristic visual identity.

### Proposed Solution

Use `three-forcegraph` (Three.js-based 3D force graph) to render all projects as glowing nodes. Node size = turn count last 24h; node color = state (idle/active/stuck/circuit-open). Edges connect projects that share >2 memory keywords (keyword overlap from P241 goal-alignment logic). Camera auto-orbits at 0.1 deg/s; click a node opens the Project Spotlight drawer. Add `/3d-graph` route, no SSR, dynamic import. Link from Galaxy Map page header.

### Acceptance Criteria

- AC1: `/3d-graph` renders Three.js force graph; nodes = projects, edges = shared keyword pairs (>2 overlap)
- AC2: Node size proportional to turn count last 24h; node color = state palette (cyan/green/amber/red)
- AC3: Camera auto-orbits; user can drag to orbit, scroll to zoom, click node to open spotlight drawer
- AC4: Legend panel (bottom-left): color → state mapping, edge count, node count
- AC5: Added to nav under Observability; graceful empty (single node, no edges) state

---

## P247 — Project Health Score Card (Composite Wellness Index)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Operators must open multiple pages (Circuit Breaker MTTR, Token Usage Trend, Watchdog Kill Log, Goal Alignment) to assess whether a project is healthy. There is no single composite score that answers "is this project running well?" A composite health index would let operators triage at a glance and catch degrading projects before they hit a hard limit.

### Proposed Solution

Add `/api/health-score` that computes per-project: circuit-trip rate (last 7d), watchdog kill rate (last 7d), context pressure pct, turn error rate (tool_result is_error ratio), goal alignment score (from P241). Normalize each dimension to 0-100; weight-average into a single `healthScore`. Render `/health-score` as a sortable table with a color-coded score column (green 80+, amber 50-79, red <50), per-dimension sparklines, and drill-down links. Export as JSON for external monitoring.

### Acceptance Criteria

- AC1: `/api/health-score` computes 5 dimensions per project; returns `{slug, healthScore, dims: {circuitTripRate, watchdogKillRate, contextPressure, toolErrorRate, goalAlignment}}`
- AC2: `/health-score` renders sortable table: score badge, 5 dimension cols, project slug link
- AC3: Score badge: green (80+), amber (50-79), red (<50); row highlight for red projects
- AC4: Per-dimension sparkline (7-day trend) in each cell
- AC5: Added to nav under Intelligence; auto-refresh every 60s; export-as-JSON button

---

## P248 — Operator Inbox (Actionable Alerts Triage Center)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Alerts surface via the Context Alert Banner (P242), the Circuit Breaker Timeline, and the Watchdog Kill Log — but each is a separate page. When multiple projects are in distress simultaneously, the operator must visit several pages to understand the full situation. There is no unified triage inbox that aggregates all actionable alerts with one-click remediation.

### Proposed Solution

Add `/api/inbox` that aggregates: context alerts (P242, pct>=80%), open circuit breakers, watchdog kills in last 30min, projects with healthScore<50 (P247). Deduplicate by slug+type; sort by severity then recency. Render `/inbox` as a card list: severity badge, project slug, alert type, description, and action buttons (Restart, Dismiss 10m, Spotlight). Dismissed alerts are stored in localStorage with TTL. Badge count in nav when inbox is non-empty.

### Acceptance Criteria

- AC1: `/api/inbox` aggregates alerts from context-alerts, circuit-events, watchdog-kills (30min window), health-score
- AC2: Returns `{id, slug, type, severity: 'critical'|'warning', message, ts}` array sorted by severity then ts
- AC3: `/inbox` renders card list with severity badge, action buttons (Restart=send !project stop+start, Dismiss, Spotlight)
- AC4: Dismissed alerts suppressed for 10min via localStorage; badge count shown in nav item
- AC5: Added to nav under Operations as "Inbox"; auto-refresh 30s; empty state "All clear"

---

## P249 — Session Memory Timeline (Per-Project Memory Write History)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The Memory Staleness Radar (P230) and Memory Health (P232) pages show the current state of memory files, but not *when* they were written or how memory evolves over a project's lifetime. Operators cannot tell if a project's memory is actively being updated, drifting stale, or was written in a burst and never touched again. A longitudinal timeline would reveal memory write cadence and flag projects with frozen memory.

### Proposed Solution

Add `/api/memory-timeline?slug=X` that reads all `memory/*.md` files in the project's working directory and collects `git log --follow --format="%H %aI" -- <file>` commit timestamps for each. Returns a per-file series `{file, commits: [{sha, ts}]}` sorted by most recent. Render `/memory-timeline` as a swimlane chart: one row per memory file, dots at each commit timestamp on a horizontal time axis (last 30 days). Hover shows commit SHA + message prefix. Project selector; filter by memory type (user/feedback/project/reference).

### Acceptance Criteria

- AC1: `/api/memory-timeline` runs git log per memory file, returns commit series per file
- AC2: Handles projects with no memory dir or no git history gracefully (empty series)
- AC3: `/memory-timeline` renders swimlane chart: file rows × time axis, dot per commit
- AC4: Hover tooltip: file name, commit ts, commit SHA (6 chars), message prefix (40 chars)
- AC5: Project selector; memory type filter; added to nav under Intelligence; graceful empty state

---

## P250 — Operator Command History Dashboard

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Operators have no visibility into the history of `!project` commands they've issued — which projects were started, stopped, cloned, or reconfigured, and when. After incidents or debugging sessions it's hard to reconstruct "what did I do and in what order?" A unified command audit log with filtering and timeline would dramatically improve operational clarity.

### Proposed Solution

Add `/api/command-history` that reads the master project's JSONL transcript and extracts all genuine user messages that start with `!project`. Returns `{ts, command, verb, slug?, args}[]` sorted by ts desc. Page `/command-history` renders a searchable table: timestamp, verb badge (colored by type: create/clone/stop/rm/set), slug, full command text. Filter by verb, slug, and date range. Clicking a row shows full command + response excerpt in an expandable panel.

### Acceptance Criteria

- AC1: `/api/command-history` parses master JSONL for `!project` user messages, returns structured entries
- AC2: Extracts verb (first token after `!project`) and optional slug (second token if not a flag)
- AC3: `/command-history` renders searchable/filterable table: ts, verb badge, slug, command
- AC4: Filter by verb (multi-select dropdown), slug (text), date range (last 7/30/90d picker)
- AC5: Row expand shows full command + first 200 chars of subsequent assistant response
- AC6: Added to nav under Operations; auto-refresh 60s; empty state handled

---

## P251 — Session Gap Analysis (Idle Period Detector)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Projects go silent for days or weeks — no messages, no tool calls — without the operator noticing. Some silence is expected (weekend, sprint end); other gaps signal orphaned sessions, evicted processes that failed to re-spawn, or users who abandoned a workflow. Visualizing idle periods across all projects lets operators spot drifting channels before they become stale.

### Proposed Solution

Add `/api/session-gaps?days=30` that scans each project's JSONL transcript for genuine user messages, computes inter-message intervals, and returns `{slug, gaps: [{start, end, durationHours}], longestGapHours, lastMessageTs}[]`. Page `/session-gaps` renders a stacked swimlane chart: one row per project, colored segments for active vs idle (gap > 24h = yellow, > 72h = red). Sort by longest current gap descending so orphaned projects bubble up. Tooltip shows gap duration + neighbor message previews.

### Acceptance Criteria

- AC1: `/api/session-gaps` computes inter-message gaps per project from JSONL, returns gap series
- AC2: Gaps ≥ 24h classified yellow, ≥ 72h classified red; active segments green
- AC3: `/session-gaps` swimlane: one row per project, segments colored by gap severity, time axis last 30d
- AC4: Sort by longest current idle gap desc; project rows link to `/projects/<slug>`
- AC5: Hover tooltip: gap duration, last message preview, next message preview
- AC6: Added to nav under Intelligence; auto-refresh 5min; graceful empty state

---

## P252 — Cross-Project Memory Knowledge Graph

**Status:** `[x] done` — PR #251, merged 2026-06-25
**Created:** 2026-06-25

### Problem

Each project maintains its own isolated memory, but multiple projects often share domain knowledge — the same API endpoint, the same user preference, the same architectural decision. This duplication is invisible: if one project learns something important, other projects that need the same knowledge must re-discover it independently. A cross-project memory graph would surface shared entities and highlight knowledge silos.

### Proposed Solution

Add `/api/memory-knowledge-graph` that reads `memory/*.md` for all projects, extracts keywords (lowercased, stop-word filtered, min 4 chars), and computes cross-project overlap: nodes are projects + keywords, edges connect projects to keywords they mention (weight = mention count). Returns `{nodes: [{id, type: 'project'|'keyword', label, projectCount?}], edges: [{source, target, weight}]}`. Page `/memory-knowledge-graph` renders a 2D force graph (react-force-graph-2d): project nodes large (blue), keyword nodes small (orange, sized by cross-project count), edges thin gray. Clicking a keyword node highlights all projects that mention it.

### Acceptance Criteria

- AC1: `/api/memory-knowledge-graph` reads all project memories, extracts top-50 keywords per project (TF weighting), returns graph nodes+edges
- AC2: Keyword nodes with `projectCount ≥ 2` flagged as "shared" (orange, enlarged)
- AC3: `/memory-knowledge-graph` renders force graph; project nodes colored by state (running/idle/stopped)
- AC4: Click keyword node → highlight connected project nodes, show keyword in tooltip with project list
- AC5: Slider to filter minimum edge weight (keyword frequency); legend for node types
- AC6: Added to nav under Intelligence; uses `react-force-graph-2d` (already in deps as 3d-graph uses `react-force-graph-3d`)

---

## P253 — Budget Burn Calendar (Daily Token Spend Heatmap)

**Status:** `[x] done` — PR #251, merged 2026-06-25
**Created:** 2026-06-25

### Problem

The Budget Pressure page (P162) shows current month burn vs limit, but has no historical view of *when* tokens are consumed. Heavy spend days often cluster around specific events (big refactors, debugging sessions, scheduled batch jobs). A calendar heatmap of daily token spend — like a GitHub contribution graph — lets operators identify spend patterns, predict budget exhaustion timing, and attribute expensive days to specific projects.

### Proposed Solution

Add `/api/budget-calendar?months=3` that aggregates token usage from all project JSONL transcripts grouped by calendar day. Returns `{days: [{date: 'YYYY-MM-DD', totalTokens, byProject: {slug: tokens}[]}]}`. Page `/budget-calendar` renders a GitHub-style contribution calendar: weeks as columns, days as rows, cells colored by spend intensity (0 = white, max = deep blue). Hovering a cell shows top-3 projects by spend that day + total. Below the calendar, a stacked bar chart shows the same data in bar form with project breakdown. Month selector (last 1/3/6 months).

### Acceptance Criteria

- AC1: `/api/budget-calendar` aggregates per-day token counts from all project JSONLs
- AC2: Returns date-keyed entries with total + per-project breakdown, last 90 days by default
- AC3: `/budget-calendar` renders GitHub-style heatmap calendar; intensity = total tokens that day
- AC4: Hover tooltip: date, total tokens, top-3 projects by spend
- AC5: Stacked bar chart below calendar with project color legend
- AC6: Month range selector (1/3/6 months); added to nav under Operations

---

## P254 — Project Lifecycle Funnel (Spawn → Active → Eviction Flow)

**Status:** `[x] done` — PR #253, merged 2026-06-25
**Created:** 2026-06-25

### Problem

The operator knows how many projects exist but not how they flow through their lifecycle states. Questions like "how many projects get spawned but never actually used?", "what's the typical time from first message to first tool call?", "how often do projects get evicted before completing their task?" have no answer today. A lifecycle funnel gives visibility into the health of the project creation → active use → retirement pipeline.

### Proposed Solution

Add `/api/lifecycle-funnel` that reads all project directories, classifies each project into lifecycle stages by examining: JSONL presence (spawned), first user message (contacted), first tool call (active), current state (running/idle/stopped), last message age > 7d (drifting), archived (retired). Returns `{stages: [{name, count, projects: slug[]}], medianActivationMinutes, medianFirstToolCallMinutes}`. Page `/lifecycle-funnel` renders a horizontal funnel SVG: wide bar for Spawned → narrower for Contacted → Active → Drifting → Retired. Each segment clickable to show project list. Sankey-style flow between stages.

### Acceptance Criteria

- AC1: `/api/lifecycle-funnel` classifies all projects into 5 lifecycle stages, returns counts + slug lists
- AC2: Computes median time from project creation to first user message, and from first message to first tool call
- AC3: `/lifecycle-funnel` renders horizontal funnel SVG with proportional bar widths per stage
- AC4: Click stage bar → side panel lists slugs in that stage with last-activity timestamp
- AC5: Sankey flow arrows between stages (project count × arrow thickness)
- AC6: Added to nav under Intelligence; graceful handling of projects with no JSONL (Spawned stage)

---

## P255 — Fleet Full-Text Search (Cross-Project Message & Memory Search)

**Status:** `[x] done` — PR #253, merged 2026-06-25
**Created:** 2026-06-25

### Problem

With dozens of project channels, finding where something was discussed or decided requires checking each project individually. If the operator wants to know "which projects have talked about authentication?" or "find the turn where we decided to use SQLite", there is no cross-fleet search. The operator must rely on memory of which project handled what, making the fleet harder to manage as it grows.

### Proposed Solution

Add `/api/search?q=<query>&scope=messages|memory|all&limit=50` that scans all project JSONL transcripts and memory files for the query string (case-insensitive substring match). Returns `{results: [{type: 'message'|'memory', slug, file, ts?, snippet: string, matchOffset: number}], totalHits, truncated}`. Page `/search` is an always-visible search bar + results list: each hit shows slug badge, type tag, timestamp, and a 200-char context window with the match highlighted. Click any result jumps to the project entry in Project Feed. Filter chips for scope (messages/memory/both) and date range.

### Acceptance Criteria

- AC1: `/api/search` scans all JSONL and memory files, returns ranked hits (exact match > prefix > contains)
- AC2: Results include slug, type, timestamp, and 200-char context snippet with match position
- AC3: `/search` renders typeahead-style input (debounced 300ms) + result list with scope filter
- AC4: Match term highlighted in snippet; slug badge colored by project state
- AC5: Handles empty query (show recent turns summary), >50 hits (show truncated + count), no results (empty state)
- AC6: Added to nav under Admin; works with 0 projects (graceful empty state)

---

## P256 — Command Response Latency Distribution

**Status:** `[x] done` — PR #255, merged 2026-06-25
**Created:** 2026-06-25

### Problem

The Command History page (P250) shows what commands were sent but not how long projects took to respond. Some projects reply in seconds; others take minutes. Operators don't know which projects are "slow" (due to context pressure, long tool chains, or being stuck), making it hard to set expectations or identify degraded sessions before they time out.

### Proposed Solution

Add `/api/response-latency` that pairs each genuine user message with the first subsequent assistant reply in the JSONL, computes the delta in seconds, and returns per-project percentile stats: `{projects: [{slug, p50, p90, p99, samples, trend: 'improving'|'stable'|'degrading'}]}`. Trend computes last-7d p90 vs prior-7d p90. Page `/response-latency` renders a horizontal box-and-whisker chart: one row per project, box = p25–p75, whiskers = p10–p90, dot = p50. Color: green (<30s), amber (30–120s), red (>120s). Sort by p90 descending so slow projects rise to top.

### Acceptance Criteria

- AC1: `/api/response-latency` pairs user→assistant turns in JSONL, computes per-project p50/p90/p99 in seconds
- AC2: Trend computed from last-7d vs prior-7d p90; labeled improving/stable/degrading
- AC3: `/response-latency` renders box-and-whisker chart (one row per project) with p50 marker
- AC4: Colors: green p50<30s, amber 30–120s, red >120s; sort by p90 desc
- AC5: Hover tooltip: full percentile breakdown + sample count + trend arrow
- AC6: Added to nav under Intelligence; minimum 3 samples per project to show row

---

## P257 — Token Budget Exhaustion Forecast

**Status:** `[x] done` — PR #255, merged 2026-06-25
**Created:** 2026-06-25

### Problem

The Budget Calendar (P253) shows historical spend but not when a project will exhaust its monthly token budget. Operators discover budget exhaustion only after it happens — when Claude stops responding — rather than proactively. A forward-looking forecast with days-to-exhaustion per project lets operators adjust limits or pause non-critical work before hitting the wall.

### Proposed Solution

Add `/api/budget-forecast` that reads per-project token usage from the last 14 days, fits a linear regression over daily spend, and extrapolates to the monthly budget limit. Returns `{projects: [{slug, monthlyBudget, monthlyUsed, projectedMonthlyTotal, daysToExhaustion: number|null, burnRatePerDay, regressionR2}]}`. `daysToExhaustion` is null when budget is unlimited or the trend is declining. Page `/budget-forecast` renders a table sorted by days-to-exhaustion ascending: project slug, current used%, projected total%, days remaining (red if <7d, amber 7–14d, green 14+d). Sparkline of 14d daily spend trend per row.

### Acceptance Criteria

- AC1: `/api/budget-forecast` fits daily linear regression over last 14 days per project
- AC2: Projects with no budget limit return `daysToExhaustion: null`; declining trend returns `null`
- AC3: `/budget-forecast` table sorted by days-to-exhaustion asc (nulls last)
- AC4: Color coding: red (<7d), amber (7–14d), green (>14d); includes regression R² as confidence indicator
- AC5: 14-day sparkline per row showing burn trend
- AC6: Added to nav under Intelligence; filters to projects with monthlyTokenBudget set

---

## P258 — Project Twin Analysis (Behavioral Similarity Clustering)

**Status:** `[x] done` — PR #258
**Created:** 2026-06-25

### Problem

Multiple projects often have similar behavioral profiles — same turn frequency, same tool mix, same memory size — but this similarity is invisible. Identifying "twins" helps operators consolidate redundant work, detect when a new project is duplicating an existing one, or learn from high-performing projects by comparing with similar but slower ones.

### Proposed Solution

Add `/api/project-twins` that computes a feature vector per project: [turns_per_day, tool_call_rate, memory_file_count, context_pressure_pct, avg_tokens_per_turn]. Normalises each feature 0–1, then computes pairwise cosine similarity. Returns `{pairs: [{slug_a, slug_b, similarity, sharedFeatures: string[]}]}` for pairs with similarity > 0.8. Page `/project-twins` renders a similarity matrix grid: projects on both axes, cells colored by similarity (0=white, 1=deep purple). Hover shows shared feature profile. Click a cell to open a split compare panel.

### Acceptance Criteria

- AC1: `/api/project-twins` computes 5-feature vectors, normalises, returns cosine similarity for pairs > 0.8
- AC2: Returns `sharedFeatures` list identifying which dimensions are close (within 20% of each other)
- AC3: `/project-twins` renders square similarity matrix; cells color-coded 0→white, 1→deep purple
- AC4: Hover tooltip: both slugs, similarity score, shared feature list
- AC5: Click cell → split-screen compare panel showing both projects' sparklines side-by-side
- AC6: Added to nav under Intelligence; minimum 2 projects to render; handles missing JSONL gracefully

---

## P259 — Activity Digest on Demand (What Happened While Away)

**Status:** `[x] done` — PR #258
**Created:** 2026-06-25

### Problem

When the operator returns after hours or days away from the dashboard, there is no quick summary of what happened across the fleet. They must manually check each project's feed, inbox, session gaps, and circuit breaker pages to reconstruct recent activity. A single "what happened in the last N hours" digest page — auto-generated from existing data — would let operators get up to speed in under a minute.

### Proposed Solution

Add `/api/activity-digest?hours=8` that aggregates from the last N hours: new messages sent (by project), tool calls fired (top tools by project), watchdog kills, circuit trips, memory writes, and health score changes. Returns a structured summary with per-project activity counts. Page `/activity-digest` renders a timeline-style page: a "Last N hours summary" banner with total turn count, active projects, and top events. Below, one card per active project showing their mini-timeline (message count, tool count, any alerts). An "hour range" selector: 2/8/24/72h.

### Acceptance Criteria

- AC1: `/api/activity-digest?hours=N` aggregates JSONL events, memory git log, and circuit-events.jsonl for the window
- AC2: Returns per-project: messageCount, toolCallCount, memoryWrites, hadWatchdogKill, hadCircuitTrip, healthDelta
- AC3: `/activity-digest` renders summary banner (total turns, unique active projects, top-3 busiest)
- AC4: Per-project cards sorted by messageCount desc; cards show mini-bar charts for turns + tool calls
- AC5: Alert badges on cards for watchdog kills, circuit trips, or health score drop >20
- AC6: Hour range selector: 2/8/24/72h; added to nav under Operations; handles no-activity window gracefully

---

## P260 — Fleet Mosaic (Project State × Context × Memory Treemap)

**Status:** `[x] done` — PR #260
**Created:** 2026-06-25

### Problem

The dashboard fleet grid shows each project as an equal-sized card, hiding the relative scale of projects in terms of context consumption, memory footprint, and convergence. Operators cannot immediately see which projects are "big" versus "light" consumers of resources — all cards look the same.

### Proposed Solution

Add a `/fleet-mosaic` page rendering a squarified treemap of all active projects. Each tile's area is proportional to `contextUsagePct` (or a minimum tile size for idle projects). Tile color encodes project state (active=green, idle=cyan, stalled=red, autonomous=purple). Each tile shows slug, convergence score, context %, and a memory indicator dot (filled = has memory). Tiles are interactive: hovering reveals a tooltip with full project details; clicking navigates to that project's feed. No new API needed — uses `/api/fleet` data directly.

### Acceptance Criteria

- AC1: `/fleet-mosaic` renders squarified treemap with tile area ∝ `contextUsagePct || 5` (min tile for zero-context projects)
- AC2: Tile color encodes state; legend shows state→color mapping
- AC3: Each tile shows slug (truncated), context %, convergence score if present, and memory dot if `memoryStatus.sizeBytes > 0`
- AC4: Hover tooltip shows full project details (state, ageMins, stuckThresholdMinutes, budgetStatus, circuitOpen)
- AC5: Clicking a tile navigates to `/feed?slug=<slug>`
- AC6: Added to nav under Intelligence; handles 0-project fleet (empty state message)

---

## P261 — Project Lifecycle Clock (Radial Age Visualization)

**Status:** `[x] done` — PR #260
**Created:** 2026-06-25

### Problem

Project age is shown in the fleet grid as a text number. There is no visual sense of how projects are distributed across their lifecycle — whether the fleet is young (recently spawned), mature, or mixed. A radial clock metaphor would make fleet age distribution immediately legible.

### Proposed Solution

Add a `/lifecycle-clock` page rendering an SVG clock face (circle). Each project is plotted as a "hand" emanating from the center: angular position = age modulo 90 days mapped to 0–360° (so 0 days = 12 o'clock, 45 days = 6 o'clock, 90 days wraps back). Hand length = `contextUsagePct / 100 * R` (so high-context projects reach further from center). Hand color = state. Concentric rings at 30/60/90 days guide the eye. Hovering a hand shows a tooltip (slug, age, state, context %). Uses `/api/fleet`.

### Acceptance Criteria

- AC1: SVG clock face, concentric guide rings at 30/60/90-day marks labeled
- AC2: Each project rendered as a hand: angle = age mod 90d mapped to 360°, length = contextUsagePct (min 10% of R for visibility)
- AC3: Hand color = state (same palette as pulse page); hand tip = filled circle
- AC4: Hover tooltip: slug, ageMins formatted as days/hours, state, context %, convergence if available
- AC5: Fleet summary row below clock: total projects, mean age, age range (youngest–oldest)
- AC6: Added to nav under Intelligence; graceful empty state; no external dependency beyond `/api/fleet`

---

## P262 — Holographic Overview (Force Graph + Fleet Narrative + Proposal Pipeline)

**Status:** `[x] done` — PR #262
**Created:** 2026-06-25

### Problem

Holistic fleet state requires visiting multiple pages: the main grid for project states, `/knowledge` for memory links, `/backlog` for proposals. No single view fuses all three signals — project relationships, fleet narrative, and proposal pipeline — into an at-a-glance command-room display.

### Proposed Solution

Add a `/holographic` page with a three-panel layout toggled by pressing `H` or a header button. Left panel: a D3-style force-directed graph of all projects (nodes colored by state, sized by convergenceScore, edges = shared memory keywords). Right panel: scrollable fleet narrative — one line per project auto-generated from goalText, state, ageMins, and convergenceScore. Bottom bar: horizontal scroll of per-project mini-kanban chips showing pending/done proposal counts (parsed from `/api/backlog`). Pressing `H` again returns to a clean summary card. Normal (non-H) mode shows a compact 3-metric summary bar (total projects, active turns, pending proposals) with a "Go Holographic" button.

### Acceptance Criteria

- AC1: Default mode: compact summary bar (project count, active count, pending proposal count) + "Go Holographic" button
- AC2: Holographic mode triggered by button or `H` key; full-viewport split (left 50% graph, right 50% narrative, bottom bar)
- AC3: Force graph: project nodes, colored by state, sized by convergenceScore (min size 8px), edges = shared memory keywords (from `/api/memory-knowledge-graph`), repulsion-only simulation (no d3-force — pure spring math in RAF loop)
- AC4: Fleet narrative: one `<p>` per project, text = "slug [state] • goal: goalText | age Xh | conv Y%" or best-available fields
- AC5: Bottom bar: per-project chips showing pending/done counts from `/api/backlog`; horizontal scroll; clicking chip deep-links to `/backlog?project=slug`
- AC6: Added to nav under Intelligence; `H` key listener cleaned up on unmount

---

## P263 — Fleet Star Map (2D Metric Space Scatter Plot)

**Status:** `[x] done` — PR #262
**Created:** 2026-06-25

### Problem

Convergence score and context fill % are two key health dimensions but are never shown together. Plotting projects on a 2D metric space (X = convergence, Y = context fill %) immediately reveals clusters: high-convergence/low-context projects are healthy; low-convergence/high-context ones need attention.

### Proposed Solution

Add a `/star-map` page rendering an SVG scatter plot with X-axis = convergenceScore (0–1), Y-axis = contextUsagePct (0–100). Each project is a star SVG glyph (5-pointed), sized by `ageMins` (older = slightly larger), colored by state. A CSS `@keyframes` pulse animation marks active-state projects. Quadrant lines divide the plot into "healthy" (high convergence, low context) vs "at-risk" (low convergence, high context) zones, labeled in the corners. Hovering a star shows a tooltip. A color-legend row sits below the chart.

### Acceptance Criteria

- AC1: SVG scatter plot, X = convergenceScore (0–1), Y = contextUsagePct (0–100), both axes labeled with ticks
- AC2: Projects rendered as 5-pointed SVG stars; star size = `8 + ageMins/2880 * 8` (8–16px range, capped at 90 days)
- AC3: Star color = state palette; active-state stars pulse via CSS animation
- AC4: Quadrant dividers at x=0.5, y=50 with corner labels: "Optimal" (high conv, low ctx), "Diverging" (low conv, high ctx), "Maturing" (high conv, high ctx), "Starting" (low conv, low ctx)
- AC5: Hover tooltip: slug, convergenceScore, contextUsagePct, state, ageMins formatted
- AC6: Added to nav under Intelligence; projects missing convergence/context plotted at axes origin with 50% opacity; no-project empty state

---

## P264 — Memory Density Heatmap (Project × Hour-of-Day Write Frequency)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Memory writes happen throughout the day but the timing is invisible. Knowing which hours each project is most active (generates memory) helps operators schedule maintenance windows and understand project rhythm. No current view shows memory write frequency by hour.

### Proposed Solution

Add a `/memory-density` page with a grid heatmap: rows = projects, columns = hours of day (0–23). Cell color intensity = number of memory write events in that hour (from the last 7 days), pulled from memory git log timestamps. A new `/api/memory-density` endpoint reads the memory DB git log (`git log --format=%ai -- memory.db`) for each project slug, extracts hour-of-day, and returns `{ slug, hourCounts: number[24] }[]`. Max cell = darkest color in a cyan→dark-cyan gradient. Row total and column total shown as margin bars. Hovering a cell shows exact count + project/hour labels.

### Acceptance Criteria

- AC1: `/api/memory-density` reads git log of memory.db per project slug, returns `{ slug, hourCounts: number[24] }[]` for last 7 days
- AC2: Page renders rows × columns grid (projects × hours), cell color = heatmap intensity (0 = transparent, max = deep cyan)
- AC3: Row total bar (right margin): sum of writes across all hours per project; column total bar (bottom): sum across all projects per hour
- AC4: Hover: tooltip showing project slug, hour label (e.g. "14:00–15:00"), write count
- AC5: Color scale legend (0 → max) shown below grid; "Last 7 days" label in header
- AC6: Added to nav under Intelligence; handles projects with no memory git history (row shown grayed); max 30 projects displayed (sort by total desc)

---

## P265 — Memory Write Velocity Sparklines

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

The Memory Density Heatmap (P264) shows hour-of-day write patterns but not trend over time. Operators cannot see if a project's memory activity is accelerating, plateauing, or declining across days.

### Proposed Solution

Add a `/memory-velocity` page with one sparkline per project (pure SVG). X-axis = last 14 days (one point per day), Y-axis = memory commit count for that day. Lines colored by trend direction (green = increasing last 3d, red = decreasing, cyan = stable). A `/api/memory-velocity` endpoint reads `git log --format=%aI -- memory/` per project, buckets by calendar day, returns `{ slug, dailyCounts: { date: string; count: number }[] }[]`. Fleet aggregate line overlaid. Header shows the project with highest recent velocity.

### Acceptance Criteria

- AC1: `/api/memory-velocity` returns `{ slug, dailyCounts: { date; count }[] }[]` for last 14 days
- AC2: One SVG sparkline per project, sorted by total desc; max 20 shown
- AC3: Line color encodes trend (green/red/cyan) based on last 3 days vs prior 3 days
- AC4: Fleet aggregate sparkline shown at top in white
- AC5: Header shows project with highest 3-day velocity
- AC6: Added to nav under Intelligence; handles zero-history projects (flat line shown grayed)

---

## P266 — Per-Project Memory File Age Strip

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Memory files accumulate but their age is invisible. An operator cannot quickly see which projects have stale memory files that haven't been updated in weeks vs recently refreshed ones.

### Proposed Solution

Add a `/memory-age-strip` page. For each project, display a horizontal strip of colored dots — one dot per memory `.md` file. Dot color encodes file age (green < 7d, amber 7-30d, red > 30d). Dot size encodes word count. Strips stacked vertically, sorted by stale-file count desc. A `/api/memory-age` endpoint reads `fs.statSync` mtime for each memory file per project and returns `{ slug, files: { name, ageDays, wordCount }[] }[]`. Hovering a dot shows file name, age, word count.

### Acceptance Criteria

- AC1: `/api/memory-age` returns `{ slug, files: { name, ageDays, wordCount }[] }[]`
- AC2: One horizontal dot strip per project; dot color = age band (green/amber/red)
- AC3: Dot radius proportional to word count (min 4px, max 12px)
- AC4: Strips sorted by stale (>30d) file count desc
- AC5: Hover tooltip: file name, age in days, word count
- AC6: Added to nav under Intelligence; legend shows age bands

---

## P267 — Session Turn Heatmap (Project × Day-of-Week)

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Message Heatmap (P84) shows operator messages by day×hour. But there is no equivalent view of Claude turn activity (assistant responses) by project and day-of-week, which would reveal each project's natural work rhythm.

### Proposed Solution

Add a `/turn-heatmap` page mirroring the message-heatmap pattern but sourced from JSONL transcripts. A `/api/turn-heatmap` endpoint scans each project's transcript `.jsonl` files, counts lines where `message.role === 'assistant'` grouped by day-of-week × hour-of-day, and returns `{ slug, grid: number[7][24] }[]` (7 days × 24 hours). Page renders one heatmap per project with a project selector dropdown; fleet aggregate shown by default.

### Acceptance Criteria

- AC1: `/api/turn-heatmap` returns `{ slug, grid: number[7][24], total }[]` for last 30 days
- AC2: Page matches message-heatmap UX: day×hour grid, cyan gradient, peak highlight, color scale
- AC3: Project selector dropdown switches between fleet aggregate and per-project view
- AC4: Fleet aggregate computed by summing all project grids
- AC5: Per-project stats shown: total turns, peak day+hour
- AC6: Added to nav under Intelligence

---

## P268 — Memory Coverage Gap Detector

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Some projects are active (many turns, commits) but have no memory files. Others have memory files but none of the four canonical types (user, feedback, project, reference). These coverage gaps indicate incomplete agent setup but are invisible in current views.

### Proposed Solution

Add a `/memory-gaps` page listing projects with memory coverage gaps. A `/api/memory-gaps` endpoint scans each project directory: checks for `memory/` dir existence, counts files by type prefix (user_*, feedback_*, project_*, reference_*), and cross-references with transcript recency (active = transcript modified < 7d). Returns `{ slug, hasMemoryDir, typeCounts: Record<string, number>, isActive, missingTypes: string[] }[]`. Page renders a sortable table with gap badges (missing-dir / missing-type indicators) and a filter for active-only projects.

### Acceptance Criteria

- AC1: `/api/memory-gaps` returns coverage data per project including `missingTypes[]`
- AC2: Table shows slug, active status, has-memory-dir, type coverage (user/feedback/project/reference checkmarks)
- AC3: Missing-type cells show red ✗; present types show green ✓
- AC4: Filter toggle: "Active projects only" (transcript < 7d old)
- AC5: Sort by gap count desc by default; click column header to resort
- AC6: Added to nav under Intelligence; empty state when all projects fully covered

---

## P269 — Fleet Memory Growth Timeline

**Status:** `[x] done`
**Created:** 2026-06-25

### Problem

Memory accumulates over time but there is no view of fleet-level memory growth history. Operators cannot see when major memory expansion events happened (e.g. bulk new projects onboarded, memory migration runs) or how total memory file count trends.

### Proposed Solution

Add a `/memory-growth` page with a stacked area chart (pure SVG). X-axis = last 30 days (daily buckets), Y-axis = cumulative memory file count across all projects. Each project is a stacked area band, colored by a fixed project palette. A `/api/memory-growth` endpoint reads git log per project memory dir, buckets new file creations by day (files that appear in git for the first time on that day), and returns `{ dates: string[], series: { slug, dailyNew: number[] }[] }`. Hovering the chart shows a vertical crosshair and per-project tooltip.

### Acceptance Criteria

- AC1: `/api/memory-growth` returns `{ dates, series: { slug, dailyNew }[] }` for last 30 days
- AC2: SVG stacked area chart, one band per project, X = days, Y = cumulative total
- AC3: Hover crosshair: shows date, per-project file count, fleet total
- AC4: Legend below chart lists project slugs with color swatches
- AC5: Fleet total line overlaid in white above stacked areas
- AC6: Added to nav under Intelligence; handles zero-growth periods (flat line)

---

## P270 — Cross-Project Tool Usage Heatmap

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators cannot see which tools each project uses most, or how tool usage patterns differ across the fleet. High tool-call rates for expensive tools (Agent, Workflow) are invisible until they show up in cost.

### Proposed Solution

Add a `/tool-heatmap` page. A `/api/tool-heatmap` endpoint scans JSONL transcripts for `tool_use` blocks, aggregates call counts by project × tool name, and returns `{ projects: string[], tools: string[], matrix: number[][] }` (rows = projects, cols = tools, sorted by total desc). Page renders an SVG heatmap with project rows and tool columns, cell color = call count intensity, hover tooltip, row/column total bars.

### Acceptance Criteria

- AC1: `/api/tool-heatmap` returns `{ projects, tools, matrix, generatedAt }` for last 30 days
- AC2: SVG heatmap: rows = projects, cols = tools sorted by fleet total; max 20 projects, max 30 tools
- AC3: Cell color encodes call count (cyan gradient); zero cells are near-black
- AC4: Row totals (right bar), column totals (bottom bar)
- AC5: Hover tooltip: project, tool, count
- AC6: Added to Observability nav

---

## P271 — Session Length Distribution

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

There is no view of how long individual Claude sessions run (measured in turns or wall-clock time). Long sessions may indicate stuck agents or complex tasks; very short sessions may indicate repeated spawning due to restarts.

### Proposed Solution

Add a `/session-length` page. A `/api/session-length` endpoint reads JSONL files per project, groups lines by session (uuid from filename), computes turn count and wall-clock duration (last timestamp − first timestamp), and returns `{ sessions: { slug, sessionId, turns, durationMinutes, date }[] }`. Page shows a scatter plot (SVG, x = turns, y = duration) colored by project, plus a histogram of turn counts.

### Acceptance Criteria

- AC1: `/api/session-length` returns session records with slug, turns, durationMinutes, date
- AC2: SVG scatter plot: x = turns, y = durationMinutes; dots colored by project (same palette as memory-growth)
- AC3: Hover tooltip: slug, session date, turns, duration
- AC4: Histogram of turn counts (10 buckets) shown below scatter
- AC5: Stats header: median turns, median duration, longest session
- AC6: Added to Observability nav

---

## P272 — Project Inactivity Heatmap

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

The idle-fleet page shows which projects are currently idle, but gives no history of when each project was last active. Operators cannot see patterns like "project X goes silent every weekend" or identify projects that have been abandoned.

### Proposed Solution

Add a `/inactivity-heatmap` page. A `/api/inactivity-heatmap` endpoint reads transcript mtime per project per day (scanning JSONL files modified on each day) and builds a `{ slug, activeDays: string[] }[]` structure for the last 60 days. Page renders a calendar-strip heatmap: rows = projects, columns = days (last 60), cells colored by whether the project had any turns that day (active = cyan, inactive = dark). Hover shows date and turn count.

### Acceptance Criteria

- AC1: `/api/inactivity-heatmap` returns `{ slug, dailyTurns: { date, count }[] }[]` for last 60 days
- AC2: Calendar-strip SVG heatmap: rows = projects (sorted by inactive days desc), cols = days
- AC3: Active cells colored cyan (intensity = turn count), inactive cells near-black
- AC4: Hover tooltip: project, date, turn count
- AC5: Right-side bar shows inactive day count per project
- AC6: Added to Observability nav; max 25 projects shown

---

## P273 — Memory Type Ratio Radar

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Projects have different memory type compositions (more feedback memories vs. project memories vs. user memories) but this ratio is invisible. Radar charts per project would reveal whether memory is balanced or skewed toward one type.

### Proposed Solution

Add a `/memory-radar` page. A `/api/memory-radar` endpoint scans each project's `memory/` directory, counts files per canonical type (user, feedback, project, reference), and also counts word-density (total words) per type. Returns `{ slug, typeCounts: Record<string, number>, typeWords: Record<string, number> }[]`. Page renders one small SVG radar (pentagon) per project — 4 axes for the 4 types, two overlaid polygons (file count fill, word density outline). Grid layout, up to 20 projects.

### Acceptance Criteria

- AC1: `/api/memory-radar` returns per-project type counts and word counts
- AC2: Small SVG radar per project (4 axes), file-count polygon filled cyan, word-density polygon outlined amber
- AC3: Grid layout: 4 or 5 columns; project slug label below each radar
- AC4: Hover on a radar enlarges it in a tooltip overlay for detail
- AC5: Legend shows file-count vs word-density encoding
- AC6: Added to Intelligence nav; projects with no memory show empty radar

---

## P274 — Proposal × Memory Coverage Matrix

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

There is no view connecting specclaw proposal topics to which projects have relevant memory coverage for those topics. An operator cannot tell if a proposal is being worked on by a project that lacks any memory of the relevant domain.

### Proposed Solution

Add a `/proposal-memory-matrix` page. A `/api/proposal-memory-matrix` endpoint reads `.specclaw/changes/*/proposal.md` files across all projects to extract proposal titles and keywords, then reads each project's memory files to extract keywords from frontmatter `description` fields. Returns `{ proposals: string[], projects: string[], matrix: number[][] }` where each cell is the keyword overlap score (0–1). Page renders an SVG heatmap: rows = proposals, cols = projects, cell color = overlap. High-coverage cells (score ≥ 0.5) get a bright highlight.

### Acceptance Criteria

- AC1: `/api/proposal-memory-matrix` returns overlap matrix for all proposal × project pairs
- AC2: SVG heatmap rows = proposals (truncated title), cols = projects; max 20×20
- AC3: Cell color encodes overlap (0 = near-black, 1 = bright cyan); cells ≥ 0.5 labeled with score
- AC4: Hover tooltip: proposal title, project slug, overlap score, matched keywords
- AC5: Sort rows by max-column-score desc (most-covered proposals first)
- AC6: Added to Intelligence nav; empty state when no proposals found

---

## P275 — Project Health Scorecard

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators have no single-view summary of each project's overall health. Metrics like memory count, session turns, last active, proposals, and alerts are scattered across multiple pages.

### Proposed Solution

Add a `/health-scorecard` page. A `/api/health-scorecard` endpoint aggregates per-project: memory file count, total sessions, last-active timestamp, open specclaw proposal count, watchdog-kill count (last 7 days), and a composite health score (0–100) computed from weighted sub-scores. Returns `{ projects: { slug, score, memory, sessions, lastActiveDaysAgo, openProposals, recentKills }[] }`. Page renders a grid of cards — one per project — each showing the score as a circular arc gauge (SVG), colored green/amber/red by score band, plus mini stat rows.

### Acceptance Criteria

- AC1: `/api/health-scorecard` returns composite health score and sub-metrics per project
- AC2: Grid of project cards; each card has circular arc gauge (0–100, colored by band: ≥70 cyan, 40–69 amber, <40 red)
- AC3: Card shows: slug, score, memory files, sessions, last-active (relative), open proposals, recent kills
- AC4: Hover card shows breakdown of how score was computed (mini score table)
- AC5: Cards sortable by score (default), slug, or last-active
- AC6: Added to Fleet nav; empty state when no projects

---

## P276 — Turn Velocity Sparklines Wall

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

No single view shows turn-rate trends for all projects simultaneously. Operators must click into each project individually to assess whether activity is rising, falling, or flat.

### Proposed Solution

Add a `/velocity-wall` page. A `/api/velocity-wall` endpoint reads transcripts for all projects, groups turns by day for the last 30 days, and returns `{ projects: { slug, daily: { date: string, count: number }[] }[] }`. Page renders a dense grid of small sparklines (SVG polylines, 30 data points each), one per project, labeled with slug and 7-day total. Color-encodes trend: rising = cyan, falling = amber, flat = slate. Sparklines are click-to-zoom.

### Acceptance Criteria

- AC1: `/api/velocity-wall` returns daily turn counts for last 30 days per project
- AC2: Grid of SVG sparklines: one per project, 30 data points, 80×30px each
- AC3: Trend color: rising (last 7d avg > prior 7d avg) = cyan; falling = amber; flat = slate
- AC4: Click sparkline opens expanded 90-day view modal
- AC5: Header stats: most active project, fleet-wide daily average
- AC6: Added to Fleet nav

---

## P277 — Memory Link Graph

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Memory files can reference each other via `[[slug]]` links, but these cross-file connections are invisible. Operators cannot tell which memories are central hubs versus isolated islands.

### Proposed Solution

Add a `/memory-link-graph` page. A `/api/memory-link-graph` endpoint scans each project's `memory/` directory, extracts `[[...]]` references from file content, and builds a directed graph `{ nodes: { id, slug, project, type, wordCount }[], edges: { source, target, project }[] }`. Page renders a force-directed SVG graph using D3-style layout computed server-side (or client-side via simple spring algorithm): nodes colored by memory type, edges as faint arcs, node size ∝ wordCount. Project filter dropdown.

### Acceptance Criteria

- AC1: `/api/memory-link-graph` returns nodes and edges with type/wordCount metadata
- AC2: Force-directed SVG graph: nodes colored by memory type (same palette as memory-radar)
- AC3: Node size proportional to word count; isolated nodes shown in dim corner cluster
- AC4: Hover node: shows slug, type, word count, in/out-degree
- AC5: Project filter dropdown; "all projects" merges graphs, colors by project instead of type
- AC6: Added to Intelligence nav

---

## P278 — Proposal Pipeline Kanban

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

There is no at-a-glance view of the specclaw proposal pipeline across all projects. Status transitions (proposed → planning → building → done) are invisible without reading individual spec files.

### Proposed Solution

Add a `/proposal-kanban` page. A `/api/proposal-kanban` endpoint scans `.specclaw/changes/*/proposal.md` across all projects, reads each `proposal.md` plus companion `spec.md`/`tasks.md`/`verify-report.md` to infer stage, and returns `{ columns: { stage, proposals: { slug, project, title, age }[] }[] }`. Stages: `proposed` (proposal only), `planning` (spec.md exists), `building` (tasks.md exists), `verifying` (verify-report.md exists), `done` (PR merged). Page renders a horizontal kanban: 5 columns, cards draggable (state managed client-side only, no persistence).

### Acceptance Criteria

- AC1: `/api/proposal-kanban` returns proposals bucketed into 5 stages based on file presence
- AC2: Horizontal kanban with 5 columns; cards show project slug, title (truncated), age
- AC3: Card color encodes project (consistent palette)
- AC4: Column headers show stage name and count
- AC5: Hover card: full title, last modified, stage inference logic
- AC6: Added to Intelligence nav; empty state when no proposals

---

## P279 — Fleet Live Pulse Board

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators have no real-time visual indicating which projects are actively processing turns at this moment. The fleet-view page shows session state but does not animate or pulse to draw attention to live activity.

### Proposed Solution

Add a `/live-pulse` page. An SSE endpoint `/api/live-pulse/stream` polls transcript mtimes every 3 seconds, detects files written within the last 10 seconds, and emits `{ active: string[] }` events. The page renders a grid of project circles: active circles glow cyan with a CSS pulse animation, idle circles are dim slate. Circle size ∝ average turns/day (last 7d). Hovering shows last-active timestamp and session count.

### Acceptance Criteria

- AC1: `/api/live-pulse/stream` is an SSE endpoint emitting `{ active: string[] }` every 3 seconds
- AC2: Grid of project circles; active (transcript written in last 10s) pulse cyan; idle are dim
- AC3: Circle size proportional to average turns/day (last 7 days); min/max clamped
- AC4: Hover: slug, last-active timestamp, session count, current-turn status
- AC5: Connection status indicator (connected/reconnecting)
- AC6: Added to Fleet nav

---

## P280 — Health Score History Trail

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

P275 (Project Health Scorecard) delivers a point-in-time health score per project, but scores are recalculated fresh on every page load with no persistence. Operators cannot tell whether a project's score is improving, declining, or stable — they only ever see right now.

### Proposed Solution

Add a `/health-score-history` page. A background job (or on-demand computation) appends daily health snapshots to `memory/health-snapshots.jsonl` per project (one JSON line per day: `{ date, slug, score, breakdown }`). A `/api/health-score-history` endpoint reads these files and returns `{ projects: { slug, history: { date, score }[] }[] }`. The page renders a multi-line area chart (one line per project, last 30 days) with a project-filter checkbox list. Clicking a data point expands the score breakdown for that day in a side panel. Color encodes trend direction: improving = cyan, declining = amber, flat = slate. Uses the same scoring logic as `/health-scorecard`.

### Acceptance Criteria

- AC1: Daily health snapshots written to `memory/health-snapshots.jsonl` per project (via cron or on-demand capture)
- AC2: `/api/health-score-history` returns 30-day score history per project
- AC3: Multi-line area chart: one line per project, 30 data points, color-coded by trend direction
- AC4: Project-filter checkbox list; default shows top 10 by variance (most interesting)
- AC5: Clicking a data point opens side panel with full score breakdown for that day
- AC6: Added to Intelligence nav; empty state when <2 days of data exist

---

## P281 — Velocity Wall Platform Breakdown

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

P276 (Turn Velocity Sparklines Wall) aggregates all turns regardless of platform (Discord, Teams, WhatsApp). Operators managing multi-platform fleets cannot isolate whether a velocity change is platform-specific or fleet-wide — a Teams outage looks identical to organic slowdown.

### Proposed Solution

Extend `/api/velocity-wall` to include a `platform` field per project (from `channels.json`). Add a platform filter toggle bar at the top of `/velocity-wall` (All / Discord / Teams / WhatsApp). When a platform is selected, only sparklines for projects on that platform render; the header stats (most active, fleet average) recompute for the filtered set. Add a platform badge on each sparkline card. No new API endpoint needed — filter client-side from the existing response.

### Acceptance Criteria

- AC1: `/api/velocity-wall` response includes `platform` field per project
- AC2: Platform filter toggle bar (All / Discord / Teams / WhatsApp) above the sparkline grid
- AC3: Selecting a platform filters the grid; header stats recompute for filtered set
- AC4: Filter state preserved in URL query param (`?platform=teams`)
- AC5: Badge on each sparkline card shows platform icon
- AC6: Existing AC1-AC6 from P276 unaffected

---

## P282 — Memory Orphan Report

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

P277 (Memory Link Graph) renders isolated memory nodes in a dim corner cluster, but provides no actionable path to cleaning them up. Operators must locate orphaned files manually, cross-reference with the graph, and decide what to link or delete — all across separate views.

### Proposed Solution

Add a `/memory-orphan-report` page. A `/api/memory-orphan-report` endpoint reuses the link-graph traversal from P277 to identify nodes with zero incoming and zero outgoing `[[...]]` links. Returns `{ orphans: { project, file, wordCount, lastModified, snippet }[] }` sorted by lastModified ascending (oldest first). Page renders a table with columns: project, file, age, word count, first-line preview. Each row has a "Copy path" button and an "Open in memory-link-graph" link. Header shows orphan count vs total memory files (orphan rate %).

### Acceptance Criteria

- AC1: `/api/memory-orphan-report` returns files with zero in-degree and zero out-degree in the link graph
- AC2: Table columns: project, filename, age (relative), word count, first-line snippet
- AC3: "Copy path" button per row; "View in graph" link opens `/memory-link-graph?highlight=<id>`
- AC4: Header shows orphan count, total memory files, orphan rate %
- AC5: Filter by project (dropdown) and minimum age (7d / 30d / 90d slider)
- AC6: Added to Intelligence nav; empty state when no orphans

---

## P283 — Health Score Drop Alerts

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

P275 (Project Health Scorecard) displays scores but provides no proactive notification when a score drops below a critical threshold. Operators discover degraded projects only by periodically visiting the scorecard page.

### Proposed Solution

Add a health-score alert rule system. Extend `channels.json` defaults and per-project config with an optional `healthScoreThreshold` field (integer 0-100). The MCD server's scheduler tick evaluates health for projects with a threshold set; if score drops below threshold for two consecutive ticks, it posts a Discord/Teams message to the master channel. Alert format: `⚠️ [slug] health score dropped to <score>/<threshold> — top factors: <list>`. De-duplicates with hysteresis (no repeat until score recovers above threshold + 5). UI section in `/project-config` to view/edit thresholds.

### Acceptance Criteria

- AC1: `healthScoreThreshold` field supported in `channels.json` per-project and defaults
- AC2: Scheduler tick evaluates health score for projects with threshold set
- AC3: Alert fires to master channel when score < threshold for 2 consecutive ticks
- AC4: Alert de-duplicates: no repeat until score recovers above threshold + 5 (hysteresis)
- AC5: `/project-config` shows threshold input per project
- AC6: `/api/health-alert-rules` returns current rules and last-evaluated scores

---

## P284 — Proposal Lifecycle Dashboard

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators proposing, planning, and building changes across many projects have no unified view of where each proposal sits in the specclaw lifecycle (propose → plan → build → verify → PR). Progress must be inferred from scattered `.specclaw/` directories, git branches, and GitHub PRs.

### Proposed Solution

Add a `/proposal-lifecycle` page. A `/api/proposal-lifecycle` endpoint walks all project directories under `MCD_CHANNELS_DIR`, reads `.specclaw/changes/*/proposal.md` + `spec.md` + `tasks.md` + `verify-report.md` for each project, and infers stage (proposed/planned/building/verifying/merged) from file presence and git branch status. Returns `{ projects: { slug, proposals: { name, stage, createdAt, updatedAt, prUrl? }[] }[] }`. Page renders a Kanban-style board with 5 stage columns; each card shows proposal name, slug badge, age, and a stage-progress mini-bar. Clicking a card opens a side drawer with the full proposal.md content. Header shows fleet-wide throughput: proposals merged/week (last 4 weeks), average time-to-merge.

### Acceptance Criteria

- AC1: `/api/proposal-lifecycle` returns proposals with inferred stage for all projects
- AC2: Kanban board with columns: Proposed / Planned / Building / Verifying / Merged
- AC3: Cards show proposal name, slug badge, age, and mini stage-progress bar
- AC4: Clicking a card opens side drawer with full proposal.md and tasks.md checklist
- AC5: Header shows fleet throughput: merged/week (4-week rolling), average time-to-merge
- AC6: Filter by project slug (multi-select) and stage; added to Intelligence nav

---

## P285 — Memory-Project Correlation Matrix

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators cannot tell which projects share knowledge via memory links, which projects have isolated memory silos, or how densely interconnected the fleet's collective memory is. The existing memory-link graph (P277) shows per-project links but does not reveal cross-project patterns.

### Proposed Solution

Add a `/memory-correlation` page. A `/api/memory-correlation` endpoint reads all `memory/*.md` files across projects, extracts `[[link]]` references, and builds a project-to-project co-citation matrix: two projects are correlated when a memory in project A references a concept also referenced in project B (topic overlap by shared `[[slug]]` targets). Returns an NxN matrix with correlation scores (0–1). Page renders an interactive heatmap grid (projects on both axes, cell color = correlation intensity). Hovering a cell shows the shared memory concepts. A "cluster" button reorders rows/columns by hierarchical clustering to reveal knowledge communities. A sidebar shows the top-10 most cross-referenced memory concepts fleet-wide.

### Acceptance Criteria

- AC1: `/api/memory-correlation` returns NxN correlation matrix (N = active projects with memory)
- AC2: Interactive heatmap; cell hover shows shared concept list
- AC3: "Cluster" button reorders axes by hierarchical clustering; cluster boundaries visible
- AC4: Sidebar shows top-10 cross-referenced memory concepts with link counts
- AC5: Diagonal (self-correlation) shown as a distinct color (not white-noise)
- AC6: Added to Intelligence nav; graceful empty state for fleets with <2 projects

---

## P286 — Fleet Constellation 3D View

**Status:** `[ ] pending`
**Created:** 2026-06-26

### Problem

The existing 3D graph (P209) renders project relationships as a generic force-directed graph. It does not encode operational dimensions — health, activity, platform — as spatial or visual properties, making it hard to spot patterns at a glance. Operators want a "futuristic dashboard" feel where the fleet state is immediately legible from the visualization.

### Proposed Solution

Add a `/constellation` page. Uses Three.js / react-three-fiber. Each project is rendered as a star sphere: position in 3D space determined by PCA on [health score, turn velocity, memory richness, uptime%] — clusters emerge naturally. Star size = average turn duration (longer turns = larger star). Star color/glow = platform (Discord=cyan, Teams=indigo, WhatsApp=green). Pulsing animation rate = activity in last 24h (more active = faster pulse). Projects with active sessions emit particle trails. Hovering a star shows a floating HUD card with slug, health score, last-active, and current status. Clicking locks the HUD and opens a mini session panel. Platform legend, zoom controls, and a "reset camera" button complete the UI. Auto-rotates when idle; stops on interaction.

### Acceptance Criteria

- AC1: 3D scene renders all active projects as positioned star spheres
- AC2: Position derived from PCA on [health, velocity, memory richness, uptime]; clusters visible
- AC3: Size = avg turn duration; color/glow = platform; pulse rate = 24h activity
- AC4: Active sessions emit particle trail animation
- AC5: Hover shows floating HUD; click locks HUD + opens mini session panel
- AC6: Added to Fleet nav; auto-rotate when idle, pause on interaction

---

## P287 — Session Replay Scrubber

**Status:** `[ ] pending`
**Created:** 2026-06-26

### Problem

When a project session behaves unexpectedly (wrong tool calls, stuck agent, bad output), operators have no way to replay the sequence of events that led to the outcome. Reading raw `.jsonl` transcripts is slow and gives no visual sense of timing, branching, or tool-call chains.

### Proposed Solution

Add a `/session-replay` page. A `/api/session-replay?slug=<slug>&sessionId=<id>` endpoint reads the session's `.jsonl` transcript and returns `{ events: { ts, type: 'user'|'tool_use'|'tool_result'|'reply'|'agent_span', label, durationMs?, parentId? }[] }` structured for replay. Page renders a horizontal timeline scrubber (1px = configurable time scale, min 100ms). Events appear as colored blocks on swim-lanes: user inputs (top), tool calls (middle), replies (bottom). Dragging the playhead animates the event sequence with a "now playing" highlight. A speed control (0.25×/0.5×/1×/2×/5×) adjusts playback. Clicking any block opens a detail panel with full event content. A session selector dropdown lists available sessions for the chosen project.

### Acceptance Criteria

- AC1: `/api/session-replay` returns structured event list from `.jsonl` transcript
- AC2: Horizontal timeline with swim-lanes (user / tool_use / replies); time-accurate spacing
- AC3: Scrubber playhead with animated playback at selectable speed (0.25×–5×)
- AC4: Clicking any event block opens detail panel with full content
- AC5: Session selector dropdown lists past sessions; project selector for fleet-wide search
- AC6: Added to Intelligence nav; graceful handling of missing/truncated transcripts

---

## P288 — Cross-Project Insight Radar

**Status:** `[x] done`
**Created:** 2026-06-26

### Problem

Operators want to compare multiple projects across several health dimensions simultaneously — not just health score, but velocity, memory richness, schedule adherence, tool diversity, and backlog coverage — in a single glanceable view. Existing views are per-dimension, requiring navigation across multiple pages to build a mental model.

### Proposed Solution

Add a `/insight-radar` page. A `/api/insight-radar` endpoint computes 6 normalized scores (0–100) per project: health (from P275 logic), turn velocity (turns/day last 7d), memory richness (memory file count × avg link density), schedule adherence (jobs fired on time / total scheduled), tool diversity (unique tools used / total possible tools in last 7d), and backlog coverage (done proposals / total proposals). Returns `{ projects: { slug, platform, scores: { health, velocity, memory, schedule, toolDiversity, backlogCoverage } }[] }`. Page renders a radar/spider chart with 6 axes; operators select 2–8 projects via a checkbox list; each selected project draws one colored polygon overlay. A "compare" mode highlights gaps between selected projects. Axis labels are clickable and navigate to the relevant detail page.

### Acceptance Criteria

- AC1: `/api/insight-radar` returns 6 normalized scores per project
- AC2: Radar chart with 6 axes; each selected project rendered as a colored polygon overlay
- AC3: Project selector (checkbox list, max 8 simultaneous); default = top 5 by health score
- AC4: "Compare" mode highlights the delta polygon between two selected projects
- AC5: Axis label clicks navigate to the relevant detail page (e.g. health → `/scorecard`)
- AC6: Added to Intelligence nav; score methodology documented in a collapsible legend
