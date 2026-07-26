# Tasks: Collab handoff protocol

**Change:** collab-handoff-protocol
**Created:** 2026-07-26

Legend: tasks use checkbox lines; `Kind:` hints agent specialization.

## Wave 1 — foundations (parallel)

- [ ] `T1` — Handoff registry module. Kind: impl
  Create `src/handoffs.ts`: `HandoffRecord` type, `createHandoff`, `completeHandoff` (idempotent), `matchPendingIds(chatId|toKey, text)`, `sweepHandoffs(now, timeoutMs)` returning nag/escalate actions (each at most once per record — persist `naggedAt`), prune (>200 closed or >30d), `loadRegistry` (fail-open on corrupt) / `saveRegistry` (atomic tmp+rename, mkdir -p) at `shared/handoffs.json` via a new `handoffsPath()` in `src/paths.ts`. Injectable clock. FR1, FR5-decisions, NFR1, NFR3.

- [ ] `T2` — Config schema + role resolution. Kind: impl
  `src/channels-config.ts`: `CollabSchema { roles?: Record<string,string>, timeoutMinutes?: number }` (strict, optional) on project; `defaults.collab` limits-only (`timeoutMinutes` only); `effectiveCollabTimeout(config, project)` (built-in 30); `resolveCollabTarget(config, sourceChatId, roleOrSlug)` → `{kind:'project',slug,chatId} | {kind:'botPeer',botId} | {error}` validating: role lookup in `collab.roles`, internal slug exists + non-master + non-self, botPeer id ∈ source `botPeers.allow`. FR3, FR7 validation rules.

- [ ] `T3` — Registry + resolution tests. Kind: test
  `src/handoffs.test.ts`: create→complete, duplicate complete idempotent, sweep nag-once/escalate-once/expire, sweep idempotence across runs, prune, corrupt file → empty + warn, restart survival (write, re-load). Config tests appended to existing suite pattern for `resolveCollabTarget` valid/stale/self/master/not-allowlisted. AC5, AC8 core.

## Wave 2 — MCP surface (after W1)

- [ ] `T4` — Extend handoff tool + handoff_complete. Kind: impl
  `src/master-mcp-server.ts`: `handoff` gains optional `role` arg (mutually exclusive with `target_slug`), resolves via `resolveCollabTarget`, creates registry record, internal path appends `#h-<id>` to envelope content, botPeer path posts `<@botId> [handoff #h-<id> from <slug>] <task>` to the source channel via `onReply` (no pool.deliver); refuse disabled targets before record creation. New `handoff_complete` tool: listed + callable when session is a pending handoff's target project or master (defense-in-depth: same predicate in listing and call). Mirror/visibility failures log-and-continue (NFR2). FR1-FR4, AC1-AC3, edge: disabled target, stale role.

- [ ] `T5` — MCP round-trip tests. Kind: test
  `src/master-mcp-server.test.ts`: AC1 (internal handoff → record + `#h-` envelope), AC2 (role→botPeer → channel post + record), AC3 (complete: target ok / stranger refused / master ok), disabled-target refusal, role-arg validation errors.

## Wave 3 — wiring (after W2)

- [ ] `T6` — Inbound ack detection + turn-limit exemption + sweep. Kind: impl
  `server.ts`: in the bot-peer inbound path, before `botPeerGate.check` counting, run `matchPendingIds(chatId, content)`; on match: `completeHandoff` each, deliver, skip `recordDelivery` (FR6, AC4); unmatched `#h-` text flows normally. `src/scheduler.ts`: `registerHandoffSweep()` (5-min tick guard, follows `registerBacklogWatchSweep` shape) → sweep actions routed: nag → receiver channel (`⏰ handoff #h-<id> pending Nm: <task ≤120>`), escalate → master (`⚠️ handoff #h-<id> <from>→<to> unanswered — expired`). Wire deps in `buildMutator()`/boot. FR5, FR6.

- [ ] `T7` — Master verb + set flag. Kind: impl
  `src/master-commands.ts`: `collab <slug>` (roles table with stale-marking, open handoffs: id, direction, age, task ≤80, empty-state line); `set <slug> --collab-role name=value` (validated via `resolveCollabTarget`, `name=none` removes; no `--yes` — config only, reach stays behind `handoff` flag). Help text. FR7, AC6, AC7.

- [ ] `T8` — Wiring tests. Kind: test
  `src/bot-peers.test.ts` + `src/scheduler.test.ts` + `src/master-commands.test.ts`: AC4 both branches, AC5 end-to-end through scheduler sweep with fake clock, AC6, AC7, two-pending-ids edge.

## Wave 4 — docs (after W3)

- [ ] `T9` — Docs + norms. Kind: docs
  `CLAUDE.md` (key fields, verbs list, new section stub), `README.md`, `docs/commands.md`; addressing protocol + peer-clarify norm added to `templates/master.CLAUDE.md` and project CLAUDE.md template (FR8). Run `bun tsc --noEmit` + full test suites for AC9 evidence.
