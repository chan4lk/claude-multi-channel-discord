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

CREATE TABLE IF NOT EXISTS turn_annotations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  session_file TEXT NOT NULL DEFAULT '',
  turn_index   INTEGER NOT NULL,
  tag          TEXT NOT NULL DEFAULT 'note',
  note         TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_turn_annotations_slug ON turn_annotations(slug);
CREATE INDEX IF NOT EXISTS idx_turn_annotations_tag  ON turn_annotations(tag);

CREATE TABLE IF NOT EXISTS convergence_history (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL,
  date  TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  UNIQUE(slug, date)
);

CREATE INDEX IF NOT EXISTS idx_convergence_slug ON convergence_history(slug);
CREATE INDEX IF NOT EXISTS idx_convergence_date ON convergence_history(date);

CREATE TABLE IF NOT EXISTS goal_advancement (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL,
  date  TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  UNIQUE(slug, date)
);

CREATE INDEX IF NOT EXISTS idx_goal_advancement_slug ON goal_advancement(slug);
CREATE INDEX IF NOT EXISTS idx_goal_advancement_date ON goal_advancement(date);

CREATE TABLE IF NOT EXISTS context_pressure (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  ts          INTEGER NOT NULL DEFAULT (unixepoch()),
  score       REAL NOT NULL DEFAULT 0,
  breakdown   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_ctx_pressure_slug ON context_pressure(slug);
CREATE INDEX IF NOT EXISTS idx_ctx_pressure_ts   ON context_pressure(ts);

CREATE TABLE IF NOT EXISTS turn_quality (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL,
  hour       TEXT NOT NULL, -- ISO 8601 hour: "2026-06-22T14"
  score      REAL NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(slug, hour)
);

CREATE INDEX IF NOT EXISTS idx_turn_quality_slug ON turn_quality(slug);
CREATE INDEX IF NOT EXISTS idx_turn_quality_hour ON turn_quality(hour);

CREATE TABLE IF NOT EXISTS digest_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL DEFAULT (unixepoch()),
  project_count INTEGER NOT NULL DEFAULT 0,
  summary      TEXT NOT NULL DEFAULT '',
  payload      TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_digest_ts ON digest_log(ts);

CREATE TABLE IF NOT EXISTS memory_diff_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL,
  ts        INTEGER NOT NULL,
  sha       TEXT NOT NULL,
  added     INTEGER NOT NULL DEFAULT 0,
  removed   INTEGER NOT NULL DEFAULT 0,
  diff_text TEXT NOT NULL DEFAULT '',
  cached_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(slug, sha)
);

CREATE INDEX IF NOT EXISTS idx_memory_diff_slug ON memory_diff_log(slug);
CREATE INDEX IF NOT EXISTS idx_memory_diff_ts ON memory_diff_log(ts);

CREATE TABLE IF NOT EXISTS constellation_coords (
  slug        TEXT PRIMARY KEY,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  z           REAL NOT NULL DEFAULT 0,
  computed_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// Prune old events on startup
const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
db.prepare("DELETE FROM events WHERE created_at < ?").run(cutoff);
db.prepare("DELETE FROM alert_events WHERE ts < ?").run(cutoff);

// P149 — fleet_snapshots soft-delete migration + 30-day auto-purge
try { db.exec("ALTER TABLE fleet_snapshots ADD COLUMN deleted_at INTEGER"); } catch { /* column already present */ }
const snapshotCutoff = Math.floor(Date.now() / 1000) - 30 * 86400;
db.prepare("DELETE FROM fleet_snapshots WHERE ts < ?").run(snapshotCutoff);

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
    `SELECT id, label, ts, project_count, data FROM fleet_snapshots WHERE deleted_at IS NULL ORDER BY ts DESC LIMIT ?`
  ).all(limit) as SnapshotRow[]
}

export function getSnapshot(id: number): SnapshotRow | null {
  return db.prepare(
    `SELECT id, label, ts, project_count, data FROM fleet_snapshots WHERE id = ? AND deleted_at IS NULL`
  ).get(id) as SnapshotRow | null
}

export function updateSnapshotLabel(id: number, label: string): boolean {
  const res = db.prepare(
    `UPDATE fleet_snapshots SET label = ? WHERE id = ? AND deleted_at IS NULL`
  ).run(label, id)
  return res.changes > 0
}

