# Spec: PR checks (CI) via GitHub Actions

## Requirements
- FR1: A workflow runs on `pull_request` targeting `main` and on `push` to `main`.
- FR2: Job `check` (ubuntu-latest) installs bun, installs deps, runs `bun tsc --noEmit`, then runs every `src/*.test.ts` as a separate `bun <file>` process; any non-zero exit fails the job and the failing file names are printed.
- FR3: Job `windows` (windows-latest) runs `claude-bin`, `claude-process`, `orphan-sweep` tests (native Windows backend from #331).
- FR4: A per-file timeout prevents a hung test from stalling CI. Known-problematic files live in one explicit skip list with a reason each.
- FR5: Superseded runs on the same ref are cancelled (concurrency group).
- FR6: The same test loop is runnable locally via one script.

## Acceptance Criteria
- AC1: Opening a PR to main shows a `check` status that is green when typecheck + tests pass and red if either fails.
- AC2: A deliberately failing test file turns the job red and is named in the log.
- AC3: `bin/ci-tests.sh` passes locally/on ubuntu with the current tree.
- AC4: Windows job runs only the 3 listed files and passes.
- AC5: README documents local run (`bun tsc --noEmit`, `bin/ci-tests.sh`).

## Edge cases
- Locally on Windows `integration`, `memory-store`, `teams-adapter` fail and `project-pool` prints "all checks passed" but never exits (open handle). Treated as: verify on ubuntu first; skip-list only what still fails there, noting the reason; hung-but-passed files are not silently ignored — fix the handle if trivial, else skip-list with reason.
- `bun.lock` is gitignored: installs are unlocked (accepted; noted in open questions of the proposal).

## Approach
One decision: a small POSIX script `bin/ci-tests.sh` owns the test loop (timeout, skip list, summary) so CI and local runs share it; the workflow just calls it.
File map: `.github/workflows/pr-checks.yml` (new), `bin/ci-tests.sh` (new), `README.md` (note).
