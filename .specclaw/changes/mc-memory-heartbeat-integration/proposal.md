# Proposal: Memory-Aware Heartbeat Prompt

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The memory integration (PR #47) added MCP tools for master Claude to persist cross-channel observations. However, the recommended heartbeat schedule prompt in `templates/master.CLAUDE.md` does not instruct master Claude to use these tools. As a result, the memory store remains empty even on running systems — the tooling exists but the workflow to fill it does not.

## Proposed Solution

Update the heartbeat schedule prompt template in `templates/master.CLAUDE.md` to include explicit memory read/write steps in the heartbeat workflow:

**Before scan:**
> "Call `mcp__mcd__recall` with query 'channel summary' (no slug filter) to retrieve recent channel_summary memories before scanning."

**After scan:**
> "For each channel you scanned, call `mcp__mcd__remember` with type=channel_summary, the channel slug, and a 1–2 sentence summary of its state."

**After inject:**
> "After injecting into a channel, call `mcp__mcd__remember` with type=coordination, the target slug, and a note on what was injected and why."

Also update `bin/setup-new-instance.sh` to register a default heartbeat schedule with the memory-aware prompt when `--heartbeat` flag is passed.

### Files changed

- `templates/master.CLAUDE.md` — updated heartbeat schedule example in `## Automated heartbeat via scheduler` section
- `projects/master/CLAUDE.md` — deployed copy (overwrite from template)
- `bin/setup-new-instance.sh` — optional `--heartbeat` flag bootstraps memory-aware schedule

## Acceptance Criteria

- AC1: `templates/master.CLAUDE.md` heartbeat schedule example includes recall before scan and remember after scan
- AC2: Post-inject memory save step documented in the inject usage example
- AC3: Deployed to `projects/master/CLAUDE.md` (template overwrite)
- AC4: `bin/setup-new-instance.sh --heartbeat` registers a schedule with the updated prompt
- AC5: Existing scheduled jobs on live instances are not modified by this change (template only)
- AC6: New heartbeat prompt fits within a single `schedule add` command (no truncation)
