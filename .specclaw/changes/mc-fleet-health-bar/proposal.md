# Proposal: Fleet Health Bar

**Created:** 2026-06-20
**Status:** 🟡 Draft

## Problem

The mission control dashboard header shows instance count and uptime, but has no per-state breakdown of the Claude fleet. Operators cannot immediately see how many channels are idle, actively working, stalled, or running autonomously without drilling into the Instance Grid — which shows instances (server processes), not project states.

## Proposed Solution

Extend the fixed HUD header with project-state counters sourced from `channels.json` and transcript recency. Add a `/api/fleet` endpoint in `apps/mission-control/` that reads `channels.json` from `MCD_CHANNELS_DIR` and cross-references each project's most recent transcript write time to classify state as `idle | active | stalled | autonomous`. Display four neon badges in the header alongside the existing instance/uptime counters:

- **Idle** (cyan) — no transcript activity in last 5 min, no stall markers
- **Active** (green) — transcript written within last 5 min
- **Stalled** (red, pulsing when > 0) — question-unanswered or tool-incomplete stall detected
- **Autonomous** (purple) — project has `heartbeatMode: autonomous` set

Clicking any badge adds a `?state=` filter query param; the Instance Grid reads and reacts to it.

### Architecture

- `apps/mission-control/app/api/fleet/route.ts` — reads `channels.json`, classifies each project
- Header in `app/page.tsx` gets four new `CountBadge` components
- State classification reuses stall heuristics from `src/heartbeat.ts` (transcript age + stall marker detection)

## Acceptance Criteria

- AC1: Idle / Active / Stalled / Autonomous counts shown in header; update every 30s
- AC2: Stalled count badge pulses (CSS animation) when count > 0
- AC3: Clicking a state badge adds `?state=<state>` query param; Instance Grid filters accordingly
- AC4: `/api/fleet` reads from `MCD_CHANNELS_DIR`; no restart needed when projects change
- AC5: Header remains single line on ≥ 1280px viewport; badges wrap gracefully on mobile
- AC6: Projects with no transcript directory classified as idle (not stalled)
