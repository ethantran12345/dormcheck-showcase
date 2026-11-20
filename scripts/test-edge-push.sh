#!/usr/bin/env bash
# Edge Function gate #2: drive the DEPLOYED send-push against the local stack and
# assert WHOSE DEVICE it reached.
#
# WHY THIS EXISTS
# ---------------
# send-push is the single choke point every notification in the product converges
# on — the Vercel /api senders and the private.dispatch_push() DB triggers all POST
# it — and it ended in an unbounded loop over device_tokens with zero automated
# coverage. A scoping defect there puts one student's notification on another
# student's lock screen. It cannot be recalled, push is live on iOS and Android,
# and NO screen in the app would show it: the function reports counts and redacted
# token prefixes, so "2 sent" and "2 sent to the wrong students" look identical.
#
# WHY NOT scripts/test-db.sh. That runner is a psql dispatcher — every one of its
# probes talks to Postgres directly, and it says so in its own header. The bug
# class here is CALLER-SIDE: the table, its RLS and its indexes are all correct;
# the question is which rows the function asked for. Only something that drives the
# function over HTTP can tell those apart.
#
# WHY ITS OWN RUNNER next to scripts/test-edge.sh rather than a flag on it. The two
# need incompatible edge runtimes: moderate-listing is client-called and is served
# with JWT verification ON, send-push is deployed verify_jwt:false and its bearer
# check IS its entire gate, so it must be served with --no-verify-jwt to mean what
# it means in prod. One `functions serve` cannot be both. They share the stack
# sequentially, never concurrently.
#
# Usage (needs a running local stack — it starts and resets nothing):
#   bash scripts/test-edge-push.sh            # drive the current code, expect green
#   bash scripts/test-edge-push.sh --mutate   # unscope the fan-out, expect RED
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

MUTATE=0
[ "${1:-}" = "--mutate" ] && MUTATE=1

STUB_CONTAINER="dc-push-probe-stub"
STUB_PORT=8788
STUB_HOST_PORT=8788
SERVE_LOG="$(mktemp -t dc-push-serve.XXXXXX)"
ENV_FILE="$(mktemp -t dc-push-env.XXXXXX)"
SERVE_PID=""
PROJECT_ID=""
DB_CONTAINER=""
PREV_PUSH_CFG=""
PUSH_CFG_SEEDED=0

# The shared bearer send-push checks, and the value seeded into private.push_config
# so the DB trigger path presents the same one. Local-only, regenerated nowhere:
# this is the probe's own token, never a real environment's.
PUSH_AUTH_TOKEN="dcpush-probe-shared-token"
PROBE_DORM="DCPUSH Probe Hall"

psql_q() {
  docker exec -e PGPASSWORD=postgres -i "$DB_CONTAINER" \
    psql -U supabase_admin -d postgres -tA -c "$1" 2>/dev/null
}
psql_x() {
  docker exec -e PGPASSWORD=postgres -i "$DB_CONTAINER" \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -c "$1"
}

cleanup() {
  local rc=$?
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  docker rm -f "$STUB_CONTAINER" >/dev/null 2>&1 || true
  # Take the edge runtime down too. Killing `functions serve` does NOT stop its
  # container, and what it leaves behind is wired to the stub we just deleted AND
  # served with JWT verification off — leaving that running on a shared local stack
  # would be worse than leaving none. `supabase start` / `functions serve`
  # recreates it on demand.
  [ -n "$PROJECT_ID" ] && docker rm -f "supabase_edge_runtime_${PROJECT_ID}" >/dev/null 2>&1 || true
  # Put private.push_config back exactly as we found it. It is normally EMPTY on a
  # local stack, but if someone had seeded it (in the worst case pointing at PROD),
  # silently deleting or keeping our local override would both be wrong.
  if [ "$PUSH_CFG_SEEDED" = "1" ] && [ -n "$DB_CONTAINER" ]; then
    if [ -n "$PREV_PUSH_CFG" ]; then
      local prev_url="${PREV_PUSH_CFG%%$'\t'*}"
      local prev_tok="${PREV_PUSH_CFG#*$'\t'}"
      psql_x "update private.push_config set supabase_url = '${prev_url}', send_push_token = '${prev_tok}' where id;" >/dev/null 2>&1 || true
    else
      psql_x "delete from private.push_config where id;" >/dev/null 2>&1 || true
    fi
  fi
  # ALWAYS restore, including on ^C or a mid-run failure. A mutated index.ts left on
  # disk is a booby trap for the next agent — and for lane:ship.
  node scripts/edge-probe/mutate-send-push.mjs restore >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  [ $rc -ne 0 ] && [ -s "$SERVE_LOG" ] && {
    echo "── last 40 lines of \`supabase functions serve\` ──" >&2
    tail -40 "$SERVE_LOG" >&2
  }
  rm -f "$SERVE_LOG"
  return $rc
}
trap cleanup EXIT INT TERM