// Soft-delete: stamp deleted_at so the row drops out of listings but survives for audit.
export function deleteSnapshot(id: number): void {
  db.prepare(`UPDATE fleet_snapshots SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL`).run(id)
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

export type AlertCalendarCell = {
  dow: number // 0=Sunday … 6=Saturday
  hour: number // 0–23
  alert_type: string
  count: number
}

/**
 * Alert counts bucketed by day-of-week × hour-of-day × alert_type since
 * `sinceTs` (unix seconds), for the Alert Calendar Heatmap (P190). Returned
 * disaggregated by type so the UI can show a per-cell breakdown; callers sum
 * across types for the cell intensity.
 */
export function getAlertCalendar(sinceTs: number): AlertCalendarCell[] {
  return db.prepare(
    `SELECT CAST(strftime('%w', ts, 'unixepoch', 'localtime') AS INTEGER) AS dow,
            CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER) AS hour,
            alert_type,
            COUNT(*) AS count
       FROM alert_events
      WHERE ts >= ?
      GROUP BY dow, hour, alert_type`
  ).all(sinceTs) as AlertCalendarCell[]
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

// ── Turn Annotations (P114) ───────────────────────────────────────────────

export type TurnAnnotationTag = 'note' | 'warning' | 'bug'

export type TurnAnnotationRow = {
  id: number
  slug: string
  session_file: string
  turn_index: number
  tag: TurnAnnotationTag
  note: string
  created_at: number
}

export function insertTurnAnnotation(
  slug: string,
  sessionFile: string,
  turnIndex: number,
  tag: TurnAnnotationTag,
  note: string
): number {
  const result = db.prepare(
    `INSERT INTO turn_annotations (slug, session_file, turn_index, tag, note) VALUES (?, ?, ?, ?, ?)`
  ).run(slug, sessionFile, turnIndex, tag, note.slice(0, 200))
  return result.lastInsertRowid as number
}

export function updateTurnAnnotation(id: number, tag: TurnAnnotationTag, note: string): void {
  db.prepare(
    `UPDATE turn_annotations SET tag = ?, note = ? WHERE id = ?`
  ).run(tag, note.slice(0, 200), id)
}

export function deleteTurnAnnotation(id: number): void {
  db.prepare(`DELETE FROM turn_annotations WHERE id = ?`).run(id)
}

export function getTurnAnnotations(opts: {
  slug?: string
  tag?: TurnAnnotationTag
  sessionFile?: string
  cursor?: number
  limit?: number
}): TurnAnnotationRow[] {
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.slug) { conditions.push('slug = ?'); params.push(opts.slug) }
  if (opts.tag) { conditions.push('tag = ?'); params.push(opts.tag) }
  if (opts.sessionFile) { conditions.push('session_file = ?'); params.push(opts.sessionFile) }
  if (opts.cursor != null) { conditions.push('id < ?'); params.push(opts.cursor) }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 200, 500)
  return db.prepare(
    `SELECT * FROM turn_annotations ${where} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit) as TurnAnnotationRow[]
}

export function getTurnAnnotationsForSession(slug: string, sessionFile: string): TurnAnnotationRow[] {
  return db.prepare(
    `SELECT * FROM turn_annotations WHERE slug = ? AND session_file = ? ORDER BY turn_index ASC`
  ).all(slug, sessionFile) as TurnAnnotationRow[]
}

// ── Convergence History (P120) ────────────────────────────────────────────

export type ConvergenceRow = {
  id: number
  slug: string
  date: string
  score: number
}

export function upsertConvergenceScore(slug: string, date: string, score: number): void {
  db.prepare(
    `INSERT INTO convergence_history (slug, date, score) VALUES (?, ?, ?)
     ON CONFLICT(slug, date) DO UPDATE SET score = excluded.score`
  ).run(slug, date, score)
}

export function getConvergenceHistory(slug: string, days = 7): ConvergenceRow[] {
  return db.prepare(
    `SELECT * FROM convergence_history WHERE slug = ? ORDER BY date DESC LIMIT ?`
  ).all(slug, days) as ConvergenceRow[]
}

export function getConvergenceScore(slug: string): number | null {
  const row = db.prepare(
    `SELECT score FROM convergence_history WHERE slug = ? ORDER BY date DESC LIMIT 1`
  ).get(slug) as { score: number } | undefined
  return row?.score ?? null
}

export type FleetConvergenceTrendRow = {
  date: string
  meanScore: number
  topBinCount: number
  projectCount: number
}

/**
 * Fleet-wide convergence aggregated by day for the most recent `days` dates
 * (P183). One row per date present in `convergence_history`: mean score across
 * all slugs and the count of slugs in the top bin (score ≥ 90). Returned
 * oldest→newest for direct charting.
 */
export function getFleetConvergenceTrend(days = 14): FleetConvergenceTrendRow[] {
  const rows = db.prepare(
    `SELECT date,
            AVG(score)                        AS meanScore,
            SUM(CASE WHEN score >= 90 THEN 1 ELSE 0 END) AS topBinCount,
            COUNT(*)                          AS projectCount
       FROM convergence_history
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?`
  ).all(days) as FleetConvergenceTrendRow[]
  return rows.reverse()
}

export type ConvergenceMoverRow = {
  slug: string
  prev: number | null
  curr: number
  delta: number | null
}

/**
 * Per-slug day-over-day convergence movement (P185). For each slug, the latest
 * `convergence_history` score is `curr`; the prior distinct-date score is
 * `prev`. `delta = curr - prev`, or null when the slug has only one entry.
 */
export function getConvergenceMovers(): ConvergenceMoverRow[] {
  const rows = db.prepare(
    `SELECT slug, date, score FROM convergence_history ORDER BY slug, date DESC`
  ).all() as { slug: string; date: string; score: number }[]
  const out: ConvergenceMoverRow[] = []
  let i = 0
  while (i < rows.length) {
    const slug = rows[i].slug
    const curr = rows[i].score
    const prev = i + 1 < rows.length && rows[i + 1].slug === slug ? rows[i + 1].score : null
    out.push({ slug, prev, curr, delta: prev == null ? null : curr - prev })
    // advance to next slug
    while (i < rows.length && rows[i].slug === slug) i++
  }
  return out
}

// ── Goal Advancement (P122) ───────────────────────────────────────────────

export type GoalAdvancementRow = {
  id: number
  slug: string
  date: string
  score: number
}

export function upsertGoalAdvancement(slug: string, date: string, score: number): void {
  db.prepare(
    `INSERT INTO goal_advancement (slug, date, score) VALUES (?, ?, ?)
     ON CONFLICT(slug, date) DO UPDATE SET score = excluded.score`
  ).run(slug, date, score)
}

export function getGoalAdvancementHistory(slug: string, days = 7): GoalAdvancementRow[] {
  return db.prepare(
    `SELECT * FROM goal_advancement WHERE slug = ? ORDER BY date DESC LIMIT ?`
  ).all(slug, days) as GoalAdvancementRow[]
}

export function getGoalAdvancementScore(slug: string): number | null {
  const row = db.prepare(
    `SELECT score FROM goal_advancement WHERE slug = ? ORDER BY date DESC LIMIT 1`
  ).get(slug) as { score: number } | undefined
  return row?.score ?? null
}

// Fleet-wide goal-advancement feed (P188). Each row carries the prior day's
// score for the same slug (via LAG) so the consumer can derive a from→to
// status transition. Newest first.
export type GoalStreamRow = {
  slug: string
  date: string
  score: number
  prevScore: number | null
}

export function getGoalAdvancementStream(limit = 200): GoalStreamRow[] {
  return db.prepare(
    `SELECT slug, date, score, prev_score AS prevScore FROM (
       SELECT slug, date, score,
         LAG(score) OVER (PARTITION BY slug ORDER BY date) AS prev_score
       FROM goal_advancement
     )
     ORDER BY date DESC, slug ASC
     LIMIT ?`
  ).all(limit) as GoalStreamRow[]
}

// ── Context Pressure (P123) ───────────────────────────────────────────────

export interface ContextPressureBreakdown {
  systemTokens: number
  historyTokens: number
  toolTokens: number
}

export interface ContextPressureRow {
  id: number
  slug: string
  ts: number
  score: number
  breakdown: string
}

export function upsertContextPressure(slug: string, score: number, breakdown: ContextPressureBreakdown): void {
  db.prepare(
    `INSERT INTO context_pressure (slug, score, breakdown) VALUES (?, ?, ?)`
  ).run(slug, score, JSON.stringify(breakdown))
}

export function getContextPressureHistory(slug: string, limit = 14): Array<{ ts: number; score: number }> {
  return db.prepare(
    `SELECT ts, score FROM context_pressure WHERE slug = ? ORDER BY ts DESC LIMIT ?`
  ).all(slug, limit) as Array<{ ts: number; score: number }>
}

export function getLatestContextPressure(slug: string): (ContextPressureRow & { parsedBreakdown: ContextPressureBreakdown }) | null {
  const row = db.prepare(
    `SELECT * FROM context_pressure WHERE slug = ? ORDER BY ts DESC LIMIT 1`
  ).get(slug) as ContextPressureRow | undefined
  if (!row) return null
  return { ...row, parsedBreakdown: JSON.parse(row.breakdown) as ContextPressureBreakdown }
}

// ── Digest Log (P128) ─────────────────────────────────────────────────────

export interface DigestRow {
  id: number
  ts: number
  project_count: number
  summary: string
  payload: string
}

export function insertDigest(projectCount: number, summary: string, payload: unknown): number {
  const result = db.prepare(
    `INSERT INTO digest_log (project_count, summary, payload) VALUES (?, ?, ?)`
  ).run(projectCount, summary, JSON.stringify(payload))
  return result.lastInsertRowid as number
}

export function getLatestDigest(): DigestRow | null {
  return db.prepare(`SELECT * FROM digest_log ORDER BY ts DESC LIMIT 1`).get() as DigestRow | null
}

export function getDigestHistory(limit = 30): DigestRow[] {
  return db.prepare(`SELECT * FROM digest_log ORDER BY ts DESC LIMIT ?`).all(limit) as DigestRow[]
}

// ── Turn Quality (P126) ───────────────────────────────────────────────────

export interface TurnQualityRow {
  id: number
  slug: string
  hour: string
  score: number
  turn_count: number
}

export function upsertTurnQuality(slug: string, hour: string, score: number, turnCount: number): void {
  db.prepare(
    `INSERT INTO turn_quality (slug, hour, score, turn_count) VALUES (?, ?, ?, ?)
     ON CONFLICT(slug, hour) DO UPDATE SET score = excluded.score, turn_count = excluded.turn_count`
  ).run(slug, hour, score, turnCount)
}

export function getTurnQuality(hours = 24): TurnQualityRow[] {
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 13)
  return db.prepare(
    `SELECT * FROM turn_quality WHERE hour >= ? ORDER BY hour ASC`
  ).all(cutoff) as TurnQualityRow[]
}

export interface MemoryDiffRow {
  id: number
  slug: string
  ts: number
  sha: string
  added: number
  removed: number
  diff_text: string
  cached_at: number
}

export function upsertMemoryDiff(slug: string, ts: number, sha: string, added: number, removed: number, diffText: string): void {
  db.prepare(
    `INSERT INTO memory_diff_log (slug, ts, sha, added, removed, diff_text) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug, sha) DO NOTHING`
  ).run(slug, ts, sha, added, removed, diffText)
}

export function getMemoryDiffs(slug?: string, since?: number): MemoryDiffRow[] {
  if (slug) {
    const cutoff = since ?? (Math.floor(Date.now() / 1000) - 7 * 86400)
    return db.prepare(
      `SELECT * FROM memory_diff_log WHERE slug = ? AND ts >= ? ORDER BY ts DESC`
    ).all(slug, cutoff) as MemoryDiffRow[]
  }
  const cutoff = since ?? (Math.floor(Date.now() / 1000) - 7 * 86400)
  return db.prepare(
    `SELECT * FROM memory_diff_log WHERE ts >= ? ORDER BY ts DESC`
  ).all(cutoff) as MemoryDiffRow[]
}

export function getMemoryDiffCacheAge(slug: string): number | null {
  const row = db.prepare(
    `SELECT MAX(cached_at) as last FROM memory_diff_log WHERE slug = ?`
  ).get(slug) as { last: number | null } | undefined
  return row?.last ?? null
}

export interface ConstellationCoord {
  slug: string
  x: number
  y: number
  z: number
  computed_at: number
}

export function upsertConstellationCoord(slug: string, x: number, y: number, z: number): void {
  db.prepare(
    `INSERT INTO constellation_coords (slug, x, y, z, computed_at) VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(slug) DO UPDATE SET x=excluded.x, y=excluded.y, z=excluded.z, computed_at=excluded.computed_at`
  ).run(slug, x, y, z)
}

export function getConstellationCoords(): ConstellationCoord[] {
  return db.prepare(`SELECT * FROM constellation_coords`).all() as ConstellationCoord[]
}

export default db;
