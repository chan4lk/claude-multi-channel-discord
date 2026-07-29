/**
 * Ingester tests for fact-index: resume, idempotency, truncation, parity
 * (AC5 / AC6 / rotation / AC2).
 *
 * Run from apps/mission-control with ONE command:
 *
 *   npx tsc src/fact-index-ingest.test.ts --outDir /tmp/mc-fact-index-test --module commonjs --moduleResolution node --target es2022 --esModuleInterop --skipLibCheck && NODE_PATH="$PWD/node_modules" node /tmp/mc-fact-index-test/fact-index-ingest.test.js
 *
 * Runs under Node, NOT bun: ./fact-index imports ./db → better-sqlite3, a
 * native module bun cannot load (the bun process dies silently at require).
 * The pure-parser tests stay bun-runnable in fact-index.test.ts.
 *
 * Setup: temp dir with a fake MCD channels dir (channels.json + project dirs,
 * one of them a symlink to exercise the realpath-encoding invariant), fake
 * $HOME so ~/.claude/projects/<encoded> resolves inside the temp dir, and a
 * temp MC_DB_PATH. Env is set BEFORE ./fact-index loads (dynamic import).
 */
import fs from "fs";
import os from "os";
import path from "path";

// ── Env + fixture layout (must precede the ./fact-index import) ────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-fact-index-"));
const fakeHome = path.join(tmpRoot, "home");
const mcdDir = path.join(tmpRoot, "mcd");
process.env.MC_DB_PATH = path.join(tmpRoot, "mc.db");
process.env.HOME = fakeHome; // os.homedir() reads $HOME at call time

const alphaProjectDir = path.join(mcdDir, "projects", "alpha");
const realRepo = path.join(tmpRoot, "real-repo"); // beta symlinks here
const betaProjectDir = path.join(mcdDir, "projects", "beta");

fs.mkdirSync(alphaProjectDir, { recursive: true });
fs.mkdirSync(realRepo, { recursive: true });
fs.symlinkSync(realRepo, betaProjectDir);
fs.mkdirSync(fakeHome, { recursive: true });
fs.writeFileSync(
  path.join(mcdDir, "channels.json"),
  JSON.stringify({ projects: { "111": { slug: "alpha" }, "222": { slug: "beta" } } })
);

// Same cwd encoding as fact-index.ts (claude realpaths symlinked project dirs
// before encoding — invariant from commit 7b99786).
function transcriptDirFor(projectDir: string): string {
  const encoded = fs.realpathSync(projectDir).replace(/[^a-zA-Z0-9]/g, "-");
  return path.join(fakeHome, ".claude", "projects", encoded);
}

const alphaDir = transcriptDirFor(alphaProjectDir);
const betaDir = transcriptDirFor(betaProjectDir); // realpath of the symlink target
fs.mkdirSync(alphaDir, { recursive: true });
fs.mkdirSync(betaDir, { recursive: true });

const alphaS1 = path.join(alphaDir, "s1.jsonl");
const betaS1 = path.join(betaDir, "s1.jsonl");

// ── PASS/FAIL harness (same style as fact-index.test.ts) ───────────────────

let failed = 0;
let checks = 0;
function check(label: string, cond: boolean, detail?: string) {
  checks++;
  const status = cond ? "PASS" : "FAIL";
  console.log(`${status}  ${label}${cond ? "" : `  -- ${detail ?? ""}`}`);
  if (!cond) failed++;
}

// ── Fixture builders mirroring live transcript record shapes ───────────────

function assistantLine(opts: {
  ts: string;
  input?: number;
  output?: number;
  blocks?: Array<{ type?: string; name?: string }>;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: opts.ts,
    message: {
      role: "assistant",
      usage: { input_tokens: opts.input ?? 0, output_tokens: opts.output ?? 0 },
      content: opts.blocks ?? [{ type: "text", text: "hi" }],
    },
  });
}

function turnDurationLine(ts: string, durationMs: number): string {
  return JSON.stringify({ type: "system", subtype: "turn_duration", durationMs, timestamp: ts });
}

/**
 * Direct transcript scan for the AC2 parity check — deliberately independent
 * of parseTranscriptLines. Mirrors sse.ts checkToolEvents (assistant records,
 * tool_use content blocks, mcp__mcd__* excluded) plus the heatmap routes'
 * time window. Returns "slug|tool" → count.
 */
