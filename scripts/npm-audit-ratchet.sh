#!/usr/bin/env bash
#
# npm-audit ratchet gate (dependency vulnerabilities).
#
# Blocks the COUNT of high+critical `npm audit` advisories against a baseline, so
# the vuln debt can only go down, never back up — the same ratchet idiom as
# scripts/typecheck-ratchet.sh. This is the per-push dependency gate that CodeQL
# does NOT give: CodeQL scans our source, not the transitive npm tree.
#
# Dependency-PR ownership (decided 2026-07-26): **Dependabot is the single owner.**
# `.github/workflows/deps-upgrade.yml` — a weekly `npm update --save` pushed straight
# to dev with lint/test `continue-on-error: true` — was DELETED; Dependabot version
# PRs run at `open-pull-requests-limit: 5` and security updates are enabled repo-side.
# Alerts are also swept weekly by the `dependabot-triage` job of `weekly-sweep.yml`.
#
# But none of that stops a NEW high/critical advisory from landing on the trunk the
# moment a dependency is added or bumped — Dependabot proposes, it does not gate.
# This script is what actually fails the push.
#
# Why a ratchet and not a bare `npm audit --audit-level=high`: a blanket threshold
# reds the trunk the instant any transitive advisory drops with no non-major fix
# available — punishing every unrelated push for a vuln nobody can act on yet. The
# ratchet grandfathers the known-unfixable set and fails ONLY on a NEW one.
#
# SCOPE (decided 2026-07-26, see docs/DECISIONS.md): the BLOCKING count is
# `--omit=dev`. This gate exists to protect SHIPPED code — what a user's browser
# or a Vercel function actually executes. A build-time-only advisory (a linter's
# glob matcher, a bundler's temp-dir helper) cannot reach a user, so failing the
# trunk on one teaches everyone that red means "probably ignorable", which is how
# a gate stops working. The concrete case: eslint-plugin-jsx-a11y pins
# minimatch@^3 -> brace-expansion@^1, a DoS with NO patched 1.x line and no fixed
# jsx-a11y release — structurally unfixable, and reachable only by `npx eslint`.
# This is a SCOPE correction, not a threshold change: BASELINE stayed at 2 at the
# time (it is 0 as of 2026-07-26, see below) and a new PRODUCTION advisory still
# reds the trunk exactly as before.
#
# Dev-tree advisories are NOT ignored — they are REPORTED. ci-dev-push.yml runs a
# second, non-blocking "Dependency-vuln report (full tree, non-blocking)" step
# that prints the full-tree count so dev-chain supply-chain risk stays visible.
# Re-triage if a dev advisory ever becomes runtime-reachable, or shows evidence of
# active exploitation in build tooling.
#
# BASELINE is today's known, non-major-fixable set.
#
#   0 (2026-07-26) — a TRUE zero floor: `npm audit --omit=dev` reports 0 high and 0
#     critical, so nothing is grandfathered and ANY new production high/critical
#     reds the trunk. This is the strongest ratchet position and the one to hold.
#
#   Was 2 (seeded 2026-07-22) = sharp -> libvips CVEs (CVE-2026-33327/33328/35590/
#     35591), reachable only through @vercel/og (server-side OG image generation in
#     api/). Retired because commit 8e880614 pinned `sharp: ^0.35.3` via npm
#     `overrides`, resolving both advisories — so the 2 became pure slack, and slack
#     in a ratchet means a genuine new production advisory passes the gate GREEN.
#
# Failure path VERIFIED 2026-07-26 at BASELINE=0 (not just the pass path): with a
# synthetic production high/critical present the script printed the FAILED banner and
# exited 1. A gate only ever observed passing is an untested gate.
#
# Never raise BASELINE to paper over a new advisory, and never widen --omit=dev to
# reclassify a production advisory as a dev one. Both are threshold changes wearing
# a disguise; either is a docs/DECISIONS.md call, not a silent edit.
#
# Exit 0 = production high+critical count <= BASELINE.
# Exit 1 = count > BASELINE (a new high/critical PRODUCTION advisory was introduced).

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

BASELINE=0