# ── 1. the stack must already be up; this runner does not start or reset it ───
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
if [ -z "$DB_CONTAINER" ]; then
  echo "❌ No running supabase_db_* container. Start the stack first:" >&2
  echo "     npx supabase start -x studio" >&2
  echo "   (-x studio is REQUIRED: Studio segfaults and the CLI tears down the healthy stack with it.)" >&2
  exit 1
fi
PROJECT_ID="${DB_CONTAINER#supabase_db_}"
NETWORK="supabase_network_${PROJECT_ID}"
KONG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 "^supabase_kong_${PROJECT_ID}\$" || echo "supabase_kong_${PROJECT_ID}")"
echo "▸ stack: project '$PROJECT_ID' on docker network '$NETWORK'"

# ── 2. schema preflight ───────────────────────────────────────────────────────
# Same lesson test-db.sh learned the hard way: a probe run against a schema that
# predates what it asserts fails in the most misleading way available. Name each
# missing piece directly instead of letting a dozen cases go red pointing at the
# function.
require_sql() {
  local label="$1" query="$2" hint="$3"
  if [ "$(psql_q "$query")" != "1" ]; then
    echo "❌ $label is missing from this database." >&2
    echo "   $hint" >&2
    echo "     npx supabase migration up --local     # or: npx supabase db reset  (DESTROYS local data)" >&2
    exit 1
  fi
}
require_sql "public.device_tokens" \
  "select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='device_tokens'" \
  "It is the table whose scoping this gate exists to prove."
require_sql "the pg_net extension" \
  "select 1 from pg_extension where extname='pg_net'" \
  "The trigger phase dispatches through net.http_post; without it that phase is silently dead."
require_sql "private.push_config" \
  "select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname='push_config'" \
  "private.dispatch_push() reads it to find the function URL and shared token."
require_sql "trg_notify_building_new_resident" \
  "select 1 from pg_trigger where tgname='trg_notify_building_new_resident'" \
  "It is the real production path this gate drives end to end."
require_sql "profiles.quiet_hours_enabled" \
  "select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='quiet_hours_enabled'" \
  "Quiet hours are evaluated inside send-push; without the column the case is meaningless."

# ── 3. local credentials, read from the CLI rather than a checked-in file ─────
# CI installs the CLI as a binary via supabase/setup-cli; locally it comes from
# node_modules via npx. Resolve both — `npx --no-install` alone fails on the runner.
if command -v supabase >/dev/null 2>&1; then
  SUPABASE_CLI=(supabase)
else
  SUPABASE_CLI=(npx --no-install supabase)
