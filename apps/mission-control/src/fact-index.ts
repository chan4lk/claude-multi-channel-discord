import db from "./db";
import os from "os";
import path from "path";
import { open, readdir, readFile, realpath } from "fs/promises";
import { parseTranscriptLines } from "./fact-index-parse";
import type { ToolCallFact, TurnFact } from "./fact-index-parse";

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

// ── Pure parser (re-exported) ─────────────────────────────────────────────
//
// parseTranscriptLines lives in ./fact-index-parse so its unit tests can run
// under plain `bun` — this module's ./db import (better-sqlite3, a native
// module) does not load in bun. Consumers import it from here.

export { parseTranscriptLines };
export type { TurnFact, ToolCallFact };
export type { ParsedTranscript } from "./fact-index-parse";

// ── Incremental ingester ──────────────────────────────────────────────────
//
// ingestOnce walks every project's transcript dir and ingests only the bytes
// past each file's persisted mc_ingest_state.byte_offset. The first run (no
// offsets) therefore backfills everything. Per file, new rows and the offset
// upsert commit in ONE transaction, so a crash mid-ingest never leaves rows
// counted without their offset advance (or vice versa).
//
// Partial-last-line rule: only complete lines (ending in \n) are parsed, and
// the offset only advances past the last \n — a partially-written trailing
// line is re-read on the next run.
//
// Truncation rule: when the file is now smaller than the stored offset (log
// rotation / rewrite), the file's prior mc_turn/mc_tool_call rows are DELETEd
// and it re-ingests from byte 0, keeping ingest idempotent under rotation.

const INGEST_CONCURRENCY = 8;

