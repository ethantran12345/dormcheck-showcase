#!/usr/bin/env bash
#
# Automated app bug-audit - Phase 1 web E2E crawl, end to end.
#
#   1. Ensure a LOCAL Supabase stack is running (never the prod project).
#   2. Generate .env.e2e from the local stack if it's missing (CI has no committed one).
#   3. Seed the two @pitt.edu test users.
#   4. Run the Playwright crawl + write flows headless.
#   5. Aggregate the per-page records into docs/audits/app-bug-audit-report/index.md.
#
# Usage:  npm run audit:app
#         CI=1 npm run audit:app      # same, headless (Playwright is always headless here)
#         AUDIT_LAYOUT=1 npm run audit:app
#             layout mode: the crawl at 390x844 / 360x780 / 1440x900, light + dark,
#             one zh pass and one un-acknowledged legal-notice pass, with the cut-off
#             detectors on (e2e/lib/layout.ts) and long-content seed data. Same
#             stack, same port, same report; only the Playwright projects differ
#             (e2e/playwright.layout.config.ts). Takes about 35 minutes.
#         AUDIT_JOURNEYS=1 npm run audit:app
#             journey mode: the no-dead-end sweep (inventory §4/§5), the existing
#             flow specs plus e2e/journeys.*.spec.ts at 390 and 1440, recorded per
#             contract point into $REPORT_DIR/journeys/ (e2e/playwright.journeys.config.ts).
#
# Exit code is the Playwright exit code, so CI fails when the crawl finds a
# crash-class (hard) finding. Quality findings are reported but don't fail the run.
#
# TRUSTWORTHINESS (queue item 8c). This script must never hand back a number it
# did not just measure. Two properties enforce that, and both are replayed by
# src/test/auditHarnessTrust.test.ts:
#   · it REFUSES before doing anything if :8123 is occupied, because an occupied
#     port means the crawl cannot run;
#   · it PURGES the previous report and records before the crawl, so a run that
#     dies for any other reason leaves nothing behind to be mistaken for current,
#     and it only builds a report if the crawl actually produced records.
# The old script errored, continued, and reprinted the last run's report as
# current — a failure biased toward "we're done", which is the dangerous
# direction.
set -euo pipefail
cd "$(dirname "$0")/../.."

ENV_FILE=".env.e2e"
# 8123 by default, overridable with AUDIT_PORT. The dedicated port is the safety
# property (never reuse a `npm run dev` pointed at prod); 8123 specifically is
# not. With several lanes live at once a single hard-coded port makes them
# serialise: the refusal below is correct, but it left the second lane with no
# way to run at all. Exported so playwright.config.ts reads the SAME value —
# script, dev server and baseURL cannot drift apart.
PORT="${AUDIT_PORT:-8123}"
export AUDIT_PORT="$PORT"
REPORT_DIR="docs/audits/app-bug-audit-report"

echo "→ [0/5] Checking the audit port (:$PORT) is free…"
node scripts/e2e/require-free-port.mjs "$PORT"
echo "  free."

# Stamp the run. Every record carries these, and build-report.mjs refuses to
# render a record set whose SHA is not HEAD.
export AUDIT_RUN_SHA="$(git rev-parse HEAD)"
export AUDIT_RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  run stamp: $AUDIT_RUN_SHA @ $AUDIT_RUN_STARTED_AT"

# Purge last run's output BEFORE crawling. If this run dies, there is no stale
# report left to be read as current — the absence of a report is the honest
# signal that no measurement exists.
rm -rf "$REPORT_DIR/records" "$REPORT_DIR/journeys"
rm -f "$REPORT_DIR/index.md" "$REPORT_DIR/a11y-summary.json"

echo "→ [1/5] Ensuring local Supabase stack is up…"
# config.toml is gitignored by this repo, so generate it on first run (CI + fresh clones).
if [ ! -f supabase/config.toml ]; then
  echo "  no supabase/config.toml - running supabase init…"
  printf 'n\nn\n' | npx supabase init >/dev/null 2>&1 || npx supabase init || true
fi
if ! npx supabase status >/dev/null 2>&1; then
  echo "  starting local stack (supabase start -x studio)…"
  # Exclude Studio (+ its deps) - it's only the web dashboard, which a headless
  # crawl never touches, and its container is flaky to health-check on some
  # machines: a plain `supabase start` that finds Studio unhealthy tears the
  # WHOLE stack back down (Stopping containers…), so the audit can never start.
  # -x studio brings up just the DB/Auth/Storage/API the crawl actually needs.
  npx supabase start -x studio
else
  echo "  already running."
fi

echo "→ [2/5] Resolving test env ($ENV_FILE)…"
if [ ! -f "$ENV_FILE" ]; then
  echo "  $ENV_FILE missing - generating from local stack status."
  # supabase status -o env emits API_URL / ANON_KEY / SERVICE_ROLE_KEY for the local stack.
  # Keep only KEY="value" lines (drop CLI update notices) and prefix with SB_.
  eval "$(npx supabase status -o env 2>/dev/null | grep -E '^[A-Z_]+=' | sed 's/^/SB_/')"
  cat > "$ENV_FILE" <<EOF
