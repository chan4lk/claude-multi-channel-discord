# Verification Report: watchdog-status-noise-collapse

**Verified:** 2026-07-18
**Verdict:** PASS

- ✅ AC1: progress-skip payload carries stable episodeStartMs (= pendingDeliverAtMs turn start) — pool tests 9b/9c PASS; server edits tracked message when episodeId matches
- ✅ AC2: new turn → new pendingAt → new episodeStartMs (payload sourced from pendingAt per turn; 9b confirms value = deliver time)
- ✅ AC3: state cleared on real reply (message deleted, same pattern as editProgressState in dispatchProjectReply), on 'stuck' and on 'crashed' events
- ✅ AC4: fetch-fail fallback posts fresh message + re-tracks (mirrors progressMode edit fallback)
- ✅ AC5: `bun tsc --noEmit` clean; project-pool suite (incl. 9b/9c) green

Non-Discord platforms keep per-event routeNotification posting (documented in design; edit parity out of scope). Teardown/respawn warnings unchanged — separate posts.

**Verdict:** PASS (5/5)
