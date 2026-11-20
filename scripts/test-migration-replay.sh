#!/usr/bin/env bash
# Replay-safety gate for 20260731040000_student_setups_hidden_and_reports.sql.
# Usage: npm run test:migration-replay   (local Supabase stack must be running)
#
# WHY THIS EXISTS, AND WHY A PLAIN `supabase db reset` CANNOT REPLACE IT.
#
# The bug this guards against is CHECK-constraint drift: a migration that DROPs
# and re-ADDs chk_content_type while listing fewer values than the database is
# supposed to hold, silently deleting the missing ones.
#
# A full `db reset` CANNOT catch that for this file. Reset runs migrations in
# filename order, so 20260816000000_community_phase1.sql runs AFTER the target
# and re-widens chk_content_type to the full 7 values. A post-reset assertion
# therefore passes even when the target migration is still broken at 6 — the
# later migration papers over the defect. That was a real hole in the first draft
# of this work (`git show 5805ac87:docs/tasks/PLAN.md`, round 1 of the review).
#
# The only arrangement in which the drift is observable is: reset to HEAD, THEN
# replay the target file on top, THEN assert. That is what this script does.
#
# It asserts EXACT SET EQUALITY, not "at least these values". A lower-bound
# assertion would pass with 'student_review' readmitted — the retired value that
# teardown_student_reviews deliberately removed — which is the same class of bug
# in the opposite direction. Both directions are checked.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="supabase/migrations/20260731040000_student_setups_hidden_and_reports.sql"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# NEVER let this point at a remote project: the script deliberately re-executes a
# migration and inserts rows. Refuse anything that is not a loopback host.
host="$(printf '%s' "$DB_URL" | sed -E 's#^[^:]+://([^@]*@)?([^:/]+).*#\2#')"
case "$host" in
  127.0.0.1|localhost|::1|db|supabase_db_*) ;;
  *)
    echo "❌ refusing to run against non-local host '${host}'. This script replays a" >&2
    echo "   migration and writes rows; it is for the local stack only." >&2
    exit 1
    ;;
esac

# Host psql when available, otherwise docker exec into the local Supabase db
# container — same fallback as scripts/test-db.sh, because this machine routinely
# has no host psql.
CONTAINER=""
if ! command -v psql >/dev/null 2>&1; then
  CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
  if [ -z "$CONTAINER" ]; then
    echo "❌ No host psql and no running supabase_db_* container. Start the stack: npx supabase start" >&2
    exit 1
  fi
fi

psql_q() { # scalar query
  if [ -n "$CONTAINER" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtAX -c "$1"
  else
    psql "$DB_URL" -v ON_ERROR_STOP=1 -qtAX -c "$1"
  fi
}

psql_f() { # run a file
  if [ -n "$CONTAINER" ]; then
    docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - <"$1"
  else
    psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"
  fi
}

echo "▸ 1/4  supabase db reset (schema at HEAD)"
npx supabase db reset >/dev/null

echo "▸ 2/4  replaying $TARGET on top of HEAD"
# No schema_migrations row is written. The point is to SIMULATE a replay, not to
# record one — bookkeeping must be identical before and after this script.
before="$(psql_q "select count(*) from supabase_migrations.schema_migrations")"
psql_f "$TARGET"
after="$(psql_q "select count(*) from supabase_migrations.schema_migrations")"
if [ "$before" != "$after" ]; then
  echo "❌ replay changed schema_migrations bookkeeping ($before -> $after)" >&2
  exit 1
fi

echo "▸ 3/4  asserting chk_content_type is exactly the authorized set and validated"
out="$(psql_f supabase/tests/content_type_check_drift.test.sql)"
echo "$out"
if printf '%s' "$out" | grep -qE '(^|[[:space:]])FAIL'; then
  echo "❌ drift probe printed a FAIL assertion" >&2
  exit 1
fi

echo "▸ 4/4  asserting one get_setups_preview overload and is_hidden present"
overloads="$(psql_q "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_setups_preview'")"
[ "$overloads" = "1" ] || { echo "❌ expected 1 get_setups_preview overload, found $overloads" >&2; exit 1; }
hidden="$(psql_q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'student_setups' and column_name = 'is_hidden'")"
[ "$hidden" = "1" ] || { echo "❌ student_setups.is_hidden missing after replay" >&2; exit 1; }

echo "✅ replay-safe: the target migration can run twice without narrowing chk_content_type"

# LEAVE THE STACK AT HEAD. Step 2 replayed a 2026-07-31 file on top of the schema, and
# that file re-creates rls_student_setups_update_admin with the pre-20261005000000
# `is_admin` predicate — correct for the drift assertion above, wrong as a state to
# leave behind. On 2026-09-06 a `npm run test:db` run straight after this gate went red
# on is_admin_tier_collapse.test.sql §0 for exactly that reason: it was probing the
# replayed schema, not HEAD. A gate that mutates the shared local stack must put it back.
echo "▸ 5/5  supabase db reset (leave the stack at HEAD, not at the replayed state)"
npx supabase db reset >/dev/null
echo "✅ stack restored to HEAD"
