# Tasks: Collab handoff protocol

**Change:** collab-handoff-protocol
**Created:** 2026-07-26
**Total Tasks:** 6

## Summary

Six tasks, four waves. Wave 1 lands the registry module and the config schema/role resolution in parallel (each with its own tests, per project convention: plain `bun src/<name>.test.ts` PASS/FAIL scripts). Wave 2 extends the MCP surface. Wave 3 wires inbound ack detection, the turn-limit exemption, the sweep, and the master verb. Wave 4 documents.

## Tasks

### Wave 1 — registry + schema foundations

- [x] `T1` — Handoff registry module + tests
  - Files: `src/handoffs.ts`, `src/handoffs.test.ts`, `src/paths.ts`
  - Estimate: medium
  - Kind: impl
  - Notes: New `src/handoffs.ts`: `HandoffRecord` = `{ id: "h-<base36ts>-<hex4>", from: slug, to: {kind:'project',slug,chatId}|{kind:'botPeer',botId,chatId}, task, state: 'pending'|'done'|'expired', createdAt, naggedAt?, closedAt?, outcome? }`. Functions: `createHandoff` (assigns id, persists), `completeHandoff(id, outcome)` idempotent (done/expired → no-op ok), `matchPendingIds(chatId, text)` (exact `#<id>` substring match against pending records whose `to.chatId` === chatId), `sweepHandoffs(nowMs, timeoutMs)` → actions `[{kind:'nag',record}|{kind:'escalate',record}]` — nag once at timeout (persist `naggedAt`), escalate + mark `expired` at 2× timeout, idempotent across runs; prune closed records beyond 200 entries or 30 days. IO: `loadRegistry` fail-open on corrupt/absent (stderr warn), `saveRegistry` atomic tmp+rename with mkdir -p, path via new `handoffsPath()` in `src/paths.ts` (`shared/handoffs.json`). Injectable clock param (no Date.now inside logic fns). Tests: create→complete, duplicate complete, nag-once/escalate-once/expire, sweep idempotence, prune, corrupt file → empty, write-then-reload survival (AC5 core, AC8).

- [x] `T2` — Collab config schema + role resolution + tests
  - Files: `src/channels-config.ts`, `src/channels-config.test.ts`
  - Estimate: small
  - Kind: impl
  - Notes: `CollabSchema = z.object({ roles: z.record(z.string()).optional(), timeoutMinutes: z.number().int().positive().optional() }).strict()` optional on `ProjectSchema`; `defaults.collab` limits-only variant (`timeoutMinutes` only). `effectiveCollabTimeout(config, project)` — project → defaults → built-in 30. `resolveCollabTarget(config, sourceChatId, roleOrSlug)` → `{kind:'project',slug,chatId} | {kind:'botPeer',botId,chatId:sourceChatId} | {error:string}`: try `collab.roles[roleOrSlug]` first (else treat input as literal slug), internal value must be an existing slug, not master, not self; else if value ∈ source project `botPeers.allow` → botPeer; else error naming the stale value and configured roles. If no `src/channels-config.test.ts` exists, create one following the repo's PASS/FAIL script pattern; cover valid role→slug, role→botPeer, literal slug, stale value, self, master, non-allowlisted bot id (AC6 validation core).

### Wave 2 — MCP surface

- [x] `T3` — Extend handoff tool + new handoff_complete + tests
  - Files: `src/master-mcp-server.ts`, `src/master-mcp-server.test.ts`
  - Estimate: large
  - Kind: impl
  - Depends: T1, T2
  - Notes: `handoff` case: accept optional `role` arg (alternative to `target_slug`; exactly one required), resolve via `resolveCollabTarget`. Internal target: refuse disabled target BEFORE creating record, create registry record, append ` #h-<id>` to envelope content, keep existing pool.deliver + visibility post. BotPeer target: create record, post `<@botId> [handoff #h-<id> from <slug>] <task>` to the SOURCE channel via `this.onReply` (no pool.deliver — peer lives in the same channel; mention satisfies DISCORD_ALLOW_BOTS=mentions). New `handoff_complete` tool `{ id, outcome? }`: allowed when calling session's chatId is the record's `to.chatId` (project target) or master; same predicate in tool LISTING and call handler (defense-in-depth per context.md); pending → done; done/expired → idempotent ok message. Update `handoff` tool description mentioning roles + `#h-<id>` tracking. Tests in existing round-trip suite: AC1 (internal → record + `#h-` in envelope), AC2 (role→botPeer → onReply post + record), AC3 (complete: target ok / stranger refused / master ok / duplicate idempotent), disabled-target refusal, role-vs-target_slug arg validation.

### Wave 3 — wiring

- [x] `T4` — Inbound ack detection + turn-limit exemption + scheduler sweep
  - Files: `server.ts`, `src/scheduler.ts`, `src/scheduler.test.ts`, `src/bot-peers.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T3
  - Notes: server.ts bot-peer inbound path (near `botPeerGate.check`): before gate counting, `matchPendingIds(chatId, msg.content)`; on ≥1 match → `completeHandoff` each (outcome = content ≤500 chars), deliver envelope, SKIP `recordDelivery` (FR6/AC4); no match → unchanged flow. `src/scheduler.ts`: `registerHandoffSweep(deps)` following `registerBacklogWatchSweep` shape but 5-min tick guard; deps injectable `{ sweep: () => actions, notifyChannel(chatId, text), notifyMaster(text) }`; nag text `⏰ handoff #h-<id> pending <N>m: <task ≤120>` → receiver channel (`to.chatId`), escalate text `⚠️ handoff #h-<id> <from>→<to> unanswered — expired` → master. Wire in server.ts boot with `routeNotification`. Tests: scheduler sweep with fake clock fires nag once then escalate once (AC5 end-to-end), bot-peers test for exemption both branches + two-pending-ids edge (AC4).

- [x] `T5` — `collab` verb + `set --collab-role` + tests
  - Files: `src/master-commands.ts`, `src/master-commands.test.ts`
  - Estimate: medium
  - Kind: impl
  - Depends: T2
  - Notes: `collab <slug>`: roles table (mark stale entries whose value no longer resolves), open handoffs for that project (id, direction from→to, age minutes, task ≤80 chars), friendly empty-state line; read-only — works even when `handoff` flag off. `set <slug> --collab-role name=value` follows `--hermes`/`--disabled` flag pattern (fresh-config read-modify-write); validate value via `resolveCollabTarget` (refuse with its error), `name=none` deletes the role; no `--yes` (config only — reach stays behind the `handoff` flag); master target refused for role-set. Update `set` usage + help text. Tests: AC6 (invalid refused, valid persists, none removes), AC7 (list + empty state).

### Wave 4 — docs

- [x] `T6` — Docs + collaboration norms
  - Files: `CLAUDE.md`, `README.md`, `docs/commands.md`, `templates/master.CLAUDE.md`, `templates/project.CLAUDE.md`
  - Estimate: small
  - Kind: docs
  - Depends: T4, T5
  - Notes: CLAUDE.md: key-fields bullet for `collab`, verbs list + `set` flags, short "Collab handoff protocol" section (registry file, lifecycle, exemption safety rule). README + docs/commands.md: verb + flag reference. Templates: addressing protocol (unaddressed human messages belong to the channel-owner bot; peers only on @mention) + peer-clarify norm (answer a peer's blocking question when you own the context) (FR8). Check template filenames — use whatever project template exists. Run `bun tsc --noEmit` + full suites, note results for AC9.
