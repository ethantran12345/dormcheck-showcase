#!/usr/bin/env bash
#
# Scoped crash-class typecheck gate.
#
# Catches exactly the class of bug that white-screened /marketplace/create in
# production on 2026-07-20 (`ReferenceError: cn is not defined`): a name that
# does not exist at runtime. vite/esbuild strip types without checking
# references, and CI's full typecheck is non-blocking, so this class of error
# reaches users unless something gates it specifically.
#
#   TS2304  "Cannot find name 'x'"
#   TS2552  "Cannot find name 'x'. Did you mean 'y'?"
#
# These essentially always mean a page throws at runtime. Everything else
# (the ~110 pre-existing type-debt errors we are burning down separately)
# stays NON-blocking so this gate is not red on day one and never gets muted.
#
# Exit 0 = no crash-class errors (prints remaining non-crash count as FYI).
# Exit 1 = at least one crash-class error (prints them with an explanation).
#
# Note: `tsc` exits non-zero on ANY error, so we do NOT rely on its exit code —
# we filter its combined output for the crash-class codes only.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

# A stale tsbuildinfo makes tsc skip files and hide errors — always start clean.
rm -f tsconfig.app.tsbuildinfo

OUTPUT="$(npx tsc -p tsconfig.app.json --noEmit 2>&1)"

CRASH="$(printf '%s\n' "$OUTPUT" | grep -E 'error TS(2304|2552)' || true)"
TOTAL="$(printf '%s\n' "$OUTPUT" | grep -cE 'error TS[0-9]+' || true)"

if [ -n "$CRASH" ]; then
  CRASH_COUNT="$(printf '%s\n' "$CRASH" | grep -c . )"
  echo "❌ crash-class typecheck gate FAILED: $CRASH_COUNT error(s)"
  echo ""
  printf '%s\n' "$CRASH"
  echo ""
  echo "crash-class: this name does not exist at runtime and will white-screen the page."
  echo "Fix the reference (usually a missing import or an out-of-scope const) — do NOT"
  echo "silence it with @ts-expect-error or a cast. See scripts/typecheck-crash-gate.sh."
  exit 1
fi

NONCRASH=$(( TOTAL ))
echo "✅ crash-class typecheck gate passed: 0 TS2304/TS2552 errors."
echo "FYI: $NONCRASH non-crash type error(s) remain (pre-existing type-debt, not gated)."
exit 0
