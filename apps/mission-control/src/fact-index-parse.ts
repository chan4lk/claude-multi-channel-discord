// ── Pure transcript-line parser (mission-control-perf-hardening) ──────────
//
// Turns raw transcript jsonl lines into fact rows for mc_turn / mc_tool_call.
// Pure and IO-free so it is unit-testable under plain `bun` — it lives in its
// own file (re-exported from ./fact-index) because ./fact-index imports ./db
// (better-sqlite3), a native module bun cannot load.
//
// Record shapes (verified against live transcripts under ~/.claude/projects/):
//   assistant     — { type: "assistant", timestamp: "ISO Z",
//                     message: { usage: { input_tokens, output_tokens },
//                                content: [{ type: "tool_use", name }, …] } }
//   turn_duration — { type: "system", subtype: "turn_duration",
//                     durationMs, timestamp }

export type TurnFact = {
  slug: string;
  sessionFile: string;
  tsMs: number;
  /** From the turn_duration system event that closes the turn; null when the
   * event has not been seen (mid-turn, or it falls in a later ingest batch). */
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
};

export type ToolCallFact = {
  slug: string;
  sessionFile: string;
  tsMs: number;
  toolName: string;
};

export type ParsedTranscript = {
  turns: TurnFact[];
  toolCalls: ToolCallFact[];
};

type TranscriptRecord = {
  type?: string;
  subtype?: string;
  timestamp?: string;
  durationMs?: number;
  message?: {
    usage?: { input_tokens?: number; output_tokens?: number };
    content?: Array<{ type?: string; name?: string }>;
  };
};

/**
 * Parse transcript jsonl lines into turn and tool-call facts. Pure — no IO.
 *
 * - One TurnFact per `assistant` record (mirrors the turn-heatmap route's
 *   per-assistant-record counting), carrying its usage token counts.
 * - A `type: "system", subtype: "turn_duration"` record attaches its
 *   `durationMs` to the most recent turn in this batch that has none yet;
 *   with no such turn (batch boundary split the turn) it is dropped.
 * - One ToolCallFact per `tool_use` content block, excluding `mcp__mcd__*`
 *   internal tools (same filter as sse.ts checkToolEvents).
 * - Lines that are blank, malformed JSON, or missing a parseable timestamp
 *   are skipped.
 */
export function parseTranscriptLines(
  slug: string,
  sessionFile: string,
  lines: string[]
): ParsedTranscript {
  const turns: TurnFact[] = [];
  const toolCalls: ToolCallFact[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let rec: TranscriptRecord;
    try {
      rec = JSON.parse(raw) as TranscriptRecord;
    } catch {
      continue;
    }
    if (rec === null || typeof rec !== "object") continue;

    if (rec.type === "system" && rec.subtype === "turn_duration") {
      if (typeof rec.durationMs !== "number") continue;
      // Attach to the newest turn still awaiting a duration.
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].durationMs === null) {
          turns[i].durationMs = rec.durationMs;
          break;
        }
      }
      continue;
    }

    if (rec.type !== "assistant") continue;
    const tsMs = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (Number.isNaN(tsMs)) continue;

    const usage = rec.message?.usage;
    turns.push({
      slug,
      sessionFile,
      tsMs,
      durationMs: null,
      inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
    });

    for (const block of rec.message?.content ?? []) {
      if (
        block &&
        block.type === "tool_use" &&
        block.name &&
        !block.name.startsWith("mcp__mcd__")
      ) {
        toolCalls.push({ slug, sessionFile, tsMs, toolName: block.name });
      }
    }
  }

  return { turns, toolCalls };
}
