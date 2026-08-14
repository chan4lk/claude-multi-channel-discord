# Design: Org-graph view (`!project graph`)

**Change:** org-graph-view
**Created:** 2026-07-28

## Technical Approach

Follow the established read-only-verb pattern (`handleCollab`, `handleUsage`): a new `handleGraph(rest, ctx)` in `src/master-commands.ts` that parses flags, gathers inputs through injectable deps, and delegates all logic to a new pure module `src/org-graph.ts`. The pure module has three layers:

1. **Model builder** — `buildOrgGraph(config, inputs): OrgGraph` where `inputs` carries pre-loaded, already-IO'd data (`schedules`, `handoffs`, `activity`, `pool`). Produces a plain node/edge model with all derived facts (mutuality, staleness, dead edges) computed once.
2. **Text renderer** — `renderGraphText(graph, opts): string` — compact adjacency view, default output.
3. **Mermaid renderer** — `renderGraphMermaid(graph, opts): string` — fenced `graph LR` block.

Renderers are dumb: every judgment (stale, mutual, dead) is a boolean/enum on the model, so both views agree by construction and tests target the model.

## Architecture

```
!project graph [--stats] [--mermaid]
        │
        ▼
handleGraph (master-commands.ts)          ← async (awaits poolStats when --stats)
  ├─ loadConfig()
  ├─ deps (all optional / fail-soft):
  │    ctx.loadHandoffRegistry ?? loadRegistry     (existing injection point)
  │    ctx.loadSchedulesFn ?? loadSchedules        (new optional ctx field, same pattern)
  │    ctx.transcriptMtimeFn ?? newestTranscriptMtimeMs  (new optional ctx field)
  │    ctx.mutator?.poolStats                      (existing, may be absent)
  ├─ buildOrgGraph(config, inputs)                 (src/org-graph.ts, pure)
  └─ --mermaid ? renderGraphMermaid : renderGraphText
```

Model shape (exported from `src/org-graph.ts`):

```ts
interface GraphNode {
  id: string            // sanitized mermaid-safe id
  label: string         // slug or `bot:<id>` or `master`
  kind: 'master' | 'project' | 'bot'
  platform?: 'discord' | 'teams' | 'whatsapp'
  disabled?: boolean
  autopilot?: boolean
  hermes?: boolean
  // --stats only:
  warm?: boolean | null       // null = unknown (no poolStats)
  idleMs?: number | null      // null = never
  schedules: string[]         // cadence summaries, self-loop decorations
}
interface GraphEdge {
  from: string; to: string
  kind: 'peer' | 'botPeer' | 'role'
  role?: string
  mutual?: boolean            // peer edges
  stale?: boolean             // role target unresolvable
  dead?: boolean              // role while handoff flag off / peer slug missing
  openHandoffs?: number       // --stats
}
interface OrgGraph { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] }
```

`warnings` collects the `⚠` dead-edge lines (FR4) plus invalid-config edges (self/master peer entries in hand-edited configs).

## File Changes Map

| File | Action | Description |
|------|--------|-------------|
| `src/org-graph.ts` | create | Pure model builder + text/mermaid renderers, `GraphInputs` type |
| `src/org-graph.test.ts` | create | bun PASS/FAIL script: builder derivations + both renderers |
| `src/master-commands.ts` | modify | `graph` case in dispatch, `handleGraph`, help line, 2 new optional `MasterContext` fields (`loadSchedulesFn`, `transcriptMtimeFn`) |
| `src/master-commands.test.ts` | modify | verb wiring tests with injected deps (no filesystem) |
| `README.md`, `docs/commands.md` | modify | document the verb + flags |
| `CLAUDE.md` | modify | add `graph` to verb list |

`server.ts` needs **no change**: `poolStats` is already wired into the mutator, and the two new ctx fields default to the real implementations inside `handleGraph` when absent.

## Data Model Changes