VITE_SUPABASE_URL=${SB_API_URL}
VITE_SUPABASE_ANON_KEY=${SB_ANON_KEY}
VITE_MAPBOX_TOKEN=pk.e2e.dummy
VITE_SITE_URL=http://localhost:${PORT}
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE_ROLE_KEY}
E2E_USER_EMAIL=e2e+user@pitt.edu
E2E_USER_PASSWORD=E2eUser!Passw0rd
E2E_ADMIN_EMAIL=e2e+admin@pitt.edu
E2E_ADMIN_PASSWORD=E2eAdmin!Passw0rd
EOF
else
  echo "  using existing $ENV_FILE."
fi

echo "→ [3/5] Applying all migrations on a clean slate (db reset) + seeding…"
# A plain `supabase start` can leave the migration chain partially applied when a
# stale linked-project history exists (.temp). `db reset` re-runs every migration
# from scratch, guaranteeing the test schema matches HEAD and giving each audit a
# deterministic, empty DB. Then seed the two @pitt.edu test users.
npx supabase db reset --local
node scripts/e2e/seed-test-users.mjs
LAYOUT_ARGS=()
if [ "${AUDIT_LAYOUT:-0}" = "1" ]; then
  export AUDIT_LONG_CONTENT=1
  LAYOUT_ARGS=(--config e2e/playwright.layout.config.ts)
  echo "  layout mode: long-content seed + e2e/playwright.layout.config.ts"
elif [ "${AUDIT_JOURNEYS:-0}" = "1" ]; then
  # The journey sweep's own projects only: the regress-* projects in the same
  # config are per-lane fix tests (run them with --project=regress-390 etc.).
  # Long content is seeded so those can also run against this stack on demand.
  export AUDIT_LONG_CONTENT=1
  LAYOUT_ARGS=(--config e2e/playwright.journeys.config.ts --project=setup --project=api --project=authflows --project=user --project=journeys-390 --project=journeys-1440)
  echo "  journey mode: e2e/playwright.journeys.config.ts"
fi
# Seed real content (dorms, checklist, marketplace, roommate) so authed surfaces
# render populated states instead of empty ones — otherwise the crawl can't tell
# a broken screen from a legitimately-empty one.
node scripts/e2e/seed-content.mjs

echo "→ [4/5] Running Playwright crawl + flows…"
# A11y ratchet (2026-07): the app crawls clean of axe critical/serious WCAG 2.1 AA
# violations, so they now hard-fail (P0) by default to prevent regressions.
# Override with A11Y_STRICT=0 to triage, or A11Y=0 to skip axe entirely.
# Layout mode reports axe findings at P1 instead (dark-mode contrast has never
# been measured, so the first run is a triage list, not a ratchet).
if [ "${AUDIT_LAYOUT:-0}" = "1" ]; then
  export A11Y_STRICT="${A11Y_STRICT:-0}"
else
  export A11Y_STRICT="${A11Y_STRICT:-1}"
fi
set +e
npx playwright test ${LAYOUT_ARGS[@]+"${LAYOUT_ARGS[@]}"} "$@"
PW_EXIT=$?
set -e

echo "→ [5/5] Building report…"
if [ "${AUDIT_JOURNEYS:-0}" = "1" ]; then
  # Same fail-closed rule as the crawl: no journey records means nothing ran.
  if [ -z "$(ls "$REPORT_DIR/journeys"/*@*.json 2>/dev/null)" ]; then
    echo "✗ The journey sweep produced NO records — it did not execute. No report was written." >&2
    exit 1
  fi
  node scripts/e2e/build-journey-report.mjs
  echo "Report: $REPORT_DIR/journeys.md"
  exit $PW_EXIT
fi
# The crawl writes one record per page visit. Zero records means it never got to
# a single page (webServer failed, auth setup died, config error) — there is
# nothing to report on, and saying so is the whole point of this item.
if [ ! -d "$REPORT_DIR/records" ] || [ -z "$(ls -A "$REPORT_DIR/records" 2>/dev/null)" ]; then
  echo ""
  echo "✗ The crawl produced NO records — it did not execute. No report was written." >&2
  echo "  Playwright exit was $PW_EXIT; see playwright-report/index.html for why." >&2
  exit 1
fi

# No `|| true` here: build-report.mjs is a gate now. If it refuses the record set
# (stale SHA, mixed provenance), that refusal must fail the run rather than be
# swallowed while the script goes on to print a report path that does not exist.
node scripts/e2e/build-report.mjs

echo ""
echo "Report: $REPORT_DIR/index.md"
echo "Playwright HTML report: playwright-report/index.html  (npx playwright show-report)"
exit $PW_EXIT
