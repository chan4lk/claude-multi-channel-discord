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

CREATE TABLE IF NOT EXISTS broadcasts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL,
  message    TEXT NOT NULL,
  targets    TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_ts ON broadcasts(ts);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL DEFAULT (unixepoch()),
  actor     TEXT NOT NULL DEFAULT '',
  actor_id  TEXT NOT NULL DEFAULT '',
  verb      TEXT NOT NULL,
  target    TEXT NOT NULL DEFAULT '',
  payload   TEXT NOT NULL DEFAULT '{}',
  ip        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_verb    ON audit_log(verb);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target);

CREATE TABLE IF NOT EXISTS fleet_snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL DEFAULT '',
  ts         INTEGER NOT NULL DEFAULT (unixepoch()),
  project_count INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_fleet_snapshots_ts ON fleet_snapshots(ts);

CREATE TABLE IF NOT EXISTS alert_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL DEFAULT (unixepoch()),
  slug       TEXT NOT NULL DEFAULT '',
  alert_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alert_events_ts        ON alert_events(ts);
CREATE INDEX IF NOT EXISTS idx_alert_events_slug      ON alert_events(slug);
CREATE INDEX IF NOT EXISTS idx_alert_events_type      ON alert_events(alert_type);

CREATE TABLE IF NOT EXISTS webhooks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  event_filter TEXT NOT NULL DEFAULT 'all',
  use_slack_format INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id  INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL DEFAULT (unixepoch()),
  event_type  TEXT NOT NULL,
  slug        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  response_code INTEGER,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ts         ON webhook_deliveries(ts);
`);

// Prune old events on startup
const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff);
db.prepare("DELETE FROM alert_events WHERE ts < ?").run(cutoff);

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
  slug?: string;
  cursor?: number;
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
  if (filters.slug) {
    conditions.push("json_extract(payload, '$.slug') = ?");
    params.push(filters.slug);
  }
  if (filters.cursor != null) {
    conditions.push("id < ?");
    params.push(filters.cursor);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit != null ? Math.min(filters.limit, 500) : 100;
  const sql = `SELECT * FROM events ${where} ORDER BY created_at DESC LIMIT ?`;
  return db.prepare(sql).all(...params, limit) as EventRow[];
}

export function countEvents(filters: { type?: string; slug?: string }): number {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.type) { conditions.push("type = ?"); params.push(filters.type) }
  if (filters.slug) { conditions.push("json_extract(payload, '$.slug') = ?"); params.push(filters.slug) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM events ${where}`).get(...params) as { n: number }
  return row.n
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

export type BroadcastRow = {
  id: number
  ts: string
  message: string
  targets: string
  sent_count: number
  error_count: number
  deleted_at: number | null
}

export function insertBroadcast(ts: string, message: string, targets: string[], sentCount: number, errorCount: number): number {
  const result = db.prepare(
    `INSERT INTO broadcasts (ts, message, targets, sent_count, error_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(ts, message, JSON.stringify(targets), sentCount, errorCount)
  return result.lastInsertRowid as number
}

export function getBroadcastHistory(limit = 50, cursor?: number): BroadcastRow[] {
  if (cursor != null) {
    return db.prepare(
      `SELECT * FROM broadcasts WHERE deleted_at IS NULL AND id < ? ORDER BY id DESC LIMIT ?`
    ).all(cursor, limit) as BroadcastRow[]
  }
  return db.prepare(
    `SELECT * FROM broadcasts WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?`
  ).all(limit) as BroadcastRow[]
}

export function deleteBroadcast(id: number): void {
  db.prepare(`UPDATE broadcasts SET deleted_at = unixepoch() WHERE id = ?`).run(id)
}

export type AuditRow = {
  id: number
  ts: number
  actor: string
  actor_id: string
  verb: string
  target: string
  payload: string
  ip: string
}

export interface AuditEntry {
  actor?: string
  actor_id?: string
  verb: string
  target?: string
  payload?: Record<string, unknown>
  ip?: string
}

export function insertAuditLog(entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (actor, actor_id, verb, target, payload, ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    entry.actor ?? '',
    entry.actor_id ?? '',
    entry.verb,
    entry.target ?? '',
    JSON.stringify(entry.payload ?? {}),
    entry.ip ?? '',
  )
}

export function getAuditLog(opts: {
  actor_id?: string
  verb?: string
  target?: string
  since?: number
  until?: number
  cursor?: number
  limit?: number
}): AuditRow[] {
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.actor_id) { conditions.push('actor_id = ?'); params.push(opts.actor_id) }
  if (opts.verb) { conditions.push('verb = ?'); params.push(opts.verb) }
  if (opts.target) { conditions.push('target = ?'); params.push(opts.target) }
  if (opts.since != null) { conditions.push('ts >= ?'); params.push(opts.since) }
  if (opts.until != null) { conditions.push('ts <= ?'); params.push(opts.until) }
  if (opts.cursor != null) { conditions.push('id < ?'); params.push(opts.cursor) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 100, 500)
  return db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit) as AuditRow[]
}

// ── Fleet Snapshots (P85) ─────────────────────────────────────────────────

export type SnapshotRow = {
  id: number
  label: string
  ts: number
  project_count: number
  data: string
}

export function insertSnapshot(label: string, projectCount: number, data: unknown): number {
  const result = db.prepare(
    `INSERT INTO fleet_snapshots (label, project_count, data) VALUES (?, ?, ?)`
  ).run(label, projectCount, JSON.stringify(data))
  return result.lastInsertRowid as number
}

export function getSnapshots(limit = 50): SnapshotRow[] {
  return db.prepare(
    `SELECT id, label, ts, project_count, data FROM fleet_snapshots ORDER BY ts DESC LIMIT ?`
  ).all(limit) as SnapshotRow[]
}

export function getSnapshot(id: number): SnapshotRow | null {
  return db.prepare(
    `SELECT id, label, ts, project_count, data FROM fleet_snapshots WHERE id = ?`
  ).get(id) as SnapshotRow | null
}

export function deleteSnapshot(id: number): void {
  db.prepare(`DELETE FROM fleet_snapshots WHERE id = ?`).run(id)
}

// ── Alert Events (P87) ────────────────────────────────────────────────────

export type AlertEventRow = {
  id: number
  ts: number
  slug: string
  alert_type: string
  description: string
  payload: string
}

export function insertAlertEvent(
  slug: string,
  alertType: string,
  description: string,
  payload: Record<string, unknown> = {}
): void {
  db.prepare(
    `INSERT INTO alert_events (slug, alert_type, description, payload) VALUES (?, ?, ?, ?)`
  ).run(slug, alertType, description, JSON.stringify(payload))
}

export function getAlertEvents(opts: {
  slug?: string
  alert_type?: string
  cursor?: number
  limit?: number
}): AlertEventRow[] {
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.slug) { conditions.push('slug = ?'); params.push(opts.slug) }
  if (opts.alert_type) { conditions.push('alert_type = ?'); params.push(opts.alert_type) }
  if (opts.cursor != null) { conditions.push('id < ?'); params.push(opts.cursor) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 100, 500)
  return db.prepare(
    `SELECT * FROM alert_events ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit) as AlertEventRow[]
}