const selectOffsetStmt = db.prepare(
  `SELECT byte_offset FROM mc_ingest_state WHERE file = ?`
);
const upsertStateStmt = db.prepare(
  `INSERT INTO mc_ingest_state (file, slug, byte_offset, mtime_ms, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(file) DO UPDATE SET
     slug        = excluded.slug,
     byte_offset = excluded.byte_offset,
     mtime_ms    = excluded.mtime_ms,
     updated_at  = excluded.updated_at`
);
const insertTurnStmt = db.prepare(
  `INSERT INTO mc_turn (slug, session_file, ts_ms, duration_ms, input_tokens, output_tokens)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const insertToolCallStmt = db.prepare(
  `INSERT INTO mc_tool_call (slug, session_file, ts_ms, tool_name)
   VALUES (?, ?, ?, ?)`
);
const deleteTurnsStmt = db.prepare(`DELETE FROM mc_turn WHERE session_file = ?`);
const deleteToolCallsStmt = db.prepare(`DELETE FROM mc_tool_call WHERE session_file = ?`);

// One transaction per file: truncation cleanup + fact inserts + offset upsert
// commit atomically (better-sqlite3 transactions are synchronous).
const commitFileTx = db.transaction(
  (c: {
    file: string;
    slug: string;
    truncated: boolean;
    newOffset: number;
    mtimeMs: number;
    updatedAtSec: number;
    turns: TurnFact[];
    toolCalls: ToolCallFact[];
  }) => {
    if (c.truncated) {
      deleteTurnsStmt.run(c.file);
      deleteToolCallsStmt.run(c.file);
    }
    for (const t of c.turns) {
      insertTurnStmt.run(t.slug, t.sessionFile, t.tsMs, t.durationMs, t.inputTokens, t.outputTokens);
    }
    for (const tc of c.toolCalls) {
      insertToolCallStmt.run(tc.slug, tc.sessionFile, tc.tsMs, tc.toolName);
    }
    upsertStateStmt.run(c.file, c.slug, c.newOffset, c.mtimeMs, c.updatedAtSec);
  }
);

// Same encoding as fleet-compute.ts / sse.ts (private there): claude encodes
// the session cwd into the transcript dir name by replacing non-alphanumerics.
function encodeProjectCwd(realPath: string): string {
  return realPath.replace(/[^a-zA-Z0-9]/g, "-");
}

async function readChannelSlugs(mcdDir: string): Promise<string[]> {
  let parsed: { projects?: Record<string, { slug?: string }> };
  try {
    parsed = JSON.parse(await readFile(path.join(mcdDir, "channels.json"), "utf-8"));
  } catch {
    return [];
  }
  const slugs = new Set<string>();
  for (const proj of Object.values(parsed.projects ?? {})) {
    if (proj?.slug) slugs.add(proj.slug);
  }
  return [...slugs];
}

/** Transcript dir for a project slug — realpath the (possibly symlinked)
 * project dir before encoding (invariant from commit 7b99786: claude resolves
 * symlinks internally, so its transcript lands at the realpath-encoded dir). */
async function transcriptDirFor(mcdDir: string, slug: string): Promise<string | null> {
  const projectPath = path.join(mcdDir, "projects", slug);
  let realPath: string;
  try {
    realPath = await realpath(projectPath);
  } catch {
    return null;
  }
  return path.join(os.homedir(), ".claude", "projects", encodeProjectCwd(realPath));
}

/** Read bytes [offset, size) of an open file handle. May return fewer bytes
 * than requested if the file shrank mid-read; the complete-line boundary below
 * keeps that safe. */
async function readRange(
  fh: Awaited<ReturnType<typeof open>>,
  offset: number,
  length: number
): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await fh.read(buf, read, length - read, offset + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return read === length ? buf : buf.subarray(0, read);
}

type FileIngestResult = { turns: number; toolCalls: number; truncated: boolean };

async function ingestFile(
  slug: string,
  file: string,
  nowMs: number
): Promise<FileIngestResult | null> {
  const fh = await open(file, "r");
  try {
    const st = await fh.stat();
    const size = st.size;
    const prev = selectOffsetStmt.get(file) as { byte_offset: number } | undefined;
    let offset = prev?.byte_offset ?? 0;
    const truncated = size < offset;
    if (truncated) offset = 0;
    if (!truncated && size === offset) return null; // nothing new

    const buf = await readRange(fh, offset, size - offset);
    const lastNl = buf.lastIndexOf(0x0a);
    // No complete new line yet: nothing to commit — unless truncated, where the
    // row cleanup + offset reset must still land.
    if (lastNl === -1 && !truncated) return null;

    const lines = lastNl === -1 ? [] : buf.toString("utf-8", 0, lastNl + 1).split("\n");
    const { turns, toolCalls } = parseTranscriptLines(slug, file, lines);
    commitFileTx({
      file,
      slug,
      truncated,
      newOffset: offset + lastNl + 1, // lastNl === -1 → stays at offset
      mtimeMs: Math.round(st.mtimeMs),
      updatedAtSec: Math.floor(nowMs / 1000),
      turns,
      toolCalls,
    });
    return { turns: turns.length, toolCalls: toolCalls.length, truncated };
  } finally {
    await fh.close();
  }
}

async function forEachBounded<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

export type IngestResult = {
  /** True when another ingestOnce was already in flight and this call bailed. */
  skipped: boolean;
  /** Transcript files examined. */
  files: number;
  /** Files that committed new rows (or a truncation reset). */
  ingestedFiles: number;
  turns: number;
  toolCalls: number;
  truncations: number;
};

// Module-level in-flight guard: overlapping ingestOnce calls (slow tick still
// running when the next fires) return early instead of racing on offsets.
let ingestInFlight = false;

/**
 * One incremental ingest pass over every project's transcripts. Reads
 * channels.json under `mcdDir` for the slug list, resolves each project's
 * transcript dir, and ingests new complete lines from each `.jsonl` with
 * bounded concurrency (file IO is fs/promises; DB commits are synchronous,
 * one transaction per file). Per-file errors are logged and never abort the
 * pass. `now` is injectable for tests (unix ms clock).
 */
export async function ingestOnce(
  mcdDir: string,
  opts: { now?: () => number } = {}
): Promise<IngestResult> {
  const result: IngestResult = {
    skipped: false,
    files: 0,
    ingestedFiles: 0,
    turns: 0,
    toolCalls: 0,
    truncations: 0,
  };
  if (ingestInFlight) return { ...result, skipped: true };
  ingestInFlight = true;
  try {
    const now = opts.now ?? Date.now;
    const targets: Array<{ slug: string; file: string }> = [];
    const seen = new Set<string>(); // two slugs symlinked to one repo share a dir
    for (const slug of await readChannelSlugs(mcdDir)) {
      const dir = await transcriptDirFor(mcdDir, slug);
      if (!dir) continue;
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue; // empty / missing transcript dir: skip the project
      }
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const file = path.join(dir, name);
        if (seen.has(file)) continue;
        seen.add(file);
        targets.push({ slug, file });
      }
    }
    result.files = targets.length;
    await forEachBounded(targets, INGEST_CONCURRENCY, async ({ slug, file }) => {
      try {
        const r = await ingestFile(slug, file, now());
        if (r) {
          result.ingestedFiles++;
          result.turns += r.turns;
          result.toolCalls += r.toolCalls;
          if (r.truncated) result.truncations++;
        }
      } catch (err) {
        console.error(`[fact-index] ingest failed for ${file}:`, err);
      }
    });
    return result;
  } finally {
    ingestInFlight = false;
  }
}

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