fi
eval "$("${SUPABASE_CLI[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
if [ -z "${API_URL:-}" ] || [ -z "${SERVICE_ROLE_KEY:-}" ]; then
  echo "❌ Could not read API_URL / SERVICE_ROLE_KEY from \`supabase status\`." >&2
  # Almost always this one thing, and the raw CLI error ("No such container:
  # supabase_db_<lane-name>") points at the wrong culprit entirely.
  if [ ! -f supabase/config.toml ]; then
    echo "   supabase/config.toml is MISSING from this worktree — and it is GITIGNORED," >&2
    echo "   so no lane worktree ever has it. Without it the CLI derives the project id" >&2
    echo "   from the DIRECTORY NAME ('$(basename "$REPO")') and looks for a container" >&2
    echo "   called supabase_db_$(basename "$REPO"), while the stack that IS running" >&2
    echo "   belongs to project '$PROJECT_ID'. Copy it in from the main checkout:" >&2
    echo "     cp the repo root/supabase/config.toml supabase/config.toml" >&2
    echo "   It cannot be committed by accident (gitignored), and CI is unaffected —" >&2
    echo "   the checkout directory there is already named after the repo." >&2
  fi
  exit 1
fi

# send-push is deployed with verify_jwt:false — its bearer check is the ENTIRE gate.
# Serving it with verification on would make the probe's auth cases assert Kong's
# behaviour instead of the function's, which is the opposite of the point.
if ! "${SUPABASE_CLI[@]}" functions serve --help 2>&1 | grep -q -- '--no-verify-jwt'; then
  echo "❌ this Supabase CLI has no \`functions serve --no-verify-jwt\`." >&2
  echo "   send-push runs verify_jwt:false in prod; serving it any other way would make" >&2
  echo "   the auth verdicts here meaningless. Add [functions.send-push] verify_jwt = false" >&2
  echo "   to supabase/config.toml and update this runner." >&2
  exit 1
fi

# ── 4. the vendor stub, ON THE SUPABASE NETWORK ──────────────────────────────
# Container-to-container by name, NOT host.docker.internal: that name resolves on
# Docker Desktop but not on a stock Linux CI runner, and this gate has to mean the
# same thing in both places. The port is also published so the probe (on the host)
# can read /__hits — which is the only place the full recipient list is visible.
docker rm -f "$STUB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm \
  --name "$STUB_CONTAINER" \
  --network "$NETWORK" \
  -p "127.0.0.1:${STUB_HOST_PORT}:${STUB_PORT}" \
  -e "STUB_PORT=${STUB_PORT}" \
  -v "${REPO}/scripts/edge-probe:/probe:ro" \
  -w /probe \
  node:22-alpine node stub-push-vendors.mjs >/dev/null

STUB_HOST_URL="http://127.0.0.1:${STUB_HOST_PORT}"
for _ in $(seq 1 40); do
  curl -fsS "${STUB_HOST_URL}/__health" >/dev/null 2>&1 && break
  sleep 0.25
done
curl -fsS "${STUB_HOST_URL}/__health" >/dev/null || {
  echo "❌ vendor stub did not come up on ${STUB_HOST_URL}" >&2
  docker logs "$STUB_CONTAINER" 2>&1 | tail -20 >&2
  exit 1
}
echo "▸ vendor stub up (container '${STUB_CONTAINER}' on ${NETWORK}, host ${STUB_HOST_URL})"

# ── 5. point the DB dispatcher at THIS stack ─────────────────────────────────
# private.dispatch_push() reads the function URL out of private.push_config, which
# is seeded by hand per environment and is normally empty locally. Point it at this
# stack's Kong (by container name — the DB reaches it on the docker network, not on
# 127.0.0.1), and restore whatever was there on the way out.
PREV_PUSH_CFG="$(psql_q "select supabase_url || E'\t' || send_push_token from private.push_config where id" || true)"
psql_x "insert into private.push_config (id, supabase_url, send_push_token)
        values (true, 'http://${KONG_CONTAINER}:8000', '${PUSH_AUTH_TOKEN}')
        on conflict (id) do update
          set supabase_url = excluded.supabase_url,
              send_push_token = excluded.send_push_token;" >/dev/null
PUSH_CFG_SEEDED=1
echo "▸ private.push_config -> http://${KONG_CONTAINER}:8000 (restored on exit)"

# ── 6. optionally unscope the fan-out ────────────────────────────────────────
if [ "$MUTATE" = "1" ]; then
  echo "▸ MUTATION RUN — dropping the user_id filter from the device_tokens query."
  node scripts/edge-probe/mutate-send-push.mjs apply
fi

# ── 7. serve the functions ───────────────────────────────────────────────────
# The APNs/FCM credentials are generated fresh per run and live only in this temp
# file; the *_URL vars redirect every call they would authenticate to the stub.
cat >"$ENV_FILE" <<EOF
SEND_PUSH_AUTH_TOKEN=${PUSH_AUTH_TOKEN}
APNS_KEY_ID=DCPUSHKEYID1
APNS_TEAM_ID=DCPUSHTEAM1
APNS_BUNDLE_ID=com.dormcheck.probe
APNS_HOST_URL=http://${STUB_CONTAINER}:${STUB_PORT}
FCM_BASE_URL=http://${STUB_CONTAINER}:${STUB_PORT}
GOOGLE_OAUTH_TOKEN_URL=http://${STUB_CONTAINER}:${STUB_PORT}/oauth2/token
EOF
node scripts/edge-probe/gen-push-probe-keys.mjs >>"$ENV_FILE"

FN_URL="${API_URL}/functions/v1/send-push"
probe_code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$FN_URL" 2>/dev/null || echo 000; }
# "Serving" means the FUNCTION answered — it refuses an unauthenticated POST with a
# 401. Not just "the port is open": Kong sits in front and stays up after the edge
# runtime is gone, answering 5xx. Treating that as reachable is what let a stale
# runtime look alive; treating it as a connection error is what made the teardown
# wait time out. Both directions key off this one predicate.
fn_is_serving() {
  local c
  c="$(probe_code)"
  [ "$c" != "000" ] && [ "$c" -lt 500 ]
}

# TEAR THE OLD RUNTIME DOWN FIRST, AND WAIT FOR IT TO GO.
#
# THIS IS LOAD-BEARING — it is the difference between a gate and a lie. `supabase
# start` and `supabase functions serve` share ONE container per project, and it
# outlives a killed serve. Without this, the readiness poll below is satisfied by
# the PREVIOUS run's runtime, still serving the PREVIOUS copy of the source. That
# was observed on the moderate-listing gate: a --mutate run reported "MUTATION
# SURVIVED" purely because the mutated file never reached a runtime — the probe was
# talking to the un-mutated code from the clean run seconds earlier. A green from
# that state means nothing. It bites twice as hard here, because the runtime this
# runner needs also differs in its JWT setting from the one the other gate leaves
# behind.
EDGE_CONTAINER="supabase_edge_runtime_${PROJECT_ID}"
docker rm -f "$EDGE_CONTAINER" >/dev/null 2>&1 || true
for _ in $(seq 1 60); do
  fn_is_serving || break
  sleep 0.25
done
if fn_is_serving; then
  echo "❌ something is STILL serving $FN_URL after removing '$EDGE_CONTAINER'." >&2
  echo "   Refusing to run: the probe could not prove it is driving this worktree's code." >&2
  exit 1
fi

"${SUPABASE_CLI[@]}" functions serve --env-file "$ENV_FILE" --no-verify-jwt >"$SERVE_LOG" 2>&1 &
SERVE_PID=$!

for _ in $(seq 1 120); do
  fn_is_serving && break
  kill -0 "$SERVE_PID" 2>/dev/null || { echo "❌ \`supabase functions serve\` exited early." >&2; exit 1; }
  sleep 0.5
done
fn_is_serving || {
  echo "❌ send-push never became reachable at $FN_URL (last code: $(probe_code))" >&2
  exit 1
}
echo "▸ edge runtime serving send-push, freshly started (unauthenticated POST -> $(probe_code))"

# Prove the bearer gate before the mutation's intentionally unbounded fan-out can
# load or poison the runtime. The old harness checked auth only near the end of
# the full probe; a correctly caught scoping mutation could make that later request
# time out with a gateway 504, misclassifying a useful red run as broken.
if [ "$MUTATE" = "1" ]; then
  AUTH_BODY='{"user_id":"00000000-0000-4000-8000-000000000000","title":"DCPUSH_AUTH_PREFLIGHT","body":"x"}'
  NO_AUTH_CODE="$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$AUTH_BODY" "$FN_URL" || echo 000)"
  WRONG_AUTH_CODE="$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Authorization: Bearer not-the-shared-token' --data "$AUTH_BODY" "$FN_URL" || echo 000)"
  ANON_AUTH_CODE="$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H "Authorization: Bearer ${ANON_KEY}" --data "$AUTH_BODY" "$FN_URL" || echo 000)"
  if [ "$NO_AUTH_CODE" != "401" ] || [ "$WRONG_AUTH_CODE" != "401" ] || [ "$ANON_AUTH_CODE" != "401" ]; then
    echo "❌ mutation auth preflight failed (none=$NO_AUTH_CODE wrong=$WRONG_AUTH_CODE anon=$ANON_AUTH_CODE)." >&2
    echo "   The bearer gate must be healthy before the scoping mutation is driven." >&2
    exit 1
  fi
  echo "✓ mutation auth preflight: missing, wrong and anon-key bearers all refused with 401"
fi

# ── 8. drive it ──────────────────────────────────────────────────────────────
# MIN_VERDICTS mirrors test-db.sh's row-count assertion. Silence is not success — a
# fixture that stops matching must go red, not quiet. Bump this ONLY in the commit
# that changes the case table on purpose.
MIN_VERDICTS=38
set +e
OUT="$(SUPABASE_API_URL="$API_URL" \
  SUPABASE_ANON_KEY="$ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  STUB_HOST_URL="$STUB_HOST_URL" \
  SEND_PUSH_AUTH_TOKEN="$PUSH_AUTH_TOKEN" \
  PROBE_DORM="$PROBE_DORM" \
  node scripts/edge-probe/send-push.probe.mjs 2>&1)"