// ── Webhooks (P115) ───────────────────────────────────────────────────────

export type WebhookRow = {
  id: number
  name: string
  url: string
  event_filter: string
  use_slack_format: number
  enabled: number
  created_at: number
}

export type WebhookDeliveryRow = {
  id: number
  webhook_id: number
  ts: number
  event_type: string
  slug: string
  status: string
  response_code: number | null
  error: string | null
}

export function getWebhooks(): WebhookRow[] {
  return db.prepare(`SELECT * FROM webhooks ORDER BY created_at DESC`).all() as WebhookRow[]
}

export function getWebhook(id: number): WebhookRow | null {
  return db.prepare(`SELECT * FROM webhooks WHERE id = ?`).get(id) as WebhookRow | null
}

export function insertWebhook(name: string, url: string, eventFilter: string, useSlackFormat: boolean): number {
  const result = db.prepare(
    `INSERT INTO webhooks (name, url, event_filter, use_slack_format) VALUES (?, ?, ?, ?)`
  ).run(name, url, eventFilter, useSlackFormat ? 1 : 0)
  return result.lastInsertRowid as number
}

export function updateWebhook(id: number, fields: Partial<{ name: string; url: string; event_filter: string; use_slack_format: boolean; enabled: boolean }>): void {
  const parts: string[] = []
  const params: unknown[] = []
  if (fields.name !== undefined) { parts.push('name = ?'); params.push(fields.name) }
  if (fields.url !== undefined) { parts.push('url = ?'); params.push(fields.url) }
  if (fields.event_filter !== undefined) { parts.push('event_filter = ?'); params.push(fields.event_filter) }
  if (fields.use_slack_format !== undefined) { parts.push('use_slack_format = ?'); params.push(fields.use_slack_format ? 1 : 0) }
  if (fields.enabled !== undefined) { parts.push('enabled = ?'); params.push(fields.enabled ? 1 : 0) }
  if (parts.length === 0) return
  params.push(id)
  db.prepare(`UPDATE webhooks SET ${parts.join(', ')} WHERE id = ?`).run(...params)
}

export function deleteWebhook(id: number): void {
  db.prepare(`DELETE FROM webhooks WHERE id = ?`).run(id)
}

export function insertWebhookDelivery(
  webhookId: number,
  eventType: string,
  slug: string,
  status: string,
  responseCode: number | null,
  error: string | null
): void {
  db.prepare(
    `INSERT INTO webhook_deliveries (webhook_id, event_type, slug, status, response_code, error)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(webhookId, eventType, slug, status, responseCode, error)
}

export function getWebhookDeliveries(webhookId: number, limit = 20): WebhookDeliveryRow[] {
  return db.prepare(
    `SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?`
  ).all(webhookId, limit) as WebhookDeliveryRow[]
}

export default db;
