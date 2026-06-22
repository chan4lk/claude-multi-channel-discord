# Spec: Heartbeat Watchdog

## Functional Requirements

### FR1 — Interval scheduler syntax
The scheduler SHALL accept `"every Xm"` and `"every Xh"` (where X is a positive integer) as an alternative to the existing `HH:MM` daily-fire syntax.
- `every 30m` fires every 30 minutes
- `every 1h` fires every hour
- `HH:MM` entries are unchanged
- `!project schedule add <slug> every 30m "<prompt>"` creates an interval entry

### FR2 — `mcp__mcd__inject` MCP tool
A new MCP tool `mcp__mcd__inject` SHALL be exposed on the master MCP server, callable only from the master channel.
- Parameters: `chatId: string`, `text: string`
- Behaviour: delivers `text` into the target channel's Claude subprocess (via pool.deliver with a synthetic InboundEnvelope), spawning the subprocess if idle-evicted
- Rejected with an error if called from a non-master channel
- `mcp__mcd__*` prefix suppresses it from progress-mode output (existing rule)

### FR3 — Per-channel heartbeat configuration
`channels.json` ProjectEntry SHALL support an optional `heartbeat` object:
```jsonc
"heartbeat": {
  "mode": "supervised" | "autonomous",   // default: "supervised"
  "window": "HH:MM-HH:MM",              // UTC, autonomous only; omit = always-on
  "staleAfterMinutes": 60               // default: 60
}
```
- If `heartbeat` is absent the channel is treated as `supervised` with `staleAfterMinutes: 60`
- `window` is optional even in autonomous mode (omit = autonomous 24/7)

### FR4 — `!project heartbeat` master verb
`!project heartbeat [--channel <slug>]` SHALL:
1. Scan all projects (or just `<slug>` if specified)
2. For each project: read its transcript tail, apply classification heuristics (FR6)
3. Return a structured text report: one line per channel with state + last-activity age + snippet

### FR5 — `!project set` heartbeat flags
`handleSet` SHALL accept:
- `--heartbeat-mode supervised|autonomous`
- `--heartbeat-window HH:MM-HH:MM` (UTC; validated format)
- `--heartbeat-stale-minutes N` (positive integer)
Any subset may be passed together. Updates `channels.json` in-place.

### FR6 — Stale-state classification heuristics
A channel is classified as **stalled** when BOTH:
1. Last transcript write is older than `staleAfterMinutes` (or subprocess is not running)
2. At least one of:
   - Last assistant message (role=`assistant`) ends with or contains `?` with no subsequent user message in the transcript
   - A `tool_use` entry exists with no matching `tool_result` entry (same `tool_use_id`)

A channel is **idle** (not stalled) if neither condition 2a nor 2b holds regardless of age.

### FR7 — Supervised mode reporting
When heartbeat fires and a channel is stalled in `supervised` mode, master SHALL post a summary to the master Discord channel:
```
⏰ Heartbeat report — N stalled channel(s):
• **<slug>** — waiting Xh Ym | last question: "<snippet>"
• **<slug>** — tool incomplete Xh Ym ago
```
If no channels are stalled, master MAY post a one-liner confirmation or stay silent (configurable via the scheduled prompt).

### FR8 — Autonomous mode nudge
When heartbeat fires and a channel is stalled in `autonomous` mode (and within window, FR9):
1. `!project heartbeat --channel <slug>` returns a context summary (state + last pending question/tool + transcript snippet)
2. Master LLM uses that summary to compose a context-aware continuation prompt (e.g. "You were working on X and asked the user Y. The user hasn't replied. Please continue with your best judgement or summarise the blocker.")
3. Master calls `mcp__mcd__inject` with that prompt → subprocess wakes and continues

### FR9 — Autonomous window enforcement (UTC)
If `heartbeat.window` is set on an autonomous channel, the inject (FR8) only fires when the current UTC time falls within the window. Outside the window, the channel is reported in supervised mode instead.

### FR10 — Master scheduled heartbeat setup
The operator SHALL be able to activate heartbeat via:
```
!project schedule add master every 30m "Run the heartbeat: call run_master_command({command:'heartbeat'}) to get the stalled-channel report. For supervised channels, post the report here. For autonomous channels within their window, inject a context-aware continuation prompt via mcp__mcd__inject."
```
Master CLAUDE.md SHALL document this command.

---

## Non-Functional Requirements

- NFR1: `mcp__mcd__inject` delivers within the normal `deliver()` latency budget (no extra round-trip)
- NFR2: Heartbeat scan reads only the last 200 lines of the latest transcript file; never reads full history
- NFR3: Interval scheduler tick precision: ±60 s (existing 60s tick cadence)
- NFR4: No heartbeat inject fires if the target subprocess is actively processing (last transcript mtime < 30s)

---

## Acceptance Criteria

- AC1: `!project schedule add master every 30m "..."` succeeds and appears in `!project schedule list master`
- AC2: Interval entry fires within 90 s of the scheduled window (2 tick cycles)
- AC3: `mcp__mcd__inject` from master channel delivers text to target subprocess; calling from non-master returns error
- AC4: `!project set <slug> --heartbeat-mode autonomous --heartbeat-window 09:00-17:00` persists to `channels.json` and `!project show <slug>` reflects it
- AC5: `!project heartbeat --channel <slug>` returns correct state for a project whose transcript has an unanswered `?`
- AC6: `!project heartbeat --channel <slug>` returns correct state for a project whose transcript has `tool_use` without `tool_result`
- AC7: Autonomous inject does NOT fire when current UTC time is outside the configured window
- AC8: Supervised channels receive no inject — only master Discord gets the report

---

## Edge Cases

- EC1: Project has no transcript file (never messaged) → classified as `idle`, skipped
- EC2: Project subprocess is currently active (recent mtime) → skip regardless of classification
- EC3: `window` spans midnight UTC (e.g. `22:00-06:00`) → correctly handled as two ranges
- EC4: `every` interval entry with `maxRuns` set → fires at most `maxRuns` times then disables
- EC5: `mcp__mcd__inject` called for a project whose subprocess crashes during deliver → error propagated back to master, not silently swallowed
