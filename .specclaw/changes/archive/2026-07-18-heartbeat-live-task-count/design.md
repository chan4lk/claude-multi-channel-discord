# Design: Heartbeat live task count

Single-source fix: the stale-count bug lives in `readSpecclawStatus()` (`src/specclaw-status.ts`), which every consumer (heartbeat, rotation brief, master show) already uses. Override counts there from tasks.md at call time.

- `src/backlog.ts`: export existing `countCheckboxes(filePath)` (already handles `- [x]`/`* [ ]`/indent via TASK_LINE_RE; returns {done,total}, silent on missing file).
- `src/specclaw-status.ts` `readSpecclawStatus()`: after activeChange resolved, `const live = countCheckboxes(<change>/tasks.md)`; if `live.total >= 1` override result.tasksDone/tasksTotal. Runs before phase resolution so the early-return on unreadable status.md doesn't skip it.
- `buildSpecclawResumeBlock()`: complete-guard branch (done===total>0) with verify/pr wording.
- `src/heartbeat.ts` specclaw-idle: summary branch on complete counts.

No schema, no config, no server.ts changes.
