# Spec: Org-graph view (`!project graph`)

**Change:** org-graph-view
**Created:** 2026-07-28
**Status:** 🟡 Draft

## Overview

A read-only master verb `!project graph` (reachable via `mcp__mcd__run_master_command` like every other verb) that renders MCD's agent organization as a graph: projects and bot peers as nodes, the reach grants in `channels.json` (`peers`, `botPeers`, `collab.roles`, `hermes`, schedules) as edges. Optional `--stats` overlay adds live traffic/health signals (open handoffs, last-activity age, warm/cold session state); optional `--mermaid` emits a fenced Mermaid `graph LR` block instead of the text adjacency view. Pure read path — no config writes, no new state files.

## Requirements

### Functional Requirements

- **FR1 — `graph` verb.** `!project graph [--stats] [--mermaid]` is accepted in the master channel (and via `run_master_command`). Unknown flags are ignored the same way other verbs treat them; no positional args required.
- **FR2 — Nodes.** The output lists one node per entry: master, every project in `channels.json` (slug + platform icon: 💬 discord / 🟦 teams / 🟩 whatsapp), and every *external bot id* referenced by any project's `botPeers.allow` (rendered as `bot:<id>` nodes). Node decorations: `⛔` when `disabled: true`, `🤖` when `autopilot.enabled`.
- **FR3 — Edges.** For every project, render:
  - `peers.allow` entries as peer edges; when the target project's own `peers.allow` lists the source back, mark the edge `↔` (mutual); otherwise `→ (one-way, no consent back)`.
  - `botPeers.allow` ids as edges to the corresponding `bot:<id>` node.
  - `collab.roles` as labelled edges `--role-->` to the resolved target; when `resolveCollabTarget` returns an error for the role, mark `(stale)`.
  - `hermes.enabled: true` as a self-decorating grant marker `🛰` on the node (host-reach grant, not an inter-agent edge).
  - Enabled schedules (from `schedules.json`) as self-loops with cadence summary (e.g. `⏰ daily 09:00`, `⏰ every 30m`, `⏰ cron */5 * * * *`); disabled schedules omitted.
- **FR4 — Dead-edge warnings.** One `⚠` line per detected dead edge: (a) a `collab.roles` entry configured while the project's `handoff` reach flag resolves false (role can never fire), (b) a `peers.allow` slug that doesn't exist in the registry, (c) a stale collab role (unresolvable target).
- **FR5 — `--stats` overlay.** When passed, augment nodes/edges with: open (pending) handoff count per from→to pair (from the handoff registry), per-node last-activity age (newest transcript mtime via `newestTranscriptMtimeMs`, `never` when null), and warm/cold session state (warm = chat id present in `poolStats()` with `alive: true`).
- **FR6 — `--mermaid` output.** When passed, output is a single fenced ```` ```mermaid ```` block containing a valid `graph LR` diagram: nodes with bracket labels, peer edges `---`/`-->`, role edges `--role-->`, stale/dead edges rendered with dotted links. `--stats` composes with `--mermaid` (counts folded into edge labels).
- **FR7 — Help text.** `!project help` gains a `graph` line; CLAUDE.md verb list, README and docs/commands.md updated.
- **FR8 — Master read-only.** The verb performs zero writes: no `saveConfig`, no registry mutation, no schedule mutation. It does not require `--yes` and is allowed for any master-channel caller (same class as `list`/`show`/`collab`).

### Non-Functional Requirements

- **NFR1 — Pure builder.** Graph assembly lives in a new pure module `src/org-graph.ts`: `(config, deps) → OrgGraph model → renderText / renderMermaid`. All IO (registry load, schedules load, transcript mtimes, pool stats) enters via injected deps so tests never touch the filesystem — matches the project's injectable-side-effects pattern (context.md: "spawn functions, clocks, and mutators are constructor-injected so tests never launch real processes").
- **NFR2 — Discord-size aware.** Output may exceed 2000 chars; no special handling needed beyond what exists — the reply path already chunks (`src/discord-chunk.ts`).
- **NFR3 — Fail-soft stats.** A failing stats source (missing registry, unreadable transcript dir, absent `poolStats`) degrades that overlay item to `?` / omission, never throws the whole verb.
- **NFR4 — Tests.** Unit tests in `src/org-graph.test.ts` (plain bun script, PASS/FAIL check lines, no framework) covering the model builder and both renderers.

## Acceptance Criteria

- **AC1:** `!project graph` on a config with 2 projects where A lists B in `peers.allow` and B lists A back renders an `A ↔ B` peer edge; if only A lists B, renders one-way with a warning marker.
- **AC2:** A project with `collab.roles.reviewer` pointing at an existing slug renders `--reviewer-->` edge; pointing at a deleted slug renders `(stale)` and a `⚠` dead-edge line.
- **AC3:** A project with `collab.roles` configured but effective `handoff` flag false yields a `⚠` line naming the project and the dead role(s).
- **AC4:** `botPeers.allow: ["123"]` yields a `bot:123` node and an edge to it.
- **AC5:** A disabled project renders with `⛔` and is never hidden; an autopilot-enabled project renders `🤖`; a hermes-enabled project renders `🛰`.
- **AC6:** An enabled daily schedule for a project renders a `⏰` self-loop with its cadence; a paused (`enabled: false`) schedule does not appear.
- **AC7:** `graph --stats` shows `N open` on an edge that has N pending handoffs between that pair in the injected registry, and per-node `idle <age>` / `warm|cold` derived from injected mtime + poolStats deps.
- **AC8:** `graph --mermaid` output starts with ```` ```mermaid ````, contains `graph LR`, ends with ```` ``` ````, and every node id is sanitized (alphanumeric/underscore) so Mermaid parses (labels carry the original slug text).
- **AC9:** All existing test suites still pass; new `src/org-graph.test.ts` passes; `bun tsc --noEmit` clean.
- **AC10:** `!project help` lists the verb; running the verb performs no writes (verifiable: no mutator calls in the handler path).

## Edge Cases

- Empty registry (`projects: {}`): renders master node + `no projects`, no throw.
- Project slug containing `-`/`.`/emoji: Mermaid node ids sanitized, text view unaffected.
- `peers.allow` referencing master or self: already impossible via `set` validation, but builder must not crash if hand-edited config contains it — render with `⚠` invalid-edge line.
- `poolStats` absent from ctx (unit tests, degraded boot): warm/cold column silently omitted (NFR3).
- Transcript dir missing for a never-used project: `idle never`.
- Two projects sharing a bot peer id: single `bot:<id>` node, two edges.
- Handoff registry contains records for since-deleted projects: counted only when either endpoint still resolves; otherwise ignored.

## Dependencies

- Existing: `resolveCollabTarget` (`src/channels-config.ts:673`), `loadRegistry` (`src/handoffs.ts:60`), `loadSchedules` (`src/schedules-config.ts`), `newestTranscriptMtimeMs` (`src/transcript-path.ts:42`), `MasterMutator.poolStats` (`src/master-commands.ts`).
- No new npm dependencies. No config schema changes.

## Notes

- Proposal open questions resolved as proposed: disabled nodes always shown with `⛔`; platform icon only, no JIDs/tenant ids in output (shareable, no PII); dead-edge `⚠` lines included in the default view (not just `--stats`) — cheap, and catches the finaudit wiring-gap class.
- Turn-budget/cooldown live state (`BotPeerGate`) deferred out of v1 stats: the gate instance lives in `server.ts` and isn't reachable from the parser without a new injected accessor; open handoffs + activity age + warm/cold already answer "where does traffic flow". Recorded as a possible follow-up.
