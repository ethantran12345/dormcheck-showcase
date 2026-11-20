#!/usr/bin/env bash
# DB test runner: every non-quarantined probe in supabase/tests/.
# Usage: npm run test:db   (local Supabase stack must be running)
# psql on the host is used when available; otherwise falls back to docker exec
# into the local Supabase db container.
#
# THIS IS A LOAD-BEARING GATE, not a smoke test. The `advisor-autofix` job in
# .github/workflows/claude.yml runs `supabase db reset` + this script before it
# commits an autonomously-generated migration to `dev` — including the
# `advisor-autofix-rlsinit` class, which DROPs and re-CREATEs RLS policies. The
# negative assertions in these files (cross-tenant reads returning 0 rows,
# outsiders denied, anon denied) are the ONLY thing proving a rewritten policy
# still denies what it denied before. Never weaken them; never quarantine a file
# without recording why below.
#
# SCOPE LIMIT — READ BEFORE ADDING A PROBE FOR AN EDGE FUNCTION. Every probe here talks
# to Postgres DIRECTLY, which makes this suite blind to one whole class of defect: the
# schema is right and the CALLER is wrong. moderate-listing writing status='available'
# onto a service post (2026-08-06, fixed in 6548db1a) was exactly that — the CHECK
# constraint did its job, the function 500'd, and every approved service post stranded in
# 'pending_review', invisible to the feed and to its own author. No assertion expressible
# in this suite could have caught it.
# Edge Functions are DRIVEN over HTTP by `bash scripts/test-edge.sh`, gated in
# .github/workflows/edge-functions.yml. Do NOT simulate a function's behaviour with a
# direct DB write in a probe here: that asserts your own belief about what the function
# does, which is precisely the belief the defect above was hiding behind.
set -euo pipefail

cd "$(dirname "$0")/.."

# CONNECT AS supabase_admin, NOT postgres. This is a correctness requirement, not a
# convenience (docs/security/reaudit-2026-08-06.md H1). PostgREST serves every real request
# as session_user='authenticator' with a SET ROLE to authenticated/anon, and three shipped
# triggers — protect_profile_role, protect_profile_is_admin, protect_listing_verified_at —
# exempt session_user IN ('postgres','supabase_admin'). The old idiom, set_config('role',…),
# changes current_user but NOT session_user, so those guards were invisible here and a probe
# asserting one would have passed for the wrong reason: under the harness a plain user's own
# row took role='superadmin', which the real client path refuses.
#
# pg_temp._assume() (defined in every probe that switches role) fixes that by issuing
# SET LOCAL SESSION AUTHORIZATION authenticator + SET LOCAL ROLE — and SET SESSION
# AUTHORIZATION requires a SUPERUSER connection. In a Supabase stack `postgres` is NOT a
# superuser; `supabase_admin` is. Hence the change of login role. Nothing else about the run
# differs: both roles carry BYPASSRLS, and every probe assumes an explicit role before it
# asserts anything.
DB_SUPERUSER="${SUPABASE_DB_SUPERUSER:-supabase_admin}"
DB_SUPERUSER_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_URL="${SUPABASE_DB_URL:-postgresql://${DB_SUPERUSER}:${DB_SUPERUSER_PASSWORD}@127.0.0.1:54322/postgres}"

# …and PIN the search_path, because supabase_admin does not have the same one. Its role
# config is `"$user", public, auth, extensions`, so `pg_get_expr` renders a policy's
# `auth.uid()` as the bare `uid()` — and tenant_registry.test.sql, which greps policy text
# for the literal `auth.uid()`, went red on 21 tables the moment the login role changed.
# That failure said "these policies lost their auth.uid() predicate", which is false and is
# precisely the sort of confidently-wrong red this suite must not produce. Pinning to
# postgres's search_path keeps every probe's rendered SQL identical to what it has always been.
export PGOPTIONS="${PGOPTIONS:--c search_path=\"\$user\",public,extensions}"
REGISTRY_JSON="$(cat supabase/registry/table-classification.json)"

