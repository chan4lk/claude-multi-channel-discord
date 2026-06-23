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