function directToolCounts(
  files: Array<{ slug: string; file: string }>,
  sinceMs: number
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { slug, file } of files) {
    const lines = fs.readFileSync(file, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      let rec: {
        type?: string;
        timestamp?: string;
        message?: { content?: Array<{ type?: string; name?: string }> };
      };
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec?.type !== "assistant") continue;
      const ts = Date.parse(rec.timestamp ?? "");
      if (Number.isNaN(ts) || ts < sinceMs) continue;
      for (const block of rec.message?.content ?? []) {
        if (block?.type === "tool_use" && block.name && !block.name.startsWith("mcp__mcd__")) {
          const key = `${slug}|${block.name}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/** Direct token sums per slug for one UTC calendar month ("YYYY-MM"). */
function directMonthTokens(
  files: Array<{ slug: string; file: string }>,
  slug: string,
  yearMonth: string
): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const f of files) {
    if (f.slug !== slug) continue;
    const lines = fs.readFileSync(f.file, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      let rec: {
        type?: string;
        timestamp?: string;
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      };
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec?.type !== "assistant") continue;
      if (!rec.timestamp?.startsWith(yearMonth)) continue;
      inputTokens += rec.message?.usage?.input_tokens ?? 0;
      outputTokens += rec.message?.usage?.output_tokens ?? 0;
    }
  }
  return { inputTokens, outputTokens };
}

// ── Tests ───────────────────────────────────────────────────────────────────

async function main() {
  // Dynamic imports so MC_DB_PATH/HOME above are set before ./db loads.
  const { ingestOnce, toolCounts, monthlyTokens } = await import("./fact-index");
  const db = (await import("./db")).default;

  const countTurns = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM mc_turn").get() as { n: number }).n;
  const countToolCalls = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM mc_tool_call").get() as { n: number }).n;
  const toolCallsFor = (sessionFile: string) =>
    (db
      .prepare("SELECT COUNT(*) AS n FROM mc_tool_call WHERE session_file = ?")
      .get(sessionFile) as { n: number }).n;
  const turnsFor = (sessionFile: string) =>
    (db
      .prepare("SELECT COUNT(*) AS n FROM mc_turn WHERE session_file = ?")
      .get(sessionFile) as { n: number }).n;
  const toolNameCount = (slug: string, tool: string) =>
    (db
      .prepare("SELECT COUNT(*) AS n FROM mc_tool_call WHERE slug = ? AND tool_name = ?")
      .get(slug, tool) as { n: number }).n;

  // Initial fixtures.
  // alpha/s1: 2 turns, tools Read+Bash+Grep (mcp__mcd__reply excluded).
  fs.writeFileSync(
    alphaS1,
    [
      assistantLine({
        ts: "2026-07-29T10:00:05.000Z",
        input: 100,
        output: 20,
        blocks: [
          { type: "tool_use", name: "Read" },
          { type: "tool_use", name: "Bash" },
          { type: "tool_use", name: "mcp__mcd__reply" },
          { type: "text" },
        ],
      }),
      assistantLine({
        ts: "2026-07-29T10:00:10.000Z",
        input: 200,
        output: 40,
        blocks: [{ type: "tool_use", name: "Grep" }],
      }),
      turnDurationLine("2026-07-29T10:00:12.000Z", 7000),
      "", // trailing newline
    ].join("\n")
  );
  // beta/s1 (symlinked project): 3 turns, 3× Edit — big enough that the later
  // rotation rewrite is strictly smaller than the stored offset.
  fs.writeFileSync(
    betaS1,
    [
      assistantLine({ ts: "2026-07-29T09:00:00.000Z", input: 10, output: 5, blocks: [{ type: "tool_use", name: "Edit" }] }),
      assistantLine({ ts: "2026-07-29T09:01:00.000Z", input: 11, output: 6, blocks: [{ type: "tool_use", name: "Edit" }] }),
      assistantLine({ ts: "2026-07-29T09:02:00.000Z", input: 12, output: 7, blocks: [{ type: "tool_use", name: "Edit" }] }),
      "",
    ].join("\n")
  );

  // ── Backfill (first run, empty offsets) ─────────────────────────────────
  {
    const r = await ingestOnce(mcdDir);
    check("backfill-1: not skipped", r.skipped === false);
    check("backfill-2: both transcript files examined", r.files === 2, `got ${r.files}`);
    check("backfill-3: turns ingested (2 alpha + 3 beta)", r.turns === 5, `got ${r.turns}`);
    check("backfill-4: tool calls ingested, mcp__mcd__* excluded", r.toolCalls === 6, `got ${r.toolCalls}`);
    check("backfill-5: mc_turn row count", countTurns() === 5, `got ${countTurns()}`);
    check("backfill-6: mc_tool_call row count", countToolCalls() === 6, `got ${countToolCalls()}`);
    check(
      "backfill-7: symlinked project ingested via realpath-encoded dir",
      turnsFor(betaS1) === 3 && toolNameCount("beta", "Edit") === 3,
      `turns=${turnsFor(betaS1)} edits=${toolNameCount("beta", "Edit")}`
    );
  }

  // ── AC5: idempotency — double-run leaves counts stable ──────────────────
  {
    const before = { turns: countTurns(), toolCalls: countToolCalls() };
    const r = await ingestOnce(mcdDir);
    check("idem-1: second run ingests nothing", r.ingestedFiles === 0 && r.turns === 0 && r.toolCalls === 0, JSON.stringify(r));
    check("idem-2: mc_turn count unchanged", countTurns() === before.turns, `got ${countTurns()}`);
    check("idem-3: mc_tool_call count unchanged", countToolCalls() === before.toolCalls, `got ${countToolCalls()}`);
  }

  // ── AC6: resume — appended lines ingested on next run ───────────────────
  {
    fs.appendFileSync(
      alphaS1,
      assistantLine({
        ts: "2026-07-29T10:05:00.000Z",
        input: 50,
        output: 9,
        blocks: [{ type: "tool_use", name: "Write" }],
      }) + "\n"
    );
    const r = await ingestOnce(mcdDir);
    check("resume-1: only the appended turn ingested", r.turns === 1 && r.toolCalls === 1, JSON.stringify(r));
    check("resume-2: totals advanced by exactly the delta", countTurns() === 6 && countToolCalls() === 7, `turns=${countTurns()} tools=${countToolCalls()}`);
    check("resume-3: new tool call queryable", toolNameCount("alpha", "Write") === 1);
    check("resume-4: prior rows not re-ingested (Read still 1)", toolNameCount("alpha", "Read") === 1, `got ${toolNameCount("alpha", "Read")}`);
  }

  // ── Partial trailing line: not counted until the newline lands ──────────
  {
    const full =
      assistantLine({ ts: "2026-07-29T10:06:00.000Z", input: 7, output: 3 }) + "\n";
    const cut = Math.floor(full.length / 2);
    fs.appendFileSync(alphaS1, full.slice(0, cut)); // no newline yet
    const r1 = await ingestOnce(mcdDir);
    check("partial-1: incomplete trailing line not ingested", r1.turns === 0 && r1.ingestedFiles === 0, JSON.stringify(r1));
    fs.appendFileSync(alphaS1, full.slice(cut)); // complete the line
    const r2 = await ingestOnce(mcdDir);
    check("partial-2: completed line ingested exactly once", r2.turns === 1, `got ${r2.turns}`);
    check("partial-3: turn total reflects single ingest", countTurns() === 7, `got ${countTurns()}`);
  }

  // ── Truncation / rotation: no double-count ───────────────────────────────
  {
    // Rewrite beta/s1 smaller than its stored offset (rotation): prior rows
    // for that session_file must be deleted before re-ingest.
    fs.writeFileSync(
      betaS1,
      assistantLine({ ts: "2026-07-29T12:00:00.000Z", input: 1, output: 1, blocks: [{ type: "tool_use", name: "Glob" }] }) + "\n"
    );
    const r = await ingestOnce(mcdDir);
    check("trunc-1: truncation detected", r.truncations === 1, `got ${r.truncations}`);
    check("trunc-2: rotated file has only the new rows", turnsFor(betaS1) === 1 && toolCallsFor(betaS1) === 1, `turns=${turnsFor(betaS1)} tools=${toolCallsFor(betaS1)}`);
    check("trunc-3: pre-rotation rows deleted (Edit gone)", toolNameCount("beta", "Edit") === 0, `got ${toolNameCount("beta", "Edit")}`);
    check("trunc-4: totals have no doubles", countTurns() === 5 && countToolCalls() === 5, `turns=${countTurns()} tools=${countToolCalls()}`);
    const r2 = await ingestOnce(mcdDir);
    check("trunc-5: idempotent after rotation", r2.turns === 0 && r2.toolCalls === 0 && countTurns() === 5, JSON.stringify(r2));
  }

  // ── AC2: parity — index tool counts == direct transcript scan ───────────
  {
    const files = [
      { slug: "alpha", file: alphaS1 },
      { slug: "beta", file: betaS1 },
    ];
    const windows = [
      { label: "all-time", sinceMs: 0 },
      // Mid-window cutoff: excludes nothing ≥ 10:00 but proves ts filtering.
      { label: "since-10:00Z", sinceMs: Date.parse("2026-07-29T10:00:00.000Z") },
      // Future cutoff: both sides must agree on empty.
      { label: "since-13:00Z", sinceMs: Date.parse("2026-07-29T13:00:00.000Z") },
    ];
    for (const w of windows) {
      const expected = directToolCounts(files, w.sinceMs);
      const actual = new Map(
        toolCounts({ sinceMs: w.sinceMs }).map((r) => [`${r.slug}|${r.tool_name}`, r.count])
      );
      let match = expected.size === actual.size;
      for (const [k, v] of expected) if (actual.get(k) !== v) match = false;
      check(
        `parity-${w.label}: index == direct scan`,
        match,
        `expected=${JSON.stringify([...expected])} actual=${JSON.stringify([...actual])}`
      );
    }
    // Token parity (AC2: tokens exact) — monthlyTokens vs direct scan.
    for (const slug of ["alpha", "beta"]) {
      const expected = directMonthTokens(files, slug, "2026-07");
      const actual = monthlyTokens({ slug, yearMonth: "2026-07" });
      check(
        `parity-tokens-${slug}: monthly tokens exact`,
        actual.inputTokens === expected.inputTokens &&
          actual.outputTokens === expected.outputTokens &&
          actual.totalTokens === expected.inputTokens + expected.outputTokens,
        `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
      );
    }
  }

  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log(`\nAll ${checks} checks passed.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
