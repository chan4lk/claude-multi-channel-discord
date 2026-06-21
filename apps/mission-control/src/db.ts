import Database from "better-sqlite3";

export type McEvent = {
  instance_id: string;
  host: string;
  user: string;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};

export type InstanceRow = {
  instance_id: string;
  host: string;
  user: string;
  api_key: string;
  last_seen: string | null;
  created_at: number;
};

export type EventRow = {
  id: number;
  instance_id: string;
  host: string;
  user: string;
  ts: string;
  type: string;
  payload: string;
  created_at: number;
};

const dbPath = process.env.MC_DB_PATH ?? "mc.db";
const retentionDays = parseInt(process.env.MC_RETENTION_DAYS ?? "30", 10);

const db = new Database(dbPath);

db.exec("PRAGMA journal_mode=WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS instances (
  instance_id TEXT PRIMARY KEY,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  api_key     TEXT NOT NULL,
  last_seen   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  host        TEXT NOT NULL,
  user        TEXT NOT NULL,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_events_instance   ON events(instance_id);
CREATE INDEX IF NOT EXISTS idx_events_type       ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

CREATE TABLE IF NOT EXISTS project_annotations (
  slug       TEXT PRIMARY KEY,
  note       TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// Prune old events on startup
const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff);

export function insertEvent(e: McEvent): void {
  db.prepare(
    `INSERT INTO events (instance_id, host, user, ts, type, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(e.instance_id, e.host, e.user, e.ts, e.type, JSON.stringify(e.payload));
}

export function updateLastSeen(e: McEvent): void {
  db.prepare(
    `INSERT INTO instances (instance_id, host, user, api_key, last_seen)
       VALUES (?, ?, ?, '', ?)
       ON CONFLICT(instance_id) DO UPDATE SET
         last_seen = excluded.last_seen,
         host      = excluded.host,
         user      = excluded.user`
  ).run(e.instance_id, e.host, e.user, e.ts);
}

export function getInstances(): InstanceRow[] {
  return db.prepare("SELECT * FROM instances ORDER BY created_at DESC").all() as InstanceRow[];
}

export function getEvents(filters: {
  instance_id?: string;
  type?: string;
  since?: string;
  limit?: number;
}): EventRow[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.instance_id) {
    conditions.push("instance_id = ?");
    params.push(filters.instance_id);
  }
  if (filters.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters.since) {
    conditions.push("ts >= ?");
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitClause = filters.limit != null ? `LIMIT ${filters.limit}` : "";
  const sql = `SELECT * FROM events ${where} ORDER BY created_at DESC ${limitClause}`;
  return db.prepare(sql).all(...params) as EventRow[];
}

export type InstanceActivity = {
  activeSlugs: string[];
  lastActivity: string | null;
};

export function getInstanceActivity(instanceId: string): InstanceActivity {
  // Get distinct slugs from events in last 5 min for this instance
  const slugRows = db.prepare(`
    SELECT DISTINCT json_extract(payload, '$.slug') AS slug
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
      AND json_extract(payload, '$.slug') IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 50
  `).all(instanceId) as Array<{ slug: string }>;

  // Get most recent event type
  const lastRow = db.prepare(`
    SELECT type
    FROM events
    WHERE instance_id = ?
      AND created_at > unixepoch() - 300
    ORDER BY created_at DESC
    LIMIT 1
  `).get(instanceId) as { type: string } | undefined;

  return {
    activeSlugs: slugRows.map((r) => r.slug).filter(Boolean),
    lastActivity: lastRow?.type ?? null,
  };
}

export function getAnnotation(slug: string): string | null {
  const row = db.prepare('SELECT note FROM project_annotations WHERE slug = ?').get(slug) as { note: string } | undefined
  return row?.note ?? null
}

export function upsertAnnotation(slug: string, note: string): void {
  if (note.trim() === '') {
    db.prepare('DELETE FROM project_annotations WHERE slug = ?').run(slug)
  } else {
    db.prepare(
      `INSERT INTO project_annotations (slug, note, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(slug) DO UPDATE SET note = excluded.note, updated_at = unixepoch()`
    ).run(slug, note.slice(0, 500))
  }
}

export function getAllAnnotations(): Array<{ slug: string; note: string; updated_at: number }> {
  return db.prepare('SELECT slug, note, updated_at FROM project_annotations').all() as Array<{ slug: string; note: string; updated_at: number }>
}

export default db;
