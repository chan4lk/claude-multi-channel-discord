---
name: project-mc-dashboard-deploy
description: mc-dashboard service deployment details — runtime, env vars, Caddy routing
metadata:
  type: project
---

mc-dashboard runs on port 3003, served by Node.js (not Bun — better-sqlite3 native addon).

**Why:** better-sqlite3 doesn't load under Bun. Switched ExecStart in mc-dashboard.service from bun to /usr/bin/node.

**How to apply:** When modifying the mc-dashboard service, always use node runtime. Do not switch back to bun unless better-sqlite3 is replaced with bun:sqlite.

Service: ~/.config/systemd/user/mc-dashboard.service
Env vars set in service: BETTER_AUTH_SECRET, BETTER_AUTH_URL, NEXT_PUBLIC_BETTER_AUTH_URL, MC_DB_PATH
Also in .env.local: apps/mission-control/.env.local (for builds)
Caddy: control.tecbizsolutions.com → 127.0.0.1:3003 (already in ~/srv/caddy/Caddyfile)
Admin seed: instrumentation.ts (moved from next.config.ts)