# Several probes report per-assertion results as a printed 'PASS'/'FAIL' VALUE
# rather than raising (content_reports_user_type, get_blocked_relationship_user_ids,
# settlement_rpc_local_test). psql exits 0 for those, so a failed assertion would
# sail through as a green gate. Scan the captured output for a FAIL token as well
# as checking the exit code — belt and braces, since the two idioms are mixed.
#
# The trailing class is `[^[:alnum:]_]`, NOT `[[:space:]]`. Until 2026-07-28 it was
# whitespace-or-EOL, which matched a bare `FAIL` value but MISSED every `'FAIL: ' || detail`
# form — the idiom these probes actually use to report a detailed verdict. A real
# content_reports_user_type TEST c failure printed
# "FAIL: duplicate key value violates unique constraint …" and the suite still reported
# "✓ all DB tests passed (14 probes)" while gating a release. Consequence for probe
# authors: keep FAIL at a token boundary in verdicts, and do NOT print the literal token
# in prose or comments — discuss it the way moderation_action_check_drift.test.sql §6 does.
# A FAIL scan is necessary but NOT sufficient. Both probe idioms here fail OPEN when a
# verdict never prints at all:
#   - the value idiom (`SELECT CASE WHEN … THEN 'PASS' ELSE 'FAIL' END`) prints nothing if
#     the enclosing SELECT returns ZERO rows — a drifted seed, a renamed fixture, a WHERE
#     that stopped matching. No FAIL token is emitted, psql exits 0, the gate goes green.
#   - the raise idiom prints nothing on success by design, so it is indistinguishable from
#     a probe whose body silently no-opped.
# Neither the exit code nor the FAIL grep can tell "asserted and passed" from "never
# asserted". So each probe DECLARES how many verdict rows it must print (`probe <file>
# <label> <minVerdicts>`), and a run that prints fewer is red. That is the row-count
# assertion the exit code cannot give us. Probes on the raise idiom declare 0 — their
# signal genuinely is the exit code — and are listed as 0 deliberately, not by omission.
run_sql() { # $1 = test file, $2 = minimum PASS verdict rows expected
  local out rc=0 min="${2:-0}" seen
  out="$(mktemp)"
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 -v registry="$REGISTRY_JSON" -q -f "$1" >"$out" 2>&1 || rc=$?
  else
    local container
    container="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
    if [ -z "$container" ]; then
      echo "❌ No host psql and no running supabase_db_* container. Start the stack: npx supabase start -x studio" >&2
      echo "   (-x studio is REQUIRED: Studio segfaults and the CLI tears down the whole healthy stack with it — docs/commands.md)" >&2
      exit 1
    fi
    docker exec -e PGPASSWORD="$DB_SUPERUSER_PASSWORD" -e PGOPTIONS="$PGOPTIONS" -i "$container" psql -U "$DB_SUPERUSER" -d postgres \
      -v ON_ERROR_STOP=1 -v registry="$REGISTRY_JSON" -q -f - <"$1" >"$out" 2>&1 || rc=$?
  fi
  cat "$out"
  if [ "$rc" -ne 0 ]; then
    echo "❌ $1 exited $rc" >&2
    rm -f "$out"; exit 1
  fi
  if grep -qE '(^|[[:space:]])FAIL([^[:alnum:]_]|$)' "$out"; then
    echo "❌ $1 printed a FAIL assertion (psql still exited 0 — that is why this check exists)" >&2
    rm -f "$out"; exit 1
  fi
  # Row-count assertion: silence is not success. Same token boundary as the FAIL scan.
  seen="$(grep -cE '(^|[[:space:]])PASS([^[:alnum:]_]|$)' "$out" || true)"
  if [ "$seen" -lt "$min" ]; then
    echo "❌ $1 printed $seen PASS verdict(s), expected at least $min." >&2
    echo "   Nothing FAILED and psql exited 0 — verdict rows went MISSING, which means an" >&2
    echo "   assertion never ran (drifted seed / renamed fixture / zero-row verdict SELECT)." >&2
    echo "   Fix the probe or the seed. Only lower the declared count in scripts/test-db.sh" >&2
    echo "   together with the commit that deliberately removes those assertions." >&2
    rm -f "$out"; exit 1
  fi
  rm -f "$out"
}

# ORDER INDEPENDENCE. `probe` only REGISTERS a file; nothing runs until the
# dispatch loop at the bottom. That exists so the declared order can be varied
# without editing this file:
#
#   TEST_DB_ORDER=forward   (default) the order below
#   TEST_DB_ORDER=reverse   run last-to-first
#   TEST_DB_ORDER=shuffle   random permutation (TEST_DB_SEED=<n> to reproduce)
#
# A probe that only passes in `forward` is depending on what a sibling seeded,
# which is a latent flake in a gate the advisor-autofix job trusts. Autofix has
# maxAttempts 2, so two spurious reds escalate a fixable issue to
# `autofix-exhausted` (human-only) — the outcome the automation exists to avoid.
# Re-verify with `TEST_DB_ORDER=reverse npm run test:db` after a clean db reset.
#
# EXPECTED_PROBES pins the registered count. Deleting or commenting out a `probe` line is
# otherwise invisible: the suite happily reports "✓ all DB tests passed (24 probes)" and the
# advisor-autofix gate reads that as green. Bump this ONLY in the commit that adds or removes
# a probe on purpose.
EXPECTED_PROBES=50

PROBE_FILES=()
PROBE_LABELS=()
PROBE_MINVERDICTS=()
probe() { # $1 = file basename under supabase/tests/  $2 = human label  $3 = min PASS verdict rows
  PROBE_FILES+=("$1")
  PROBE_LABELS+=("$2")
  PROBE_MINVERDICTS+=("${3:?probe '$1' must declare its minimum verdict-row count (0 for raise-on-failure probes)}")
}

