# Verify Report: org-graph-view

**Verdict:** PASS

## Acceptance Criteria

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — mutual `↔` peer edge / one-way with warning marker | Met | `src/org-graph.test.ts:55-65` — `AC1: mutual edge marked mutual`, `AC1: text marks one-way` (`one-way — no consent back`); builder logic `src/org-graph.ts:184-190`; all 5 AC1 checks PASS |
| AC2 — `--reviewer-->` edge for live slug; `(stale)` + `⚠` for deleted slug | Met | `src/org-graph.test.ts:77-88` — `AC2: stale role edge marked stale`, `AC2: stale warning line present`; builder `src/org-graph.ts:213-218`; 6 AC2 checks PASS |
| AC3 — `⚠` line naming project + dead role(s) when `handoff` flag false | Met | `src/org-graph.ts:205-210` (`collab role(s) configured but handoff flag off — <roles> can never fire`); `src/org-graph.test.ts:99-109` — 3 AC3 checks PASS; end-to-end check `graph: dead-edge warning (handoff off)` in `src/master-commands.test.ts:2033` |
| AC4 — `bot:123` node + edge from `botPeers.allow` | Met | `src/org-graph.ts:193-201`; `src/org-graph.test.ts:122-126` — single node for shared id, two edges, text `⇢ bot:<id> (bot peer)`; 4 AC4 checks PASS |
| AC5 — `⛔` disabled (never hidden), `🤖` autopilot, `🛰` hermes | Met | `src/org-graph.ts:157-159, 257-264`; `src/org-graph.test.ts:140-144` — `AC5: disabled node present`, `AC5: text shows ⛔ 🤖 🛰`; 4 AC5 checks PASS |
| AC6 — `⏰` self-loop with cadence for enabled schedule; paused omitted | Met | `src/org-graph.ts:123-124` filters `s.enabled`; `src/org-graph.test.ts:164-168` — daily/interval/cron cadences rendered, `AC6: paused schedule omitted`; 5 AC6 checks PASS |
| AC7 — `--stats`: `N open` per pending-handoff pair, `idle <age>`, warm/cold from injected deps | Met | `src/org-graph.ts:228-241` (pending-only count), `126-132` (warm/idle); `src/org-graph.test.ts:191` `AC7: pending handoffs counted on edge` (10 AC7 checks PASS); integration `graph --stats: idle age rendered` / `open handoff count on edge` (`src/master-commands.test.ts:2040-2042`) |
| AC8 — Mermaid fence, `graph LR`, sanitized node ids, labels keep slug | Met | `src/org-graph.ts:83-98` (id allocator: `[A-Za-z0-9_]`, letter-prefix, collision suffix), `315-337` (renderer); 8 AC8 checks PASS incl. `AC8: all node ids sanitized`, `AC8: label keeps raw slug`, `AC8: stale edge dotted` |
| AC9 — all suites pass, org-graph tests pass, tsc clean | Met | Ran locally: 9 suites, 988 PASS / 0 FAIL (`org-graph: 52 PASS`, `master-commands: 259 PASS`, `project-pool: 88`, `master-mcp-server: 161`, `bot-peers: 58`, `shared-learnings: 24`, `backlog: 95`, `scheduler: 170`, `handoffs: 81`); `bun tsc --noEmit` exit 0 |
| AC10 — `help` lists verb; zero writes in handler path | Met | Help line `src/master-commands.ts:259`; `handleGraph` (`src/master-commands.ts:2447-2489`) calls only `loadConfig` + read-only injected loaders + `poolStats` — no `saveConfig`, no `--yes` gate; test checks `help: mentions graph verb` and `graph: performs zero config writes` (`src/master-commands.test.ts:2059, 2062`) PASS |

## Non-Functional Requirements

- **NFR1 (pure builder):** Met — `src/org-graph.ts` is IO-free (all inputs via `GraphInputs`); IO lives in `handleGraph` with injectable deps (`ctx.loadHandoffRegistry`, `ctx.loadSchedulesFn`, `ctx.transcriptMtimeFn`, `ctx.mutator.poolStats`), matching context.md's "Injectable side effects" pattern.
- **NFR2 (Discord-size aware):** Met — no special handling added; output flows through the existing `discord-chunk.ts` reply path as specified.
- **NFR3 (fail-soft stats):** Met — each source wrapped in `try/catch` (`src/master-commands.ts:2457-2480`); test `graph: broken sources degrade, verb still replies` PASSes; `warm: null` omits the warm/cold column (`src/org-graph.ts:127`, text renderer line 282).
- **NFR4 (tests):** Met — `src/org-graph.test.ts` is a plain bun script with PASS/FAIL check lines, 52 checks covering builder + both renderers, per project convention (context.md: "no test framework").

## Test/Lint/Build Gates

- **Payload gates:** unusable — the verification payload recorded "No changed files found" plus the apps/mission-control Next.js build log only. Verdict rests on direct local re-runs.
- **Re-run locally (authoritative):**
  - `bun src/org-graph.test.ts` — PASS (52/52, "All org-graph checks passed.")
  - All 9 suites (`master-commands`, `project-pool`, `master-mcp-server`, `bot-peers`, `shared-learnings`, `backlog`, `scheduler`, `handoffs`, `org-graph`) — exit 0, 988 PASS / 0 FAIL total
  - `bun tsc --noEmit` — exit 0, clean

## Issues Found

1. **Verification payload capture gap (tooling, not implementation)** — `/tmp` vctx payload contained no changed files (branch already merged to main when evidence was collected). Verdict rests on direct local verification of the committed implementation (commits `32fe4af`, `f81a706`, `ff0e36f`).

No implementation issues found.

## Notes

- FR7 docs fully landed: help line (`src/master-commands.ts:259`), CLAUDE.md verb list (`CLAUDE.md:120` includes `graph`), `README.md:203-205` "Org-graph view" section, `docs/commands.md:142-147`.
- Spec edge cases all covered by dedicated checks: empty registry, id collision suffixing, self/master/unknown `peers.allow` refs (warn, no crash), absent `poolStats` (warm/cold omitted), missing transcript (`idle never`), shared bot-peer id (single node, two edges), Mermaid excludes warnings (appended after fence by the handler, per test at `src/master-commands.test.ts:2048`).
- Read-only verification: no files were modified.
