# Proposal: Hermes invoke from project channels

**Created:** 2026-07-25
**Status:** 🟡 Draft

## Problem

The Hermes bridge (`hermes_run` MCP tool + `!project hermes`) is master-channel-only. Project channels like **dstm-apps** cannot trigger out-of-band ops runs — e.g. deploying the dstm-apps docker image — even though Hermes is exactly the right vehicle for host-level work that must outlive or sit outside MCD's process tree. Today the operator must switch to the master channel and relay the request manually, which breaks the per-project workflow and blocks project Claudes from finishing deploy tasks end-to-end.

Concrete trigger: operator wants dstm-apps' Claude to deploy the dstm-apps docker image via Hermes (2026-07-25).

## Proposed Solution

Per-project opt-in for the existing Hermes bridge:

1. **Config:** add `projects[*].hermes.{enabled: boolean}` (default absent = disabled) to `channels.json` schema. `defaults.hermes` stays the single source of bridge-level config (binPath, yolo, extraArgs); the per-project flag only grants access.
2. **Tool exposure:** `MasterMcpServer` lists `hermes_run` for a project session when `defaults.hermes.enabled && project.hermes.enabled` (today: master only). The `case 'hermes_run'` handler replaces its master-only gate with the same check (master keeps unconditional access when the bridge is enabled).
3. **Report-back routing:** project-initiated runs get `hermes send --to discord:<project_chat_id>` in the wrapped prompt so results land in the originating channel, not master. Master channel also gets a one-line launch notice (`🛰 hermes run <id> launched by <slug>`) for auditability.
4. **Operator control:** `!project set <target> --hermes on|off` toggles the flag (allowFrom-gated, like other mutations).

## Scope

### In Scope
- `channels.json` zod schema: `ProjectEntry.hermes` + `!project set --hermes on|off`
- `master-mcp-server.ts`: tool listing + handler gate change, per-chat report-back target
- `hermes-bridge.ts`: `wrapHermesPrompt` accepts a report-back chat id distinct from master
- Master-channel audit notice on project-initiated launches
- Tests: gate matrix (master / enabled project / disabled project / bridge off), prompt wrapping target
- Docs: CLAUDE.md, ARCHITECTURE.md, README table

### Out of Scope
- Per-project Hermes binary/config overrides (binPath, yolo, model) — defaults only
- Rate limiting / concurrency caps on Hermes runs
- `!project hermes` command from project channels (Discord command parsing stays master-only; projects use the MCP tool)
- Teams/WhatsApp report-back (`hermes send --to` is Discord-only today)

## Impact

- **Files affected:** ~6 (channels-config, master-mcp-server, hermes-bridge, master-commands, server.ts wiring, docs) + 3 test files
- **Complexity:** small-medium
- **Risk:** medium — Hermes runs with `--yolo` on the host; widening access from master-only to project channels enlarges the blast radius of a prompt-injected or confused project Claude. Mitigated by explicit per-project opt-in + master audit notice.

## Open Questions

1. Should project-initiated runs *also* report to master (dual send) or is the audit launch-notice enough?
2. `--hermes on` for master target: no-op or error? (Master already has access; propose: warn no-op.)
3. Cap prompt length or log prompt fully in the audit notice? (Propose: first 120 chars.)

---

**To proceed:** Review this proposal and approve to begin planning.
