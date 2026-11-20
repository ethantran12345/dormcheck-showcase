#!/usr/bin/env bash
#
# Full-typecheck ratchet gate.
#
# The crash gate (typecheck-crash-gate.sh) blocks the TS2304/TS2552 subset that
# white-screens a page. This gate blocks the FULL `tsc -b` error COUNT so the rest
# of the type-debt can only go down, never back up.
#
# Why this exists: the type-debt was driven from ~112 -> 1 on 2026-07-21 (lane
# `typedebt`), but the full typecheck stayed non-blocking in CI (continue-on-error),
# so nothing stopped it from silently regressing. It did: the shadcn Message/Bubble
# chat adoption (2026-07-22) added 9 new errors (a generic `id: string` constraint
# on appendMessageById() didn't match `messages.id: number`) and CI stayed green.
# This gate is the fix for THAT gap, not a replacement for the crash gate above.
#
# BASELINE is 0 as of 2026-07-26. The one documented exception used to be
# DormCsvTools.tsx:123 (`master_housing.id` is a NOT-NULL bigint PK with no
# default/identity, so a CSV new-row insert couldn't satisfy it — see
# docs/DECISIONS.md 2026-07-21). That's resolved: the importer now type-coerces
# each column and mints the next id itself. **Never bump BASELINE back up to
# paper over a new error** — fix the error instead.
#
# Exit 0 = total tsc error count <= BASELINE.
# Exit 1 = count > BASELINE (a regression was introduced).

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

BASELINE=0

# A stale tsbuildinfo makes tsc skip files and hide errors — always start clean.
rm -f tsconfig.tsbuildinfo tsconfig.app.tsbuildinfo tsconfig.node.tsbuildinfo

OUTPUT="$(npx tsc -b --noEmit 2>&1)"
COUNT="$(printf '%s\n' "$OUTPUT" | grep -cE 'error TS[0-9]+' || true)"

if [ "$COUNT" -gt "$BASELINE" ]; then
  echo "❌ typecheck ratchet FAILED: $COUNT error(s), baseline is $BASELINE"
  echo ""
  printf '%s\n' "$OUTPUT"
  echo ""
  echo "The full-typecheck error count went UP. Fix the new error(s) — do NOT silence"
  echo "them with @ts-expect-error/any just to move the number, and do NOT raise"
  echo "BASELINE in scripts/typecheck-ratchet.sh to paper over a regression."
  exit 1
fi

echo "✅ typecheck ratchet passed: $COUNT error(s) (baseline $BASELINE)."
exit 0