PROBE_RC=$?
set -e
echo "$OUT"

# The scoping verdicts the mutation MUST break. Each one is a sentence that is only
# false when a notification reached the wrong student.
REQUIRED_RED=(
  "scope/self: delivered set is exactly the addressed user's tokens"
  "scope/self: no other student's device token was reached"
  "scope/isolation: a push for B reached only B"
  "scope/tenant: a CMU push reached only the CMU device"
  "scope/nobody: an unknown user reached no device at all"
  "scope/trigger: the resident who blocked the joiner received nothing"
  "scope/trigger: the other tenant's resident received nothing"
  "scope/trigger: the joiner was not pushed their own arrival"
)

if [ "$MUTATE" = "1" ]; then
  # The mutation check inverts the meaning of the exit code: the probe MUST fail,
  # and it must fail on the SCOPING verdicts specifically. A red for any other
  # reason (stack down, fixture drift, a stub that never came up) would otherwise
  # read as a successful mutation test.
  node scripts/edge-probe/mutate-send-push.mjs restore
  if [ "$PROBE_RC" -eq 0 ]; then
    echo "❌ MUTATION SURVIVED. The fan-out was unscoped and the probe still passed." >&2
    echo "   The probe does not actually cover the bug it was written for." >&2
    exit 1
  fi
  for label in "${REQUIRED_RED[@]}"; do
    printf '%s\n' "$OUT" | grep -qF "FAIL: $label" || {
      echo "❌ MUTATION test is not specific: expected a FAIL line for" >&2
      echo "     $label" >&2
      echo "   The probe went red, but not for the reason the mutation causes." >&2
      exit 1
    }
  done
  echo "✓ mutation CAUGHT: every cross-user / cross-tenant / blocked-recipient verdict"
  echo "  went red after the bearer gate passed its isolated preflight. index.ts restored."
  exit 0
fi

[ "$PROBE_RC" -ne 0 ] && { echo "❌ send-push probe failed (exit $PROBE_RC)." >&2; exit 1; }

SEEN="$(printf '%s\n' "$OUT" | grep -cE '(^|[[:space:]])PASS([^[:alnum:]_]|$)' || true)"
if [ "$SEEN" -lt "$MIN_VERDICTS" ]; then
  echo "❌ probe printed $SEEN PASS verdict(s), expected at least $MIN_VERDICTS." >&2
  echo "   Nothing failed and the driver exited 0 — verdict rows went MISSING, which means" >&2
  echo "   assertions never ran (drifted fixture / renamed column / a case that returned early)." >&2
  exit 1
fi

echo "✓ edge gate passed: send-push driven across direct fan-out, cross-tenant, blocked"
echo "  recipients, stale-token eviction, the bearer gate and the live trigger path ($SEEN verdicts)"
