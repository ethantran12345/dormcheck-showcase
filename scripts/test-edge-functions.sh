#!/usr/bin/env bash
# Edge Function gate for the SIX functions no other runner drives: admin-metrics,
# delete-user-account, export-user-data, fetch-link-preview, send-auth-email and
# moderate-image (BA-09, docs/audits/backend-audit-2026-09-06.md).
#
# Same discipline as scripts/test-edge.sh (moderate-listing) and scripts/test-edge-push.sh
# (send-push): a live local stack, the real edge runtime through Kong, real GoTrue tokens,
# real PostgREST/Storage writes, and ONLY the paid vendors (OpenAI, Resend) stubbed.
#
# TWO SERVES, because one cannot mean both things. fetch-link-preview and moderate-image
# are gated at the gateway (verify_jwt = true in their config.toml), so their "no token →
# 401" verdict has to come from Kong, with verification ON. The other four are deployed
# verify_jwt:false and verify the token in-function, so they are served with
# --no-verify-jwt exactly as send-push's gate does; serving them with verification on
# would make the auth verdicts assert Kong instead of the code.
#
# Usage (needs a running local stack — it starts and resets nothing):
#   bash scripts/test-edge-functions.sh
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

STUB_CONTAINER="dc-fn-probe-stub"
STUB_PORT=8789
STUB_HOST_PORT=8789
SERVE_LOG="$(mktemp -t dc-fn-serve.XXXXXX)"
ENV_FILE="$(mktemp -t dc-fn-env.XXXXXX)"
SERVE_PID=""
PROJECT_ID=""

# A hook secret that exists only for this run; the probe signs with the same bytes.
HOOK_SECRET_B64="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"

cleanup() {
  if [ -n "$SERVE_PID" ] && kill -0 "$SERVE_PID" 2>/dev/null; then
    kill "$SERVE_PID" 2>/dev/null || true
    wait "$SERVE_PID" 2>/dev/null || true
  fi
  # Killing `functions serve` does NOT stop its runtime container, and the second
  # phase served everything with JWT verification OFF — never leave that behind on a
  # shared local stack. `supabase start` / `functions serve` recreates it on demand.
  [ -n "$PROJECT_ID" ] && docker rm -f "supabase_edge_runtime_${PROJECT_ID}" >/dev/null 2>&1 || true
  docker rm -f "$STUB_CONTAINER" >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
  if [ "${1:-0}" != "0" ] && [ -s "$SERVE_LOG" ]; then
    echo "── last 40 lines of \`supabase functions serve\` ──" >&2
    tail -40 "$SERVE_LOG" >&2
  fi
  rm -f "$SERVE_LOG"
}
trap 'rc=$?; cleanup "$rc"; exit $rc' EXIT

# ── 1. the stack must already be up ───────────────────────────────────────────
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
if [ -z "$DB_CONTAINER" ]; then
  echo "❌ No running supabase_db_* container. Start the stack first: npx supabase start -x studio" >&2
  exit 1
fi
PROJECT_ID="${DB_CONTAINER#supabase_db_}"
NETWORK="supabase_network_${PROJECT_ID}"
echo "▸ stack: project '$PROJECT_ID' on docker network '$NETWORK'"

# ── 2. schema preflight: name what is missing instead of letting cases go red ──
psql_q() {
  docker exec -e PGPASSWORD=postgres -i "$DB_CONTAINER" psql -U postgres -d postgres -qtAX -c "$1" 2>/dev/null | tr -d '[:space:]'
}
require_sql() {
  local label="$1" query="$2"
  if [ "$(psql_q "$query")" != "1" ]; then
    echo "❌ $label is missing from this database. Apply the pending migrations:" >&2
    echo "     npx supabase migration up --local     # or: npx supabase db reset  (DESTROYS local data)" >&2
    exit 1
  fi
}
require_sql "the images-quarantine bucket (20261008000000)" \
  "select 1 from storage.buckets where id = 'images-quarantine' and public = false"
require_sql "moderation_actions.preserve_until (20261008000000)" \
  "select 1 from information_schema.columns where table_schema='public' and table_name='moderation_actions' and column_name='preserve_until'"
require_sql "admin_audit_log.actor_id ON DELETE SET NULL (20261007000000)" \
  "select 1 from pg_constraint where conname = 'admin_audit_log_actor_id_fkey' and confdeltype = 'n'"

