# Proposal: PR checks (CI) via GitHub Actions

**Created:** 2026-10-17
**Status:** 🟡 Draft

## Problem

The repo has no `.github/workflows`, so PRs (e.g. #331, merged with zero checks) get no automated typecheck or test run. Regressions in a ~24-test-file codebase are only caught by hand.

## Proposed Solution

Add `.github/workflows/pr-checks.yml`, triggered on `pull_request` to `main` (and `push` to `main`), using `oven-sh/setup-bun`, `bun install --frozen-lockfile`-style install, then:
1. `bun tsc --noEmit` (typecheck)
2. Run every `src/*.test.ts` with `bun`, one process per file (tests are plain bun scripts, not `bun test`), failing the job if any file exits non-zero.

Runs on `ubuntu-latest` (tests mock tmux/claude); a second `windows-latest` job runs the Windows-relevant files (`claude-bin`, `claude-process`, `orphan-sweep`) since PR #331 added the native Windows backend.

## Scope

### In Scope
- One workflow file, typecheck + all unit test files, ubuntu + a small windows job
- Concurrency group to cancel superseded runs
- Short README/CLAUDE.md note on how to run the same checks locally

### Out of Scope
- Lint/format tooling, coverage, release/deploy workflows
- Branch protection rules (repo setting; operator enables "require status checks")
- Fixing any tests that turn out to fail/flaky on CI (reported separately)

## Impact

- **Size:** bounded (new file, no existing flow altered)
- **Files affected:** 1–3 (workflow, README/CLAUDE.md note)
- **Complexity:** small
- **Risk:** low (CI-only; main risk is some tests needing tmux/network and failing on runners)

## Open Questions

- `bun.lock` is gitignored, so installs are unlocked — acceptable, or should the lockfile be committed?
- Should failing-on-CI tests (if any need tmux) be skipped or have tmux installed on the runner? I'll run them first and report.
- Should the windows job be required or informational?

---

**To proceed:** Review this proposal and approve to begin planning.
