---
name: project-mc-better-sqlite3
description: better-sqlite3 fails under Bun — mc-dashboard must run under Node.js
metadata:
  type: project
---

better-sqlite3 is a native Node.js addon that doesn't load under Bun (ERR_DLOPEN_FAILED). The mc-dashboard app uses it in src/db.ts and src/auth.ts.

**Why:** Bun doesn't support native addons via dlopen yet (tracked: oven-sh/bun#4290).

**How to apply:** Run mc-dashboard under Node.js, not Bun. If ever migrating to bun:sqlite, update db.ts (import { Database } from "bun:sqlite") and the better-auth adapter config in auth.ts.
