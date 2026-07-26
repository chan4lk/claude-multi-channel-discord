# Spec: Heartbeat live task count

## Functional Requirements

- FR1: `readSpecclawStatus()` counts checkboxes in `.specclaw/changes/<active>/tasks.md` at call time; when the file yields ≥1 task line, its done/total override the STATUS.md-parsed counts. All consumers (heartbeat specclaw-idle, rotation resume block, `!project show`) get live counts for free.
- FR2: tasks.md missing or unparseable → STATUS.md counts unchanged (current behavior).
- FR3: `buildSpecclawResumeBlock()`: when done === total > 0, the brief instructs `/specclaw:verify` then `/specclaw:pr` and explicitly forbids re-running build — never "continue via /specclaw:build".
- FR4: heartbeat `specclaw-idle` summary: when done === total > 0, wording becomes "tasks complete, phase not advanced — verify/pr may be pending" instead of the plain counts summary.

## Acceptance Criteria

- AC1: STATUS.md says 0/14, tasks.md has 13/13 checked → readSpecclawStatus returns 13/13 (unit test)
- AC2: tasks.md absent → STATUS.md counts returned unchanged (unit test)
- AC3: done === total > 0 → resume block contains verify/pr instruction and no "/specclaw:build" directive (unit test)
- AC4: heartbeat specclaw-idle item reworded when tasks complete (unit test)
- AC5: `bun tsc --noEmit` clean; specclaw-status + heartbeat + all existing suites green