# Wired 2026-08-06 with the H1 harness fix. This one tests the TEST HARNESS: that assuming a
# role here produces the identity a real PostgREST client presents (session_user
# ='authenticator', not the superuser the runner connected as), and that the three guards
# which were invisible under the old set_config('role',…) idiom now actually deny. Every
# assertion in its §3 FAILED — i.e. the escalation succeeded — before pg_temp._assume() landed.
# It runs FIRST on purpose: if the harness cannot reproduce a client, nothing after it means
# what it says. (Order independence still holds; it seeds and rolls back everything it uses.)
# Wired 2026-08-06. The delegated-admin feature (admin_invitations + set_admin_role +
# revoke_admin_invitation + claim_pending_admin_invites + get_university_admins, and
# api/admin-invite.ts on top of them) shipped and merged with ZERO coverage — verified by
# `git log --all -S'set_admin_role' -- src/test supabase/tests e2e`, which returned nothing.
# PostgREST reaches every one of those rails directly, so a check that lives only in the
# handler is a check a client can skip. All 26 verdicts are mutation-checked: 14 rail removals
# were applied against a live stack and each turned the matching verdict red (the table is in
# docs/handoffs/lane-admin-tests.md; the harness is the .mutations.py beside the probe).
# §7d pinned one live hazard (the role-change flag never lowered) from 2026-08-06 until
# 20261006000000 fixed it; the verdict now asserts the flag is DOWN after an authorized RPC.
probe admin_invitations_rails.test.sql    "delegated-admin rails: invite scope, superadmin untouchable, audit, role-change flag" 26
# Wired 2026-09-06 for 20261005000000_admin_policies_drop_is_admin_predicate (BA-01/BA-02 in
# docs/audits/backend-audit-2026-09-06.md). `profiles.is_admin` is DERIVED (role <> 'user'), so
# the 23 policies that read it let every delegated university_admin act as a superadmin — nine
# of them on the global Amazon catalog and the dorm-photos bucket, which have no tenant bound
# at all. This probe was red against the stack before that migration: §0 counts the policies
# that still read the column, and the rest exercise each rewritten shape both ways.
probe is_admin_tier_collapse.test.sql     "is_admin tier collapse closed: catalog pin, global catalog, other students' content, own-school dorm catalog, dorm-photos path scope" 21
# Wired 2026-09-06 for 20261007000000_account_deletion_fk_on_delete (BA-04). delete-user-account
# ends in a plain DELETE FROM auth.users; six NO ACTION edges added after it hand-cleared the
# ones it knew about made that DELETE raise, so an account that ever minted a share link or
# appeared in the admin log could not be deleted. Seeds one user into each and deletes them.
probe account_deletion_fk_graph.test.sql  "account deletion survives every user-keyed FK: catalog pin, GoTrue-shaped delete, trail survives with NULL actor" 7
# Wired 2026-09-06 for 20261008000000_images_quarantine_bucket (BA-07). Rejected images now
# move into a PRIVATE bucket held under the REPORT Act's one-year clock; this pins that no
# policy opens the bucket to students or anon and that a quarantine path cannot be recorded
# without its preserve_until.
probe images_quarantine_bucket.test.sql   "quarantine bucket private + service-role only; quarantine path always carries its preservation clock" 8
probe harness_role_fidelity.test.sql      "harness reproduces a real client identity; session_user-keyed guards deny" 8
probe tenant_registry.test.sql            "registry audit passed" 17
probe tenant_isolation.test.sql           "cross-tenant isolation probe passed" 42
probe checklist_share_links.test.sql      "checklist share links security probe passed" 35
probe definer_view_invoker.test.sql       "definer-view behavior-equivalence probe passed" 0
probe marketplace_pre_moderation.test.sql "marketplace pre-moderation guard + admin RPC probe passed" 9
# Wired 2026-08-01 (security remediation). P0-1: the INSERT-side moderation gate
# (a direct insert with status='available' must land pending_review). P0-2: block
# enforcement past DMs (a blocked user cannot react to / comment on the blocker's
# content). P1-2: a reported student_setup surfaces in the moderation queue.
probe marketplace_insert_moderation_gate.test.sql      "marketplace INSERT moderation gate probe passed" 5
# Wired 2026-10-11 with 20261011000000. The UPDATE-side twin of the gate above: an owner
# editing a new photo (or screened text) onto an approved live listing must send it back
# to pending_review, re-claimable by moderate-listing; re-approval must not re-notify
# alert subscribers. 10 of the 18 verdicts were red against the pre-migration schema.
probe marketplace_rescreen_on_edit.test.sql            "marketplace moderation-on-edit probe passed (edited photo goes back to review)" 18
# Wired 2026-10-12 with 20261012000000. Item names are screened content: adding or renaming
# an item on a live listing re-enters the parent rule above; a sold toggle, a same-name
# re-save and a delete do not; the parent-side marker cannot be forged by a direct write.
# 8 of the 18 verdicts were red against the pre-migration schema.
probe listing_item_rescreen.test.sql                   "listing item add/rename sends a live listing back to review" 18
# Wired 2026-10-12 for 20261013000000_storage_cleanup (A2). The orphan sweeper DELETES what
# storage_unreferenced_objects() returns, so the refusals of images-quarantine/images-held
# and the referenced-vs-orphan verdicts are asserted against the shipped function.
probe storage_cleanup.test.sql                         "images-held private; sweep function refuses preserved buckets and lists only old unreferenced objects" 15
probe block_enforcement_reactions_comments.test.sql    "block enforcement (reactions + setup comments) probe passed" 4
probe get_content_reports_student_setup.test.sql       "student_setup report round-trips into the queue" 2
probe content_reports_cross_tenant_admin.test.sql      "cross-tenant admin denial probe passed (content_reports superadmin-only)" 8
probe marketplace_guest_view_harden.test.sql           "hardened guest view probe passed (no join key, fail-closed moderation, sanitized meetup)" 6
# Wired 2026-07-26 (previously present in supabase/tests/ but never executed by any
# gate). message_reactions_rls is the highest-value addition: message_reactions is the
# top auth_rls_initplan entity in the open advisor queue (#118/#119/#120), so it is the
# likeliest first target of an autonomous policy rewrite — and until now its negative
# assertions never ran.
probe message_reactions_rls.test.sql            "message reactions RLS probe passed" 7
probe notifications.test.sql                    "notifications RLS + RPC probe passed" 26
probe get_blocked_relationship_user_ids.test.sql "blocked-relationship RPC probe passed" 8
probe content_reports_user_type.test.sql        "content report user-type + admin RPC probe passed" 4
probe content_type_check_drift.test.sql         "content-type CHECK exact-set drift guard passed (content_reports + moderation_actions)" 12
probe moderation_action_check_drift.test.sql    "moderation action CHECK exact-set drift guard passed (self-tested)" 8
probe product_hearts_from_picks.test.sql        "product hearts pump/backfill probe passed" 11
probe settlement_rpc_local_test.sql             "settlement RPC probe passed" 9
probe public_preview_rpcs.test.sql              "public preview RPC probe passed" 0
probe public_capture_write_hardening.test.sql   "public capture write hardening probe passed" 1
probe metrics_and_query_performance.test.sql    "admin metrics aggregate + query-index probe passed" 0
probe app_efficiency_hardening.test.sql          "RLS initplans, FK indexes, and trigger RPC grants hardened" 0
# Wired 2026-08-02 by the RLS coverage gate (scripts/check-rls-test-coverage.mjs):
# this probe existed but was never executed by any gate — the exact failure mode
# the gate exists to catch. Covers 20260901000000 (business_listings moderation
# guard trigger + owner-view tenant scope + seller_ratings SELECT scope) and
# 20260901000001 (approved listings same-university, authenticated-only).
probe security_tier1_moderation_scope.test.sql "business-listing moderation guard + tenant-scoped reads probe passed" 11
# Security remediation close-out (2026-08-02). Both pin negative assertions that
# nothing else covers: the backup-code mint gate (client INSERT denied, aal2 to
# mint, aal1 to redeem, TOTP survives) and the two candidates that flipped from
# "false positive" to confirmed on re-verification.
probe backup_code_mint_and_roommate_contact.test.sql "backup-code mint gate + roommate contact tenant predicate probe passed" 0
probe ranking_delete_and_rating_retarget.test.sql    "ranking pending-invitee delete + seller-rating retarget probe passed" 0
# Wired 2026-08-02 (P0 close-out, migration 20260901000006). Both directions:
# outsider/pending/cross-uni/other-tenant-dorm/retarget writes denied; accepted
# member + owner writes and the pending-invitee read path still work.
probe group_dorm_rankings_write_scope.test.sql       "group ranking write scope probe passed (membership + tenant + value gates)" 0
# Wired 2026-08-05. This file existed since 4decb7ef ("sec(perf): harden moderation and
# digest queries", covering 20260831010000) but NO gate ever executed it — it was neither
# registered here nor listed as quarantined. check-rls-test-coverage.mjs did not catch it
# because that gate only demands a wired probe for migrations touching RLS, and this one
# covers a performance/index migration. Verified passing against a current stack before
# wiring. Raise-on-failure idiom (RAISE NOTICE 'FAIL: …' + a final RAISE EXCEPTION), so it
# declares 0 verdict rows.
probe backend_security_performance_hardening.test.sql "moderation + digest query hardening probe passed" 0
# Wired 2026-08-05 for 20260825000000_dm_message_metadata_and_photos, which had been
# landing on dev with NO probe — the RLS coverage gate (and therefore Migration / RLS
# Safety Guard) had been red on exactly this since run #59. Covers both of that
# migration's RLS surfaces: dm-photos own-folder write confinement in both directions
# (cross-folder INSERT/UPDATE/DELETE denied, own-folder INSERT/DELETE succeed), and the
# migration's own claim that messages.metadata inherits the row's RLS (non-participant
# reads nothing, participant reads the payload intact). The bucket is public-READ by
# design, so write confinement is the whole guard. Uses the raise-on-failure idiom via
# pg_temp._assert, so it declares 0 verdict rows.
probe dm_message_metadata_and_photos.test.sql "DM metadata RLS inheritance + dm-photos own-folder write confinement probe passed" 0
# Wired 2026-08-11 with 20260919000000_dm_audio_and_polls; extended 2026-08-16 to
# also cover 20260811205118_private_dm_audio_moderation_helper, which declares the
# SAME end state from the other direction (prod had the predicate in `public`; that
# migration moves it to `private` and drops the public overload). One probe, both
# migrations — the catalog assertions at the end are what make that honest rather
# than a citation. Proves the private storage path is participant-only until an
# actual DM report creates the scoped moderation exception, proves the predicate is
# unreachable from the API schema and from anon, and proves votes cannot be read or
# forged outside the DM.
probe dm_audio_and_polls_rls.test.sql "DM audio privacy/moderation + live poll vote RLS probe passed" 0
# Wired 2026-08-06 with 20260910000000_marketplace_service_posts. Carries the
# exact-set drift guard for marketplace_listings_status_check — the constraint
# 20260731030000 silently narrowed once already — plus the open/claimed/completed
# RPC round trip, the cross-tenant and second-claimer denials, the no-payments
# price=0 gate, and the seller_ratings RLS widening (completed pair may rate).
probe marketplace_service_posts.test.sql "service posts: status drift guard + claim/complete lifecycle + no-payments gate passed" 23

