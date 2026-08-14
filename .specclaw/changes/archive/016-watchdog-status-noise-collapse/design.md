# Design: Watchdog status noise collapse

- `src/project-pool.ts`: progress-skip event type + emit gain `episodeStartMs: pendingAt` — the pendingDeliverAtMs() turn-start timestamp, stable across polls within a turn, new per turn.
- `server.ts`:
  - `progressSkipState: Map<chatId, { episodeId: number; msgId: string }>`
  - progress-skip handler (discord only): same episodeId → fetch+edit; fetch fail → send new + update msgId; different/absent → send new + set state. Non-discord → existing routeNotification per event.
  - Cleanup: dispatchProjectReply (real reply) deletes tracked message + state (same pattern as editProgressState); 'stuck' and 'crashed' events delete state (message left in place as historical record of the episode that led to teardown).
