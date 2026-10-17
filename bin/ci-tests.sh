#!/usr/bin/env bash
# Run src/*.test.ts, one bun process per file. Used by CI and runnable locally.
#   bin/ci-tests.sh                 # all test files minus SKIP
#   bin/ci-tests.sh src/a.test.ts   # only the given files
set -u
cd "$(dirname "$0")/.."

# file:reason — excluded until fixed
SKIP=(
  "src/integration.test.ts:imports better-sqlite3 via apps/mission-control, unsupported in Bun"
  "src/memory-store.test.ts:needs sharp native module + embedding model download"
)

if [ $# -gt 0 ]; then files=("$@"); else files=(src/*.test.ts); fi
failed=()
for f in "${files[@]}"; do
  skip=""
  for s in "${SKIP[@]:-}"; do [ -n "$s" ] && [ "${s%%:*}" = "$f" ] && skip="${s#*:}"; done
  if [ -n "$skip" ]; then echo "SKIP $f ($skip)"; continue; fi
  echo "::group::$f"
  # files written for the bun:test runner (describe/it) can't run as plain scripts
  if grep -q "from 'bun:test'" "$f"; then cmd=(bun test "$f"); else cmd=(bun "$f"); fi
  if timeout 120 "${cmd[@]}"; then echo "PASS $f"; else echo "FAIL $f (exit $?)"; failed+=("$f"); fi
  echo "::endgroup::"
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed test files:"; printf '  %s\n' "${failed[@]}"; exit 1
fi
echo "All test files passed."
