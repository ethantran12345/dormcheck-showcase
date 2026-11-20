-- CHECK constraint + get_content_reports smoke for content_type = 'user'.
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/content_reports_user_type.test.sql

\set ON_ERROR_STOP on

\set admin_id 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
\set reporter_id 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
\set reported_user_id 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
\set listing_id 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
\set user_report_id 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
-- Multi-tenant fixtures (2026-07-10 `drop_university_default_add_trigger`): `university_id`
-- lost its Pitt DEFAULT on the 11 content roots and is now derived from the INSERTing user's
-- profile, or supplied explicitly. This file seeds as `postgres`, so `auth.uid()` is NULL and
-- nothing can be derived — the documented path for a seed script is to pass the value.
\set pitt_id '00000000-0000-4000-8000-000000000001'

-- SHARED PERSONA NAMESPACE — read before renumbering or reusing these UUIDs.
-- `aaaaaaaa-…-aaa1..7` is used by all three COMMITting probes:
-- this file, get_blocked_relationship_user_ids and settlement_rpc_local_test.
-- Their fixtures OUTLIVE the run (no ROLLBACK), so whatever this file writes is
-- visible to every later probe and to the next `npm run test:db`. Specifically:
-- `…aaa1` is left `role = 'university_admin'` by the DO UPDATE below, and stays
-- that way. That is currently harmless — the other two probes' RPCs are
-- caller-scoped (get_blocked_relationship_user_ids) or group-membership-gated
-- (get_group_checklist_settlement_context), so neither reads the role — but it
-- IS a live cross-probe coupling, verified green under reverse and shuffled
-- order. If you add an assertion here that depends on `…aaa1` being a plain
-- user, or one there that branches on admin, give the new persona its own UUID
-- rather than assuming this file ran first.
BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so under the old idiom
-- session_user stayed superuser — and three shipped triggers (protect_profile_role,
-- protect_profile_is_admin, protect_listing_verified_at) EXEMPT session_user IN
-- ('postgres','supabase_admin'). A plain user's own row took role='superadmin' under the
-- harness and was refused through the real client path: the probe would have passed for the
-- wrong reason, in the direction that says "wide open" about a schema that is sound.
-- pg_temp._assume() reproduces the real client identity — session authorization AND role.
-- Do not go back to set_config('role', …); supabase/tests/harness_role_fidelity.test.sql
-- fails the suite the moment this idiom stops yielding session_user='authenticator'.
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  -- Step back to the connection's own login role first: from 'authenticator' nothing else
  -- is permitted. NULL resets the GUC, so this works whatever the runner connected as.
  PERFORM set_config('session_authorization', NULL, true);
  -- 'postgres' is the identity the seeding phases have always run under, and the one the
  -- three guards exempt, so seeding behaviour is unchanged. Everything else gets the real
  -- client shape: session_user='authenticator', which is NOT exempt.
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin. A '
           'postgres connection cannot set session_authorization, so the harness cannot '
           'reproduce a real client identity and every guard keyed on session_user would be '
           'silently exempt - the failure this helper exists to prevent.';
END $_assume$;

-- Baseline: seeding below runs as session_user='postgres', exactly as it did before this
-- helper existed. Transaction-local on purpose - a session-level set would drop superuser
-- for the whole connection and make the authenticator switch impossible.
SELECT pg_temp._assume('postgres');


-- The four '' columns are NOT decoration. This probe COMMITs, so its auth.users rows outlive
-- the run, and GoTrue scans confirmation_token / recovery_token / email_change_token_new /
-- email_change into a non-pointer Go `string`. One NULL in any of them makes
-- `GET /admin/users` answer 500 "Database error finding users" for EVERY caller, which took
-- `npm run audit:app:seed` down immediately after a GREEN db gate on 2026-08-06
-- (docs/handoffs/authed-ui-pass-2026-08-06.md defect 4). The other GoTrue string columns
-- already carry DEFAULT ''; these four do not. Any NEW fixture that COMMITs an auth.users row
-- must write them — scripts/test-db.sh re-checks the whole table after the suite, so
-- forgetting is a red gate here rather than a mystery two commands later.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
SELECT
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  crypt('testpass', gen_salt('bf')),
  now(),
  now(),
  now(),
  '', '', '', ''