# Wired 2026-08-16 with the release shape of student services (20260924000000).
# The category vocabulary IS the abuse control — no catch-all, no license-gated
# trade, no food — so it is asserted as set EQUALITY in both directions, the way
# the status set is: a later migration re-adding the historical union would show
# up as "too wide" here and nowhere else. Also covers the two negatives the
# feature stands on (a second active offer per provider, a review with no
# completed job), the post-approval edit limit, and the fact that REMOTE reach
# is off on every row while LOCAL never crosses schools at all.
probe service_categories_scope.test.sql "student services: category set equality, one active offer, review-needs-completion, remote reach off" 42

# Wired 2026-08-05 with the sublease restore. The verified-LISTER gate is the
# whole reason subleases are allowed back, and it is worth nothing if it lives
# only in the create page — so this probe ATTEMPTS the write as each unverified
# account shape and asserts the row is absent afterwards, covers the
# post-insert is_sublease/post_type flip, and pins the signed-out visitor to
# zero subleases in marketplace_public against a matched visible item.
probe sublease_verified_lister_gate.test.sql "sublease verified-lister gate: unverified write refused, guest sees none" 19

# Wired 2026-08-17 with 20260929000000_listing_building_tenant_consistency. Phase 1
# of subleases-on-a-map gave a listing a `building_id` and nothing checked that the
# building's school matched the listing's — reachable only by a hand-written
# PostgREST call today, but Phase 2 turns that row into a map PIN in the wrong city.
# The probe sends exactly that raw call as a real `authenticated` client and asserts
# the SQLSTATE is 23514 (the trigger) rather than 23503 (the foreign key): an FK
# error would mean the definer lookup came back empty — i.e. the trigger was blinded
# by buildings.tenant_isolation and never inspected the row — which is how this probe
# could otherwise go green against a guard that does nothing.
probe listing_building_tenant_consistency.test.sql "listing/building tenant consistency: cross-tenant building refused on INSERT and UPDATE, service_role included" 15