# ── 3. local credentials, read from the CLI rather than a checked-in file ─────
if command -v supabase >/dev/null 2>&1; then SUPABASE_CLI=(supabase); else SUPABASE_CLI=(npx --no-install supabase); fi
eval "$("${SUPABASE_CLI[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
if [ -z "${API_URL:-}" ] || [ -z "${SERVICE_ROLE_KEY:-}" ] || [ -z "${ANON_KEY:-}" ]; then
  echo "❌ Could not read API_URL / ANON_KEY / SERVICE_ROLE_KEY from \`supabase status\`." >&2
  [ -f supabase/config.toml ] || echo "   supabase/config.toml is MISSING (gitignored) — copy it in from the main checkout." >&2
  exit 1
fi

# ── 4. the vendor stub, ON THE SUPABASE NETWORK ───────────────────────────────
docker rm -f "$STUB_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$STUB_CONTAINER" --network "$NETWORK" \
  -p "${STUB_HOST_PORT}:${STUB_PORT}" \
  -e "STUB_PORT=${STUB_PORT}" \
  -v "${REPO}/scripts/edge-probe:/probe:ro" \
  -w /probe \
  node:22-alpine node stub-vendor-api.mjs >/dev/null
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

# ── 5. the env every function needs; every vendor call redirected to the stub ──
cat >"$ENV_FILE" <<EOF
OPENAI_API_KEY=dcprobe-not-a-real-key
ANTHROPIC_API_KEY=dcprobe-not-a-real-key
OPENAI_MODERATIONS_URL=http://${STUB_CONTAINER}:${STUB_PORT}/v1/moderations
ANTHROPIC_MESSAGES_URL=http://${STUB_CONTAINER}:${STUB_PORT}/v1/messages
RESEND_API_KEY=dcprobe-not-a-real-key
RESEND_API_URL=http://${STUB_CONTAINER}:${STUB_PORT}/emails
SEND_EMAIL_HOOK_SECRET=v1,whsec_${HOOK_SECRET_B64}
ALLOWED_ORIGINS=http://localhost:8080
EOF
# delete-user-account skips its confirmation email when RESEND_API_KEY is unset; here it
# is set, so that path posts to the stub too, which is what we want driven.

EDGE_CONTAINER="supabase_edge_runtime_${PROJECT_ID}"
probe_code() { curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}/functions/v1/$1" 2>/dev/null || echo 000; }
fn_answers() { local c; c="$(probe_code "$1")"; [ "$c" != "000" ] && [ "$c" -lt 500 ]; }

# Tear down whatever runtime is there and wait until it is genuinely gone — the same
# load-bearing step the other two gates take (a stale runtime serves stale code).
stop_runtime() {
  if [ -n "$SERVE_PID" ] && kill -0 "$SERVE_PID" 2>/dev/null; then
    kill "$SERVE_PID" 2>/dev/null || true; wait "$SERVE_PID" 2>/dev/null || true; SERVE_PID=""
  fi
  docker rm -f "$EDGE_CONTAINER" >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do fn_answers "$1" || break; sleep 0.25; done
  if fn_answers "$1"; then
    echo "❌ something is STILL serving $1 after removing '$EDGE_CONTAINER'. Refusing to run." >&2
    exit 1
  fi
}
start_runtime() { # $1 = readiness function, $@ = extra serve flags
  local ready="$1"; shift
  "${SUPABASE_CLI[@]}" functions serve --env-file "$ENV_FILE" "$@" >"$SERVE_LOG" 2>&1 &
  SERVE_PID=$!
  for _ in $(seq 1 120); do
    fn_answers "$ready" && break
    kill -0 "$SERVE_PID" 2>/dev/null || { echo "❌ \`supabase functions serve\` exited early." >&2; exit 1; }
    sleep 0.5
  done
  fn_answers "$ready" || { echo "❌ $ready never became reachable (last code: $(probe_code "$ready"))" >&2; exit 1; }
}

PROBE_SEEN=0
run_probe() { # $1 = phase; prints the probe's output, leaves the PASS count in PROBE_SEEN
  set +e
  OUT="$(SUPABASE_API_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
    STUB_HOST_URL="$STUB_HOST_URL" PROBE_PHASE="$1" PROBE_HOOK_SECRET_B64="$HOOK_SECRET_B64" \
    node scripts/edge-probe/functions.probe.mjs 2>&1)"
  local rc=$?
  set -e
  echo "$OUT"
  if [ "$rc" -ne 0 ]; then echo "❌ functions probe ($1) failed (exit $rc)." >&2; exit 1; fi
  # Anchored to the line start: the probe's own "N PASS, M FAIL" summary line must not count.
  PROBE_SEEN="$(printf '%s\n' "$OUT" | grep -cE '^PASS ' || true)"
}

# ── 6. phase A: gateway verification ON (fetch-link-preview, moderate-image) ──
stop_runtime fetch-link-preview
start_runtime fetch-link-preview
echo "▸ edge runtime serving with JWT verification ON (unauthenticated probe -> $(probe_code fetch-link-preview))"
run_probe gateway; SEEN_A="$PROBE_SEEN"

# ── 7. phase B: --no-verify-jwt (admin-metrics, export, delete, send-auth-email) ─
stop_runtime admin-metrics
start_runtime admin-metrics --no-verify-jwt
echo "▸ edge runtime serving with JWT verification OFF (unauthenticated probe -> $(probe_code admin-metrics))"
run_probe nogateway; SEEN_B="$PROBE_SEEN"

# ── 8. the row-count assertion, as in every other gate ───────────────────────
# 23 gateway-phase verdicts + 20 no-gateway verdicts as of 2026-09-06, plus 5 for the
# moderate-image hold path and 2 for the dm-photos account purge (A2, 2026-10-12). Bump this ONLY
# in the commit that changes the case table on purpose.
MIN_VERDICTS=50
SEEN=$(( ${SEEN_A:-0} + ${SEEN_B:-0} ))
if [ "$SEEN" -lt "$MIN_VERDICTS" ]; then
  echo "❌ probes printed $SEEN PASS verdict(s), expected at least $MIN_VERDICTS." >&2
  echo "   Nothing failed and the drivers exited 0 — verdict rows went MISSING, which means" >&2
  echo "   assertions never ran (drifted fixture / renamed field / a case that returned early)." >&2
  exit 1
fi
echo "✓ edge gate passed: six functions driven over HTTP in two serves ($SEEN verdicts)"