FROM (VALUES
  (:'admin_id'::uuid, 'cr-admin@pitt.edu'),
  (:'reporter_id'::uuid, 'cr-reporter@pitt.edu'),
  (:'reported_user_id'::uuid, 'cr-reported@pitt.edu')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- `profiles.is_admin` is NO LONGER writable: the `sync_is_admin_from_role` BEFORE INSERT/UPDATE
-- trigger derives it as `role <> 'user'`, so a fixture that sets is_admin directly is silently
-- overwritten to false and every admin assertion below fails. Grant admin via `role` instead.
-- `university_admin` (not `superadmin`) is deliberate: get_content_reports() gives a superadmin
-- an unscoped view, which would pass TEST d without ever exercising the tenant-scoping branch
-- this test exists to cover. `protect_profile_role` permits the write because session_user is
-- `postgres`.
INSERT INTO public.profiles (id, email, full_name, role, university_id)
SELECT u.id, u.email, u.full_name, u.role::public.app_role, :'pitt_id'::uuid
FROM (VALUES
  (:'admin_id'::uuid, 'cr-admin@pitt.edu', 'Admin User', 'university_admin'),
  (:'reporter_id'::uuid, 'cr-reporter@pitt.edu', 'Reporter User', 'user'),
  (:'reported_user_id'::uuid, 'cr-reported@pitt.edu', 'Reported User', 'user')
) AS u(id, email, full_name, role)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  university_id = EXCLUDED.university_id;

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id)
VALUES (:'listing_id'::uuid, :'reporter_id'::uuid, 'Test listing for report CHECK', 10.00, 'Other', :'pitt_id'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.content_reports (id, content_type, content_id, reporter_id, reason)
VALUES (
  :'user_report_id'::uuid,
  'user',
  :'reported_user_id'::uuid,
  :'reporter_id'::uuid,
  'harassment in DMs'
)
-- This file COMMITs its fixtures (it does not ROLLBACK like the other probes), so without
-- this the second `npm run test:db` against the same database dies on content_reports_pkey.
-- The gate always runs `supabase db reset` first, but local iteration should not need one.
ON CONFLICT (id) DO NOTHING;

-- SELF-CLEANING FIXTURE. TEST c inserts a marketplace_listing report with a
-- server-generated id, so `ON CONFLICT (id)` cannot protect it — on a second run against
-- the same database the row from the previous run collides with
-- `uniq_one_report_per_user_per_content` and TEST c prints
-- 'FAIL: duplicate key value …'. That is exactly the failure that sailed through the
-- gate on 2026-07-28 (see scripts/test-db.sh). Delete this probe's own row up front
-- rather than relying on `supabase db reset`: local iteration must be able to run the
-- suite twice, and the constraint is real (one report per user per content) so a
-- per-run unique id would not model production.
-- Scoped to this file's reporter + listing personas only — it never touches another
-- probe's rows, which is what keeps reverse/shuffle order independence intact.
DELETE FROM public.content_reports
WHERE reporter_id = :'reporter_id'::uuid
  AND content_type = 'marketplace_listing'
  AND content_id = :'listing_id'::uuid;

COMMIT;

CREATE OR REPLACE FUNCTION pg_temp._content_reports_as(p_uid uuid, p_filter text DEFAULT NULL)
RETURNS TABLE(
  report_id uuid,
  content_type text,
  content_id uuid,
  reporter_id uuid,
  reporter_name text,
  reason text,
  -- `category` + `escalated_at` were added to public.get_content_reports() by the moderation
  -- escalation work; this local mirror of its signature had drifted and must match positionally
  -- (RETURN QUERY SELECT * ...), which is why the columns sit here rather than at the end.
  category text,
  escalated_at timestamptz,
  reported_at timestamptz,
  content_preview_title text,
  content_preview_body text,
  content_owner_id uuid,
  content_owner_name text,
  content_context text
)
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  RETURN QUERY SELECT * FROM public.get_content_reports(p_filter);
  PERFORM pg_temp._assume('postgres');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._insert_invalid_content_type(
  p_reported_user_id uuid,
  p_reporter_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.content_reports (content_type, content_id, reporter_id, reason)
  VALUES ('banana', p_reported_user_id, p_reporter_id, 'should fail');
  RETURN 'UNEXPECTED_SUCCESS';
EXCEPTION
  WHEN check_violation THEN
    RETURN SQLERRM;
  WHEN OTHERS THEN
    RETURN SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._insert_marketplace_listing_report(
  p_listing_id uuid,
  p_reporter_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.content_reports (content_type, content_id, reporter_id, reason)
  VALUES ('marketplace_listing', p_listing_id, p_reporter_id, 'spam listing');
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;

\echo '--- TEST a: content_type=user inserts OK ---'
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.content_reports
    WHERE id = :'user_report_id'::uuid
      AND content_type = 'user'
      AND content_id = :'reported_user_id'::uuid
      AND reporter_id = :'reporter_id'::uuid
      AND reason = 'harassment in DMs'
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_a;

\echo '--- TEST b: invalid content_type banana rejected by CHECK ---'
SELECT CASE
  WHEN pg_temp._insert_invalid_content_type(:'reported_user_id'::uuid, :'reporter_id'::uuid) ILIKE '%chk_content_type%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._insert_invalid_content_type(:'reported_user_id'::uuid, :'reporter_id'::uuid)
END AS test_b;

\echo '--- TEST c: marketplace_listing still inserts OK ---'
SELECT CASE
  WHEN pg_temp._insert_marketplace_listing_report(:'listing_id'::uuid, :'reporter_id'::uuid) = 'OK' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._insert_marketplace_listing_report(:'listing_id'::uuid, :'reporter_id'::uuid)
END AS test_c;

\echo '--- TEST d: get_content_reports returns user row for admin (preview fields may be NULL) ---'
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_temp._content_reports_as(:'admin_id'::uuid, NULL) AS r
    WHERE r.report_id = :'user_report_id'::uuid
      AND r.content_type = 'user'
      AND r.content_id = :'reported_user_id'::uuid
      AND r.reporter_id = :'reporter_id'::uuid
      AND r.reason = 'harassment in DMs'
      AND r.reporter_name = 'Reporter User'
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_d;
