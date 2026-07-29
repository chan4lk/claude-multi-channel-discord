/**
 * bun apps/mission-control/src/fact-index.test.ts
 * Unit tests for parseTranscriptLines (fact-index pure parser).
 *
 * Imports from ./fact-index-parse (not ./fact-index) because ./fact-index
 * imports ./db → better-sqlite3, a native module bun cannot load.
 *
 * Ingester tests (resume/idempotency/truncation/parity) need better-sqlite3
 * and therefore run under Node — see ./fact-index-ingest.test.ts for those
 * and its run command.
 */
import { parseTranscriptLines } from "./fact-index-parse.ts";

let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  const status = cond ? "PASS" : "FAIL";
  console.log(`${status}  ${label}${cond ? "" : `  -- ${detail ?? ""}`}`);
  if (!cond) failed++;
}

// Fixture builders mirroring live transcript record shapes.
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

// ---------------------------------------------------------------------------
// Correct extraction — turns
// ---------------------------------------------------------------------------
{
  const { turns, toolCalls } = parseTranscriptLines("proj-a", "/t/s1.jsonl", [
    JSON.stringify({ type: "user", timestamp: "2026-07-29T10:00:00.000Z", message: { role: "user" } }),
    assistantLine({ ts: "2026-07-29T10:00:05.000Z", input: 100, output: 20 }),
    assistantLine({ ts: "2026-07-29T10:00:10.000Z", input: 200, output: 40 }),
    turnDurationLine("2026-07-29T10:00:12.000Z", 7000),
  ]);
  check("turn-1: two assistant records → two turns", turns.length === 2, `got ${turns.length}`);
  check("turn-2: ts_ms from timestamp", turns[0].tsMs === Date.parse("2026-07-29T10:00:05.000Z"));
  check("turn-3: tokens from message.usage", turns[0].inputTokens === 100 && turns[0].outputTokens === 20);
  check("turn-4: second turn tokens", turns[1].inputTokens === 200 && turns[1].outputTokens === 40);
  check(
    "turn-5: turn_duration attaches to newest undurationed turn",
    turns[1].durationMs === 7000,
    `got ${turns[1].durationMs}`
  );
  check("turn-6: earlier turn keeps null duration", turns[0].durationMs === null);
  check("turn-7: slug/sessionFile stamped on rows", turns[0].slug === "proj-a" && turns[0].sessionFile === "/t/s1.jsonl");
  check("turn-8: text-only content → no tool calls", toolCalls.length === 0);
}

// Two full turns, each closed by its own turn_duration
{
  const { turns } = parseTranscriptLines("p", "f", [
    assistantLine({ ts: "2026-07-29T10:00:00.000Z" }),
    turnDurationLine("2026-07-29T10:00:03.000Z", 3000),
    assistantLine({ ts: "2026-07-29T10:01:00.000Z" }),
    turnDurationLine("2026-07-29T10:01:09.000Z", 9000),
  ]);
  check(
    "turn-9: per-turn durations attach in order",
    turns.length === 2 && turns[0].durationMs === 3000 && turns[1].durationMs === 9000,
    JSON.stringify(turns.map((t) => t.durationMs))
  );
}

// turn_duration with no preceding assistant record in batch → dropped
{
  const { turns } = parseTranscriptLines("p", "f", [turnDurationLine("2026-07-29T10:00:00.000Z", 5000)]);
  check("turn-10: orphan turn_duration dropped (no fabricated turn)", turns.length === 0, `got ${turns.length}`);
}

// turn_duration with non-numeric durationMs → ignored
{
  const { turns } = parseTranscriptLines("p", "f", [
    assistantLine({ ts: "2026-07-29T10:00:00.000Z" }),
    JSON.stringify({ type: "system", subtype: "turn_duration", durationMs: "oops" }),
  ]);
  check("turn-11: non-numeric durationMs ignored", turns.length === 1 && turns[0].durationMs === null);
}

// Missing usage → tokens default to 0
{
  const { turns } = parseTranscriptLines("p", "f", [
    JSON.stringify({ type: "assistant", timestamp: "2026-07-29T10:00:00.000Z", message: { content: [] } }),
  ]);
  check("turn-12: missing usage → zero tokens", turns.length === 1 && turns[0].inputTokens === 0 && turns[0].outputTokens === 0);
}

// ---------------------------------------------------------------------------
// Correct extraction — tool calls
// ---------------------------------------------------------------------------
{
  const { toolCalls } = parseTranscriptLines("proj-b", "/t/s2.jsonl", [
    assistantLine({
      ts: "2026-07-29T11:00:00.000Z",
      blocks: [
        { type: "tool_use", name: "Read" },
        { type: "tool_use", name: "Bash" },
        { type: "text" },
      ],
    }),
    assistantLine({
      ts: "2026-07-29T11:00:05.000Z",
      blocks: [{ type: "tool_use", name: "mcp__mcd__reply" }],
    }),
  ]);
  check("tool-1: one fact per tool_use block", toolCalls.length === 2, `got ${toolCalls.length}`);
  check("tool-2: tool names extracted", toolCalls[0].toolName === "Read" && toolCalls[1].toolName === "Bash");
  check("tool-3: mcp__mcd__* excluded", toolCalls.every((t) => !t.toolName.startsWith("mcp__mcd__")));
  check(
    "tool-4: tool call ts/slug/sessionFile from parent record",
    toolCalls[0].tsMs === Date.parse("2026-07-29T11:00:00.000Z") &&
      toolCalls[0].slug === "proj-b" &&
      toolCalls[0].sessionFile === "/t/s2.jsonl"
  );
}

// tool_use block without a name → skipped
{
  const { toolCalls } = parseTranscriptLines("p", "f", [
    assistantLine({ ts: "2026-07-29T11:00:00.000Z", blocks: [{ type: "tool_use" }] }),
  ]);
  check("tool-5: nameless tool_use block skipped", toolCalls.length === 0);
}

// ---------------------------------------------------------------------------
// Malformed-line skip
// ---------------------------------------------------------------------------
{
  const { turns, toolCalls } = parseTranscriptLines("p", "f", [
    "not json at all {{{",
    "",
    "   ",
    "null",
    '"just a string"',
    "42",
    JSON.stringify({ type: "assistant" }), // no timestamp
    JSON.stringify({ type: "assistant", timestamp: "not-a-date" }),
    assistantLine({ ts: "2026-07-29T12:00:00.000Z", input: 1, output: 2 }),
    JSON.stringify({ type: "file-history-snapshot" }),
    JSON.stringify({ type: "system", subtype: "other" }),
  ]);
  check("mal-1: malformed/irrelevant lines skipped, good line kept", turns.length === 1, `got ${turns.length}`);
  check("mal-2: kept turn parsed correctly", turns[0].inputTokens === 1 && turns[0].outputTokens === 2);
  check("mal-3: no tool calls from malformed input", toolCalls.length === 0);
}

// ---------------------------------------------------------------------------
// Empty input
// ---------------------------------------------------------------------------
{
  const { turns, toolCalls } = parseTranscriptLines("p", "f", []);
  check("empty-1: empty lines → empty turns", turns.length === 0);
  check("empty-2: empty lines → empty toolCalls", toolCalls.length === 0);
}

// ---------------------------------------------------------------------------
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log(`\nAll 22 checks passed.`);
}