# Wired 2026-08-06 with 20260913000000_reaudit_dismissal_survivors — the four
# findings that survived the re-audit of the 2026-08-02 dismissals
# (docs/security/reaudit-2026-08-06.md). Every assertion in it failed before that
# migration. Its header used to carry the harness caveat — that a role assumed with
# set_config('role',…) leaves session_user superuser, so the three guards exempting
# session_user IN ('postgres','supabase_admin') could not be asserted. That caveat is
# RETIRED as of 2026-08-06: pg_temp._assume() sets session_authorization too, and
# harness_role_fidelity.test.sql asserts those three denials directly.
probe reaudit_dismissal_survivors.test.sql "re-audit survivors: group takeover, membership relocation, moderation rewrite, inactive-school guest feed" 14

# Wired 2026-08-16 with 20260925000000_setup_photos_owner_select_for_cleanup, which
# shipped in the 2026-08-16 release with the RLS coverage gate KNOWINGLY red — this
# file is that debt. The policy re-opens SELECT on setup-photos objects, so the only
# assertion that can distinguish "confined to my own prefix" from "every student sees
# every student's uploads" is the negative one, and a one-directional probe would have
# passed against the loosened form. Both directions are behavioural, against two
# accounts at the SAME school. Mutation-checked before wiring: bucket-only predicate
# → 5 red, policy dropped → 4 red, policy also granted to anon → 2 red, shipped policy
# → 10 green (the four runs are recorded in docs/CHANGELOG.md 2026-08-16).
probe setup_photos_owner_select.test.sql "setup-photos owner-only SELECT: owner resolves own object, classmate and anon read none" 10
# Wired 2026-10-11 with 20261011010000: the same own-folder SELECT on the six other
# uid-prefixed public buckets, whose client cleanup (refused/replaced uploads) was a silent
# no-op. 18 of the 30 verdicts were red against the pre-migration schema.
probe storage_owner_select_for_cleanup.test.sql "owner-only SELECT on six public buckets: owner resolves own object, classmate and anon read none" 30

# Wired 2026-08-27 with 20261004000000_campus_live_data: ten class-A campus_* tables
# whose permissive USING (true) SELECT policy makes a one-directional read test
# meaningless. Both directions are behavioural, against students at two schools.
probe campus_live_data_tenant_isolation.test.sql "campus_* class-A isolation: each school reads only its own rows, anon none, no app-role writes" 29