None. No `channels.json` schema change, no new state files. `schedules.json` and `shared/handoffs.json` are read-only inputs.

## API Changes

- New master verb `graph` with flags `--stats`, `--mermaid` (composable).
- `MasterContext` gains two optional injectable fields (test seams only; behavior identical when omitted).
- No MCP tool surface changes — `run_master_command` reaches the verb for free.

## Key Decisions

1. **Deps pre-loaded in handler, builder stays pure.** `buildOrgGraph` takes data, not loaders — the cheapest way to satisfy the project's injectable-side-effects convention (context.md: "Injectable side effects: spawn functions, clocks, and mutators are constructor-injected so tests never launch real processes") and keeps 100% of graph logic testable without mocks.
2. **Effective-flag resolution reuses config helpers.** `handoff` effective value = `project.handoff ?? defaults.handoff` (defaults schema has `handoff: z.boolean().default(false)`, `src/channels-config.ts:447`); collab staleness delegates to the existing `resolveCollabTarget` (`src/channels-config.ts:673`) rather than re-implementing resolution — single source of truth, matches how `handleCollab` marks `(stale)` today (`src/master-commands.ts:2382-2384`).
3. **Bot peers are first-class nodes.** Rendering allowlisted bot ids as `bot:<id>` nodes (not edge annotations) makes shared peers (e.g. Hermes allowlisted by two projects) visibly convergent — the finaudit↔Hermes topology reads correctly.
4. **Hermes grant is a node decoration, not an edge.** Hermes reach targets the host, not another agent; drawing it as an edge to a fake "host" node adds a node class for one marker. `🛰` on the node says the same thing.
5. **Warnings always on.** Dead-edge `⚠` lines print in the default view, not behind `--stats` — misconfiguration visibility shouldn't require opting in (spec Notes; catches the "collab role configured but `handoff` flag off" class observed with finaudit-agents).
6. **Mermaid ids sanitized, labels verbatim.** Node id = `[a-zA-Z0-9_]` mapping with collision-free suffixing; display label keeps the raw slug. Mermaid breaks on `-`-leading/emoji ids but labels are quoted-safe.
7. **BotPeerGate live state excluded from v1** (spec Notes): the gate instance is server-owned; plumbing an accessor through the mutator for one stats column isn't worth it while handoffs+activity+warm/cold already cover the "where does traffic flow" question.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Output blows past 2000 chars on big registries | Existing chunker splits on the reply path (`src/discord-chunk.ts`); mermaid block fenced so chunker keeps fences balanced — verify with a many-project fixture in tests |
| Mermaid syntax edge cases (special chars in role names/labels) | Quote all labels, sanitize ids, test with hostile slugs (`a-b.c`, emoji) |
| Stats IO failures (missing dirs, dead pool) mid-render | Every stats input is `try/catch`-wrapped at the handler layer, degraded to `null`/omission before the pure builder runs (NFR3) |
| Verb drift between text and mermaid views | Both render from the same `OrgGraph` model; derivations live in the builder only |

## Grounding sources

- `ARCHITECTURE.md` — component map and read paths ("`MasterMcpServer` … Tool surface", "`Scheduler` … Reads/writes schedules.json"); confirms the parser is the right layer and `run_master_command` reaches verbs for free ("natural-language asks turn into real verbs without operator typing").
- `.specclaw/context.md` — "Injectable side effects: spawn functions (`hermesSpawnFn`), clocks (`now`), and mutators are constructor-injected so tests never launch real processes" → decision 1; "tests are plain `bun src/<name>.test.ts` scripts with PASS/FAIL check lines (no test framework)" → NFR4 test style; "High-churn runtime state goes in a separate `shared/*.json` file, never in `channels.json`" → read-only stance keeps us clear of both.
- `CLAUDE.md` — verb list + "Mutation verbs require `userId ∈ access.allowFrom`" → `graph` classed with read-only verbs (no gate beyond master-channel routing, same as `list`/`collab`).
