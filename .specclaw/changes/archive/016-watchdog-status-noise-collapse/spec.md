# Spec: Watchdog status noise collapse

## Functional Requirements

- FR1: `progress-skip` events carry a stable `episodeStartMs` (the pending-turn start timestamp) identifying the stuck episode.
- FR2: Within one episode, the first progress-skip posts one Discord status message; subsequent events edit it in place (updated elapsed minutes). New episode → fresh message.
- FR3: Episode state clears on real reply (message also deleted — zero residue), stuck-kill, and crash; next episode posts fresh.
- FR4: Edit failure (message deleted/unfetchable) falls back to posting a new message and re-tracking it.
- FR5: Teardown (`stuck`) and respawn warnings remain separate new posts. Non-Discord platforms keep current per-event posting.

## Acceptance Criteria

- AC1: N progress-skip events, same episode → one message posted, edited N-1 times (unit test at pool level: payload carries stable episodeStartMs)
- AC2: New episode (new turn) → different episodeStartMs (unit test)
- AC3: Reply/kill/crash clears tracking state (code-level; reply path deletes the message like editProgressState)
- AC4: Edit-failure fallback posts new message (code path mirrors progressMode edit fallback)
- AC5: `bun tsc --noEmit` clean; project-pool suite extended and green