# Wired 2026-08-16 by the grandfathered-RLS audit (docs/security/rls-grandfathered-audit.md).
# 20260712220332_listing_verifications shipped the verified-listings flow with NO probe: five
# policies on listing_verifications plus two on storage.objects, guarding the most sensitive
# rows the marketplace holds (a student's lease/utility document path, or the address they
# attest to). The audit's mutation matrix confirmed no wired probe touched the table — every
# policy could be loosened to USING (true) with the whole suite green. Proven red-then-green
# before wiring, one run per policy: lv_select_own → 6 red, lv_insert_own → 1, lv_update_admin
# → 1, lv_delete_own_rejected → 1, lv_select_admin dropped → 3, lv_storage_select_own_or_admin
# → 2, lv_storage_insert_own → 1, bucket flipped public → 1; unmutated → 26 green.
# NOTE the first draft aimed §2's forged INSERT at a listing that already had a verification
# row, so UNIQUE (listing_id) refused it and the assertion passed against WITH CHECK (true) —
# a green assertion that could not go red. It now targets a listing with no verification.
# It also PINS one live hazard (LV-1) rather than pretending it is not there.
probe listing_verifications_owner_scope.test.sql "listing verifications: owner-only reads, admin review, private evidence bucket confined" 26

# Wired 2026-08-16 by the same audit. Seven baseline migrations share one shape and had no
# coverage at all: create a server-only table, ENABLE ROW LEVEL SECURITY, create NO policy.
# Deny-all is a real security property and one line from being lost. Two of the tables hold
# student PII (deleted_accounts, email_suppressions), and deleted_accounts additionally grants
# anon/authenticated full DML — the empty policy set is its ONLY defence (hazard SO-1).
# Proven red-then-green per table before wiring: adding a permissive policy alone turns
# deleted_accounts red on 4 behavioural assertions (it needs no grant change); the other seven
# tables go red on the structural pin immediately and on the behavioural assertions once a
# GRANT accompanies the policy. Unmutated → 57 green.
probe server_only_tables_deny_all.test.sql "server-only tables: RLS-on with zero policies still denies anon + authenticated, server still reads" 64

# Wired 2026-08-16 by the same audit, and it is the SECOND time this repo has found a finished
# probe that nothing ran — after security_tier1_moderation_scope.test.sql on 2026-08-02.
# student_reviews_restore.test.sql has 54 green assertions and was neither registered here nor
# listed as quarantined; the two migrations it covers (20260701053717, 20260906000000) passed
# the old coverage gate only because their version strings happened to appear in
# content_type_check_drift.test.sql, which never names public.student_reviews at all. The
# hardened gate rejects that as off subject, which is what surfaced this file. Nothing about
# the probe needed fixing — it went green on the first run against a current stack.
probe student_reviews_restore.test.sql "student reviews restore: RLS + moderation scope on the restored review surface" 54

# Un-quarantined 2026-07-26. This probe was blocked by a real repo defect, not test
# rot: 20260731040000_student_setups_hidden_and_reports.sql re-created the zero-arg
# `get_setups_preview()` that 20260721000001_preview_rpc_tenant_scoping.sql had
# dropped in favor of `get_setups_preview(p_university_id uuid DEFAULT NULL)`, so a
# filename-order `supabase db reset` ended with BOTH overloads and the probe's
# zero-arg call died with 42725 "function ... is not unique". Prod only ever had the
# `(uuid)` overload (it applied these under apply-time versions), so `db reset` was
# producing a schema prod does not have — and that is the schema the advisor-autofix
# gate validates against. Fixed by deleting the stray re-create from 20260731040000;
# a clean reset now leaves exactly one overload matching prod's signature/ACL.
# Wired 2026-08-16 by the delegated-denial audit (docs/security/rls-delegated-denial-audit.md).
# LV-1 was not one bug. 47 of the 111 permissive policies on the 32 tenant-guarded tables
# delegate their outsider denial to the RESTRICTIVE tenant policy, and 16 of those tables
# carry a tenant policy that is only a PARENT-VISIBILITY test — so their tenant scope is
# whatever the parent's is. When 20260918000000 widened marketplace_listings for the shared
# marketplace, listing_verifications widened with it, silently, and its own §5 comment still
# claims it is "scoped through the parent listing's school".
# This file pins what the mutation matrix MEASURED, hazards included: a Pitt university_admin
# reads (lv1b) and reviews (lv2a) a CMU student's attested address, and deletes a CMU listing
# (ml3a). Those three are CURRENT BEHAVIOUR, not desired behaviour — a fix must come here and
# turn them red on purpose. It also pins the two structural sets (16 parent-delegated tables,
# 16 admin-shaped policies) as exact-set equalities so a 17th cannot arrive unclassified.
# Red-then-green: 20 mutations, every one of the 26 assertions turned red by at least one of
# them (c0b/c0d are the symmetric twins of c0a/c0c). Two first drafts proved NOTHING and were
# retargeted: opening UPDATE alone left lv2c green because UPDATE consults the SELECT policies
# to find the row, and widening ranking_collaborations' tenant policy alone left cs5b green
# because the child's EXISTS also runs under the parent's PERMISSIVE policies. pg_policy dump
# byte-identical before and after, 301 policies.
probe delegated_tenant_denial.test.sql "delegated outsider denial: LV-1 read + write twin, cross-school listing delete, share links clear, shape pinned" 26

