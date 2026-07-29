import db from "./db";

// ── Fact index (mission-control-perf-hardening) ───────────────────────────
//
// Granular fact tables fed by the incremental transcript ingester: one row
// per assistant turn (mc_turn) and one per tool call (mc_tool_call), plus a
// per-file byte-offset table (mc_ingest_state) so ingest only ever reads past
// the last byte it has seen. Created idempotently against the src/db.ts
// singleton, so MC_DB_PATH is honored and WAL is already on.

db.exec(`
CREATE TABLE IF NOT EXISTS mc_turn (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  session_file TEXT NOT NULL,
  ts_ms        INTEGER NOT NULL,
  duration_ms  INTEGER,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mc_turn_slug_ts ON mc_turn(slug, ts_ms);

CREATE TABLE IF NOT EXISTS mc_tool_call (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL,
  session_file TEXT NOT NULL,
  ts_ms        INTEGER NOT NULL,
  tool_name    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mc_tool_slug_ts   ON mc_tool_call(slug, ts_ms);
CREATE INDEX IF NOT EXISTS idx_mc_tool_slug_name ON mc_tool_call(slug, tool_name);

CREATE TABLE IF NOT EXISTS mc_ingest_state (
  file        TEXT PRIMARY KEY,   -- absolute transcript path
  slug        TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  mtime_ms    INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

// ── Query helpers ─────────────────────────────────────────────────────────

export type ToolCountRow = {
  slug: string;
  tool_name: string;
  count: number;
};

/**
 * Tool-call counts grouped by (slug, tool_name) since `sinceMs` (unix ms).
 * Powers the tool-heatmap route and the capability map — callers pivot the
 * rows into their matrix/blocks shape.
 */
export function toolCounts(opts: { sinceMs: number }): ToolCountRow[] {
  return db
    .prepare(
      `SELECT slug, tool_name, COUNT(*) AS count
         FROM mc_tool_call
        WHERE ts_ms >= ?
        GROUP BY slug, tool_name`
    )
    .all(opts.sinceMs) as ToolCountRow[];
}

export type TurnDurationRow = {
  slug: string;
  duration_ms: number;
};

/**
 * Per-turn durations since `sinceMs` (unix ms), optionally filtered to one
 * slug. Rows without a recorded duration are excluded. Percentiles and
 * histogram bucketing are computed by the caller (turn-duration route).
 */
export function turnDurations(opts: { slug?: string; sinceMs: number }): TurnDurationRow[] {
  if (opts.slug) {
    return db
      .prepare(
        `SELECT slug, duration_ms
           FROM mc_turn
          WHERE slug = ? AND ts_ms >= ? AND duration_ms IS NOT NULL
          ORDER BY ts_ms ASC`
      )
      .all(opts.slug, opts.sinceMs) as TurnDurationRow[];
  }
  return db
    .prepare(
      `SELECT slug, duration_ms
         FROM mc_turn
        WHERE ts_ms >= ? AND duration_ms IS NOT NULL
        ORDER BY slug ASC, ts_ms ASC`
    )
    .all(opts.sinceMs) as TurnDurationRow[];
}

export type TurnHourDowBucket = {
  slug: string;
  dow: number; // 0=Sunday … 6=Saturday, UTC (strftime %w)
  hour: number; // 0–23, UTC
  count: number;
};

/**
 * Turn counts bucketed by (slug, UTC day-of-week, UTC hour-of-day) since
 * `sinceMs` (unix ms), for the turn-heatmap route. UTC matches the previous
 * transcript-scan bucketing (getUTCDay/getUTCHours); the route converts the
 * Sunday-based `dow` to its Monday-based grid.
 */
export function turnHourDowBuckets(opts: { sinceMs: number }): TurnHourDowBucket[] {
  return db
    .prepare(
      `SELECT slug,
              CAST(strftime('%w', ts_ms / 1000, 'unixepoch') AS INTEGER) AS dow,
              CAST(strftime('%H', ts_ms / 1000, 'unixepoch') AS INTEGER) AS hour,
              COUNT(*) AS count
         FROM mc_turn
        WHERE ts_ms >= ?
        GROUP BY slug, dow, hour`
    )
    .all(opts.sinceMs) as TurnHourDowBucket[];
}

export type MonthlyTokenTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * Token totals for one slug in a calendar month (`yearMonth` = "YYYY-MM",
 * UTC — transcript timestamps are ISO Z, so this matches the previous
 * `ts.startsWith(yearMonth)` scan). Replaces `computeMonthlyTokensUsed`'s
 * full-transcript read. Invalid `yearMonth` yields zeros.
 */
export function monthlyTokens(opts: { slug: string; yearMonth: string }): MonthlyTokenTotals {
  const m = /^(\d{4})-(\d{2})$/.exec(opts.yearMonth);
  if (!m) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const startMs = Date.UTC(year, month - 1, 1);
  const endMs = Date.UTC(year, month, 1);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0)  AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM mc_turn
        WHERE slug = ? AND ts_ms >= ? AND ts_ms < ?`
    )
    .get(opts.slug, startMs, endMs) as { inputTokens: number; outputTokens: number };
  return {
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.inputTokens + row.outputTokens,
  };
}
