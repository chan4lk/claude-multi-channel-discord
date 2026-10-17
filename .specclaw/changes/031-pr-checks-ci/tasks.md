# Tasks: PR checks (CI)

**Change:** 031-pr-checks-ci
**Total Tasks:** 3

## Tasks

### Wave 1

- [x] `T1` — Test runner script (AC2, AC3)
  - Files: bin/ci-tests.sh
  - Estimate: small
  - Kind: config
  - Notes: loop `src/*.test.ts`, `timeout 120 bun`, skip list with reasons, print failing files, exit 1 on any failure. Optional file args restrict the set (used by the windows job).

### Wave 2

- [x] `T2` — Workflow (AC1, AC4)
  - Files: .github/workflows/pr-checks.yml
  - Estimate: small
  - Kind: config
  - Depends: T1
  - Notes: ubuntu `check` job + windows job, concurrency group, setup-bun, tsc then ci-tests.sh.

- [x] `T3` — README note (AC5)
  - Files: README.md
  - Estimate: small
  - Kind: docs
  - Depends: T1