# ─────────────────────────────────────────────────────────────────────────────
# QUARANTINED — deliberately NOT run. Do not wire one back without fixing the
# cause named here; a test that is edited until it passes protects nothing.
#
# This array is READ BY A GATE, not just by people. scripts/check-rls-test-coverage.mjs
# requires every supabase/tests/*.sql to be either wired above or listed here with a
# reason, and rejects an entry whose file does not exist, whose file IS wired, or whose
# reason is too short to be a reason. It exists because student_reviews_restore.test.sql
# sat green with 54 assertions and no gate ran it — the SECOND finished-but-unrun probe
# found in this repo after security_tier1_moderation_scope.test.sql on 2026-08-02. Nothing
# could see either one: the coverage gate only asks whether a MIGRATION has a probe, never
# whether a PROBE has a runner.
# Format: "<file>.sql|<why it is not run, and what has to be true to wire it back>"
QUARANTINED_PROBES=(
  # (none)
)
# ─────────────────────────────────────────────────────────────────────────────

# ── dispatch ─────────────────────────────────────────────────────────────────
ORDER="${TEST_DB_ORDER:-forward}"

if [ "${#PROBE_FILES[@]}" -ne "$EXPECTED_PROBES" ]; then
  echo "❌ probe registry drift: ${#PROBE_FILES[@]} probe(s) registered, EXPECTED_PROBES=$EXPECTED_PROBES." >&2
  echo "   A probe line was added or removed without updating the pin. A shrinking suite still" >&2
  echo "   reports '✓ all DB tests passed' — which is exactly what this check refuses to allow." >&2
  exit 1
fi