# The registry call is BOUNDED. On 2026-09-04 this step took ~7 minutes and the
# non-blocking full-tree report took 14+, together consuming the whole 20-minute CI
# job budget: Test, Build and Lint were SKIPPED and the run reported "cancelled"
# rather than "failure", so a red-looking-green push carried no test gate at all.
# Dependency-audit network latency must never be able to starve the gates that
# actually test the code.
#
# A timeout FAILS this gate (below) rather than passing it. That direction is
# deliberate: this is a security gate, and a security gate that silently no-ops when
# the registry is slow is worse than one that occasionally blocks a push. The retries
# and the generous bound are what keep that rare.
# 300s, not 60s: measured 2m01s for a single legitimate `npm audit --omit=dev` on
# 2026-09-04 while the registry was degraded. The bound exists to stop a hang from
# eating the job, not to police normal latency — set it well clear of a real call.
AUDIT_TIMEOUT_S="${AUDIT_TIMEOUT_S:-300}"
AUDIT_FETCH_OPTS="--fetch-timeout=60000 --fetch-retries=2 --fetch-retry-maxtimeout=15000"

# `timeout` is GNU coreutils: present on CI (ubuntu) and on macOS only as `gtimeout`
# if coreutils is installed. Fall back to an unbounded call rather than failing on a
# machine that has neither — the npm --fetch-* bounds above still apply there.
bounded_audit() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$AUDIT_TIMEOUT_S" npm audit $AUDIT_FETCH_OPTS "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$AUDIT_TIMEOUT_S" npm audit $AUDIT_FETCH_OPTS "$@"
  else
    npm audit $AUDIT_FETCH_OPTS "$@"
  fi
}

# --json is stable across npm 7+; parse the metadata.vulnerabilities rollup.
# --omit=dev restricts this to the shipped tree (see SCOPE above).
OUTPUT="$(bounded_audit --omit=dev --json 2>/dev/null)"
AUDIT_STATUS=$?

# 124 is `timeout`'s kill code. npm audit itself exits non-zero merely because
# advisories EXIST, so a non-124 failure with parseable JSON is normal and is handled
# by the COUNT check below.
if [ "$AUDIT_STATUS" -eq 124 ]; then
  echo "❌ npm-audit ratchet FAILED: \`npm audit --omit=dev\` did not return within ${AUDIT_TIMEOUT_S}s."
  echo ""
  echo "This is a BLOCKING security gate and it fails closed — a slow or unreachable npm"
  echo "registry must not be able to wave a dependency advisory through. It is also not"
  echo "allowed to eat the CI job budget: on 2026-09-04 an unbounded audit call did"
  echo "exactly that and every gate after it (Test, Build, Lint) was silently skipped."
  echo ""
  echo "If the registry is genuinely down, re-run the job. If it is chronically slow,"
  echo "raise AUDIT_TIMEOUT_S deliberately — do NOT remove the bound."
  exit 1
fi
COUNT="$(printf '%s' "$OUTPUT" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const v = (JSON.parse(s).metadata || {}).vulnerabilities || {};
      process.stdout.write(String((v.high || 0) + (v.critical || 0)));
    } catch {
      process.stdout.write("ERR");
    }
  });
')"

if [ "$COUNT" = "ERR" ] || [ -z "$COUNT" ]; then
  echo "❌ npm-audit ratchet: could not parse \`npm audit --json\` output (exit ${AUDIT_STATUS})."
  echo "   Empty output with a non-zero exit usually means the registry call failed rather"
  echo "   than that the tree is clean — this exits non-zero rather than reading it as 0."
  exit 2
fi

if [ "$COUNT" -gt "$BASELINE" ]; then
  echo "❌ npm-audit ratchet FAILED: $COUNT high+critical PRODUCTION advisory(ies), baseline is $BASELINE"
  echo ""
  bounded_audit --omit=dev --audit-level=high || true
  echo ""
  echo "A NEW high/critical advisory was introduced in the SHIPPED dependency tree."
  echo "Fix it (\`npm audit fix\`, or bump the offending dep). Do NOT raise BASELINE in"
  echo "scripts/npm-audit-ratchet.sh to paper over a regression, and do NOT widen the"
  echo "--omit=dev scope to make a production advisory look like a dev one. If the only"
  echo "fix is a semver-major upgrade and you are deferring it deliberately, that is a"
  echo "decision for docs/DECISIONS.md, not a silent baseline bump."
  exit 1
fi

echo "✅ npm-audit ratchet passed: $COUNT high+critical production advisory(ies) (baseline $BASELINE)."
echo "   (dev-tree advisories are reported, not gated — see the non-blocking full-tree step in CI.)"
exit 0
