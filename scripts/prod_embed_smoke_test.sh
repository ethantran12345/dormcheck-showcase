#!/usr/bin/env bash
# DormCheck - prod PostgREST embed smoke test (Security Pass 2c)
#
# Why this exists: the public_profiles refactor was validated against the LOCAL
# PostgREST schema cache. The remote instance infers view<->table relationships
# from its own schema cache, which can differ and can lag right after a migration.
# This script exercises the exact embeds the app uses, against PROD, with a real
# authenticated user token + a negative anon test, so you find a broken embed
# here instead of in a user's "missing names/avatars" bug report.
#
# Usage:
#   export SUPABASE_URL="https://abcdefghijklmnopqrst.supabase.co"
#   export ANON_KEY="<your anon/publishable key>"
#   export USER_JWT="<a real authenticated @pitt.edu user's access_token>"
#   ./scripts/prod_embed_smoke_test.sh
#
# Get USER_JWT: log into the app, open devtools console, run:
#   (await window.supabase?.auth?.getSession())?.data?.session?.access_token
#   ...or pull supabase.auth.token from IndexedDB/localStorage.
#
# Requires: curl, jq

set -euo pipefail

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${ANON_KEY:?set ANON_KEY}"
: "${USER_JWT:?set USER_JWT (a real authenticated user access_token)}"

REST="${SUPABASE_URL%/}/rest/v1"
PASS=0; FAIL=0; WARN=0
GREEN=$'\e[32m'; RED=$'\e[31m'; YEL=$'\e[33m'; DIM=$'\e[2m'; RST=$'\e[0m'

# test_embed <label> <auth: user|anon> <expect: ok|empty_or_denied|denied> <path+query>
test_embed() {
  local label="$1" auth="$2" expect="$3" q="$4"
  local hdr_auth resp code body
  if [[ "$auth" == "user" ]]; then hdr_auth="Bearer ${USER_JWT}"; else hdr_auth="Bearer ${ANON_KEY}"; fi

  resp=$(curl -sS -w $'\n%{http_code}' \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: ${hdr_auth}" \
    -H "Accept: application/json" \
    "${REST}/${q}" || true)
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"

  local pgrst_err=""
  pgrst_err=$(printf '%s' "$body" | jq -r 'if type=="object" and .code then .code else empty end' 2>/dev/null || true)

  local ok=0 note=""
  case "$expect" in
    ok)
      # 200 and NOT a PostgREST error object. Empty array is fine (no rows != broken embed).
      if [[ "$code" == "200" && -z "$pgrst_err" ]]; then ok=1; else note="code=$code err=${pgrst_err:-none}"; fi
      ;;
    empty_or_denied)
      # anon should get nothing useful: 200 [] (no grant -> no rows) OR 401/403/permission denied.
      if [[ "$code" =~ ^(401|403)$ ]]; then ok=1; note="blocked ($code) ✓"
      elif [[ "$code" == "200" ]]; then
        local n; n=$(printf '%s' "$body" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo 0)
        if [[ "$n" == "0" ]]; then ok=1; note="empty ✓"; else ok=0; note="LEAK: anon got $n rows"; fi
      else note="code=$code err=${pgrst_err:-none}"; fi
      ;;
    denied)
      if [[ "$code" =~ ^(401|403)$ ]] || [[ "$pgrst_err" == "42501" ]]; then ok=1; note="denied ✓"
      else note="NOT denied: code=$code err=${pgrst_err:-none}"; fi
      ;;
  esac

  if [[ $ok == 1 ]]; then PASS=$((PASS+1)); printf "%s PASS %s  %s%s\n" "$GREEN" "$RST" "$label" "${note:+  ${DIM}$note${RST}}";
  else FAIL=$((FAIL+1)); printf "%s FAIL %s  %s  %s%s%s\n" "$RED" "$RST" "$label" "$RED" "$note" "$RST";
       printf "       %sq:%s %s\n" "$DIM" "$RST" "$q";
       printf "       %sresp:%s %s\n" "$DIM" "$RST" "$(printf '%s' "$body" | head -c 300)"; fi
}

# Diagnostic only - does not fail the run (app may not use this embed).
test_embed_warn() {
  local label="$1" auth="$2" expect="$3" q="$4"
  local before_fail=$FAIL
  test_embed "$label" "$auth" "$expect" "$q"
  if [[ $FAIL -gt $before_fail ]]; then
    FAIL=$before_fail
    WARN=$((WARN+1))
    printf "       %sWARN: not counted - app does not rely on this embed.%s\n" "$YEL" "$RST"
  fi
}

echo "== DormCheck prod embed smoke test =="
echo "REST: $REST"
echo

echo "-- 1. POSITIVE: embeds the app issues (authenticated user) --"
# NOTE: these mirror the select strings from the Pass 2c refactor. If the app's
# exact select differs, copy it verbatim - PostgREST resolves on the exact string.

test_embed "dorm_future_residents -> public_profiles embed" user ok \
  "dorm_future_residents?select=id,dorm_id,user_id,year,created_at,profiles:public_profiles(full_name,avatar_url,profile_photos)&limit=1"