IDX=("${!PROBE_FILES[@]}")
case "$ORDER" in
  forward) ;;
  reverse)
    REV=(); for ((i=${#IDX[@]}-1; i>=0; i--)); do REV+=("${IDX[$i]}"); done; IDX=("${REV[@]}") ;;
  shuffle)
    SEED="${TEST_DB_SEED:-$RANDOM}"
    echo "TEST_DB_ORDER=shuffle TEST_DB_SEED=$SEED  (re-export the seed to replay this permutation)"
    IDX=($(printf '%s\n' "${IDX[@]}" | awk -v s="$SEED" 'BEGIN{srand(s)}{print rand()"\t"$0}' | sort -k1,1 | cut -f2)) ;;
  *) echo "❌ unknown TEST_DB_ORDER='$ORDER' (forward|reverse|shuffle)" >&2; exit 1 ;;
esac
[ "$ORDER" = forward ] || echo "▸ probe order: $ORDER"

# MIGRATION GAP PREFLIGHT. This runner does NOT apply migrations — it probes
# whatever the local stack already has. That is deliberate (the advisor-autofix
# job does its own `supabase db reset` first), but it makes the FIRST run of a
# probe for a BRAND-NEW migration fail in the most confusing way available: the
# probe is correct, the migration is correct, prod is already migrated, and the
# only thing wrong is that this database is behind. The failure surfaces as a
# negative assertion coming back positive — "other-tenant INSERT denied" fails
# because the policy that denies it was never created here (2026-08-03,
# 20260901000006). Read literally, that says the security fix does not work.
#
# So: name the gap before running anything. A probe suite run against a stale
# schema is not evidence either way, and letting it report a specific red is
# worse than refusing to run — the red points at the wrong file.
#
# No bypass env var, for the same reason check-rls-test-coverage.mjs has none:
# the legitimate path is always available and is one command.
query() { # $1 = SQL, prints bare rows
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -tA -c "$1" 2>/dev/null
  else
    local container
    container="$(docker ps --format '{{.Names}}' | grep -m1 '^supabase_db_' || true)"
    [ -n "$container" ] && docker exec -e PGPASSWORD="$DB_SUPERUSER_PASSWORD" -e PGOPTIONS="$PGOPTIONS" -i "$container" psql -U "$DB_SUPERUSER" -d postgres -tA -c "$1" 2>/dev/null
  fi
}

APPLIED="$(query "select version from supabase_migrations.schema_migrations" | sort)"
if [ -z "$APPLIED" ]; then
  echo "❌ Could not read supabase_migrations.schema_migrations — is the local stack up?" >&2
  echo "   npx supabase start -x studio   (-x studio is REQUIRED; see docs/commands.md)" >&2
  exit 1
fi
ONDISK="$(ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename | sed 's/_.*//' | sort -u)"
MISSING="$(comm -23 <(echo "$ONDISK") <(echo "$APPLIED"))"
if [ -n "$MISSING" ]; then
  echo "❌ MIGRATION GAP: this database is behind supabase/migrations/ by $(echo "$MISSING" | wc -l | tr -d ' ') migration(s):" >&2
  echo "$MISSING" | sed 's/^/     /' >&2
  echo "   Probes were NOT run. A probe for an unapplied migration fails as a FALSE red that" >&2
  echo "   accuses the migration, not the gap. Apply them first, then re-run:" >&2
  echo "     npx supabase migration up --local      # or: npx supabase db reset  (DESTROYS local data)" >&2
  exit 1
fi

# STAMP DRIFT PREFLIGHT. The gap check above only asks "is this version recorded?" — and a
# STAMP IS NOT EVIDENCE THE DDL RAN. On 2026-08-06 the local database had
# content_reports.chk_content_type in its 7-value pre-20260825 shape while 20260825010000 was
# sitting in schema_migrations as applied (docs/handoffs/authed-ui-pass-2026-08-06.md defect 5).
# Every gate downstream trusted the stamp, so the suite validated a schema that does not exist
# anywhere — not on disk, not in prod.
#
# The CLI records the exact statements it executed in schema_migrations.statements, so the
# check is cheap and exact: fingerprint what was RUN and compare it to what is on DISK, both
# normalised for whitespace and statement terminators. Verified 2026-08-06 across all 190
# migrations of a clean reset — 190 matched, 0 false positives.
#
# A red here almost always means "a migration file was edited after it was applied", which is
# ordinary while authoring one. The fix is the same one command, so there is no bypass env var:
# a suppressed drift warning is indistinguishable from no drift.
if command -v md5sum >/dev/null 2>&1; then _md5() { md5sum | awk '{print $1}'; }
else _md5() { md5 -q; }; fi

DB_FINGERPRINTS="$(query "select version || ' ' || md5(regexp_replace(replace(array_to_string(statements, ' '), ';', ''), '\s+', '', 'g')) from supabase_migrations.schema_migrations")"
DRIFTED=""
for f in supabase/migrations/*.sql; do
  v="$(basename "$f" | sed 's/_.*//')"
  recorded="$(printf '%s\n' "$DB_FINGERPRINTS" | awk -v v="$v" '$1==v {print $2}')"
  [ -n "$recorded" ] || continue           # not applied: the gap check above owns that case
  ondisk="$(tr -d '[:space:];' <"$f" | _md5)"
  [ "$recorded" = "$ondisk" ] || DRIFTED="$DRIFTED$v $(basename "$f")"$'\n'
done
if [ -n "$DRIFTED" ]; then
  echo "❌ STAMPED-BUT-WRONG: the DDL recorded as applied does not match the file on disk:" >&2
  printf '%s' "$DRIFTED" | sed 's/^/     /' >&2
  echo "   Probes were NOT run. This database's schema is not the one in supabase/migrations/," >&2
  echo "   so any verdict from it — green or red — describes a schema that exists nowhere else." >&2
  echo "     npx supabase db reset --local          # re-runs every migration from scratch" >&2
  exit 1
fi

for i in "${IDX[@]}"; do
  echo "── ${PROBE_FILES[$i]} ──"
  run_sql "supabase/tests/${PROBE_FILES[$i]}" "${PROBE_MINVERDICTS[$i]}"
  echo "✓ ${PROBE_LABELS[$i]}"
done

# ── POST-SUITE: did this run leave the stack usable? ─────────────────────────
# A probe suite that goes green and then breaks every other tool on the machine is not
# green. Four probes COMMIT their auth.users fixtures, and GoTrue scans confirmation_token /
# recovery_token / email_change_token_new / email_change into a non-pointer Go `string`, so a
# single NULL makes `GET /admin/users` answer 500 "Database error finding users" for the WHOLE
# table. On 2026-08-06 that took `npm run audit:app:seed` down immediately after this gate
# reported "✓ all DB tests passed" — the worst possible failure ordering, because the green
# gate is what you trust when you go looking for the cause
# (docs/handoffs/authed-ui-pass-2026-08-06.md defect 4).
#
# This check cannot live in a probe: TEST_DB_ORDER can put any probe last, so only something
# after the dispatch loop sees the finished state. It is deliberately a check on the WHOLE
# table, not on the four known probes — a new fixture that forgets the columns is caught here
# on its first run rather than by whoever next tries to seed.
POISON_COLS="confirmation_token recovery_token email_change_token_new email_change"
POISON_PRED="$(for c in $POISON_COLS; do printf '%s is null or ' "$c"; done)false"
POISONED="$(query "select coalesce(string_agg(email, ', ' order by email), '') from auth.users where $POISON_PRED")"
if [ -n "$POISONED" ]; then
  echo "" >&2
  echo "❌ THE SUITE PASSED BUT POISONED THE STACK." >&2
  echo "   auth.users rows with a NULL GoTrue token column: $POISONED" >&2
  echo "   GoTrue cannot scan NULL into a Go string, so the admin user API now 500s for every" >&2
  echo "   caller and 'npm run audit:app:seed' will fail next, pointing at the wrong thing." >&2
  echo "" >&2
  echo "   Cause: a fixture INSERTed into auth.users without ($(echo $POISON_COLS | tr ' ' ',')). " >&2
  echo "   Fix the fixture — write '' for each, the way the four COMMITting probes do — then:" >&2
  echo "     npx supabase db reset --local" >&2
  exit 1
fi

echo "✓ all DB tests passed (${#IDX[@]} probes, order=$ORDER) · stack left clean for the auth admin API"
