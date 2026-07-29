# Mission Control — Operations

Operational facts that must survive rebuilds and redeploys. Read this before
touching the systemd units or the database.

## Single service unit: `mc-dashboard.service`

`mc-dashboard.service` is the **only** unit that should serve Mission Control
on port 3003. It runs `next start -p 3003` from this checkout
(`~/.claude/channels/discord-multi/projects/claude-mcd/apps/mission-control`)
and sets `MC_DB_PATH` (see below).

A second, older unit — `mc-web.service` — served a prod clone at
`~/srv/mission-control` on the **same port**. With both enabled, whichever
starts first wins the port and the other crash-loops in `activating
auto-restart` (observed 2026-07-29: `mc-web` restarting every 5 s while
`mc-dashboard` held the port). The loser's restart loop burns CPU and, when
`mc-web` wins the race after a reboot, it serves a stale build **without**
`MC_DB_PATH` set.

### Disabling the duplicate (operator / Hermes deploy action)

This cannot be run from inside MCD (the bot must not manage host services);
run it as the operator, or delegate to Hermes:

```sh
systemctl --user disable --now mc-web.service
```

`mc-web` is also rebuilt/restarted by
`~/.hermes/skills/devops/mcd-operator/scripts/mc-rebuild.sh` and an hourly
`mc-auto-rebuild` cron watchdog. Disabling the unit alone is not enough —
remove or repoint the cron entry as well, otherwise the watchdog resurrects
the unit within the hour:

```sh
crontab -l | grep -n mc-auto-rebuild   # find it
crontab -e                             # remove or comment the line
```

If Hermes deploys should keep working, update `mc-rebuild.sh` to target
`mc-dashboard.service` instead.

## Database: `MC_DB_PATH`

`src/db.ts` (and `src/auth.ts`) resolve the SQLite database as:

```
process.env.MC_DB_PATH ?? "mc.db"   // CWD-relative fallback!
```

The production database lives at
`/home/openclaw/srv/mission-control-hub/mc.db`, wired via
`Environment=MC_DB_PATH=...` in `mc-dashboard.service`.

**Always set `MC_DB_PATH`** when running the app or any script outside the
unit (dev server, `bun run ingest:backfill`, one-off Node scripts). An
env-less run writes a stray `mc.db` next to `package.json` — that stray DB is
gitignored (`mc.db`, `mc.db-shm`, `mc.db-wal`, `mc.db-journal`) and was
removed from the working tree on 2026-07-29, but every unset-env run recreates
it and silently splits your data across two databases.

## Fact index (transcript ingester)

The fact index (`mc_turn`, `mc_tool_call`, `mc_ingest_state` tables in
`mc.db`) is maintained by an incremental ingester:

- **In-process:** `instrumentation.ts` starts an `ingestOnce` loop at boot
  (every `INGEST_INTERVAL_MS` ms, default 30 000) in the Node runtime.
- **One-shot backfill / repair:**

  ```sh
  cd apps/mission-control
  MC_DB_PATH=/home/openclaw/srv/mission-control-hub/mc.db \
  bun run ingest:backfill
  ```

  Safe to re-run — ingestion is offset-based and idempotent; a fresh DB
  backfills everything (~5 s for ~1 350 transcripts), subsequent runs only
  read appended bytes.

The heavy dashboard routes (tool-heatmap, turn-heatmap, momentum-index,
metrics/[slug], turn-duration, capability-map, health-scorecard) and the SSE
broadcaster read from the fact index, not from raw transcripts. If dashboard
numbers look frozen, check that the ingester is running (boot log line) or run
the backfill above.