test_embed "dining_reviews -> public_profiles embed (explicit FK)" user ok \
  "dining_reviews?select=id,user_id,rating,content,photo_url,is_anonymous,created_at,profiles:public_profiles!dining_reviews_user_id_fkey(full_name,avatar_url)&limit=1"

test_embed "off_campus_dining_reviews -> public_profiles embed (explicit FK)" user ok \
  "off_campus_dining_reviews?select=id,user_id,rating,content,photo_url,is_anonymous,created_at,profiles:public_profiles!off_campus_dining_reviews_user_id_fkey(full_name,avatar_url)&limit=1"

test_embed "roommate_search_interests -> public_profiles embed (explicit FK)" user ok \
  "roommate_search_interests?select=*,profiles:public_profiles!roommate_search_interests_user_id_fkey(full_name,avatar_url)&limit=1"

test_embed "roommate_search_posts -> public_profiles embed (explicit FK)" user ok \
  "roommate_search_posts?select=*,profiles:public_profiles!roommate_search_posts_user_id_fkey(full_name,avatar_url)&limit=1"

test_embed "marketplace_listings -> public_profiles embed" user ok \
  "marketplace_listings?select=id,user_id,title,price,category,profiles:public_profiles(full_name,email,instagram_username,snapchat_username,phone_number)&limit=1"

echo
echo "-- 1b. DIAGNOSTIC: embeds not used by the app (warn-only) --"
echo "${YEL}   business_listings FK targets auth.users, not profiles - PGRST200 is expected.${RST}"
echo "${YEL}   messages loads sender names via separate public_profiles batch fetch.${RST}"
test_embed_warn "business_listings -> public_profiles embed" user ok \
  "business_listings?select=*,profiles:public_profiles(full_name,avatar_url)&limit=1"
test_embed_warn "messages -> public_profiles embed" user ok \
  "messages?select=*,profiles:public_profiles(full_name,avatar_url)&limit=1"
test_embed_warn "checklist_payments -> public_profiles embed" user ok \
  "checklist_payments?select=*,profiles:public_profiles(full_name)&limit=1"

echo
echo "-- 2. POSITIVE: direct cross-user reads from the view (authenticated) --"
test_embed "public_profiles direct read (id,full_name,avatar_url)" user ok \
  "public_profiles?select=id,full_name,avatar_url&limit=1"
test_embed "public_profiles direct read (contact cols)" user ok \
  "public_profiles?select=id,full_name,email,avatar_url&limit=1"
test_embed "public_profiles batch .in() lookup (conversations pattern)" user ok \
  "public_profiles?select=id,full_name,email,avatar_url&id=not.is.null&limit=3"

echo
echo "-- 3. NEGATIVE: the lockdowns must hold on prod --"
# anon must NOT be able to read the view (granted to authenticated only)
test_embed "anon -> public_profiles (must be empty/denied)" anon empty_or_denied \
  "public_profiles?select=id,full_name&limit=5"
# anon must NOT read profiles directly
test_embed "anon -> profiles (must be denied)" anon denied \
  "profiles?select=id,full_name&limit=5"
# anon must NOT read dorm_future_residents
test_embed "anon -> dorm_future_residents (must be empty/denied)" anon empty_or_denied \
  "dorm_future_residents?select=dorm_id,user_id&limit=5"

echo
echo "-- 4. NEGATIVE: sensitive columns must NOT be exposed via the view --"
# Each of these should 400 (column does not exist on the view) - a 200 means the
# column leaked into public_profiles.
for col in venmo_username zelle_info is_admin email_notifications home_layout current_floor; do
  resp=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${USER_JWT}" \
    "${REST}/public_profiles?select=${col}&limit=1" || true)
  if [[ "$resp" == "400" ]]; then PASS=$((PASS+1)); printf "%s PASS %s  view excludes %s ${DIM}(400)${RST}\n" "$GREEN" "$RST" "$col";
  else FAIL=$((FAIL+1)); printf "%s FAIL %s  %sLEAK: %s readable on public_profiles (code=%s)%s\n" "$RED" "$RST" "$RED" "$col" "$resp" "$RST"; fi
done

echo
echo "============================================"
printf "  %sPASS: %d%s   %sFAIL: %d%s" "$GREEN" "$PASS" "$RST" "$([[ $FAIL -gt 0 ]] && echo "$RED" || echo "$DIM")" "$FAIL" "$RST"
if [[ $WARN -gt 0 ]]; then printf "   %sWARN: %d (diagnostic only)%s" "$YEL" "$WARN" "$RST"; fi
printf "\n"
echo "============================================"
echo
if [[ $FAIL -gt 0 ]]; then
  echo "${YEL}If embed FAILs look like PGRST200 'no relationship found', the prod schema"
  echo "cache hasn't picked up the new view relationships. Force a reload, then re-run:"
  echo "  ${RST}select pg_notify('pgrst','reload schema');${YEL}"
  echo "(run in SQL editor; cache also reloads on the next migration / after ~a minute).${RST}"
  exit 1
fi
echo "${GREEN}All prod embeds resolve and all lockdowns hold.${RST}"
if [[ $WARN -gt 0 ]]; then
  echo "${YEL}Diagnostic warn-only tests failed - expected if FK targets auth.users only.${RST}"
fi
