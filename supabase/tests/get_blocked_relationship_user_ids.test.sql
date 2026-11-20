-- Happy + adversarial matrix for get_blocked_relationship_user_ids.
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/get_blocked_relationship_user_ids.test.sql

\set ON_ERROR_STOP on

\set user_a 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
\set user_b 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
\set user_c 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
\set user_d 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'
\set user_e 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5'

-- SHARED PERSONA NAMESPACE (see content_reports_user_type.test.sql for the full
-- note): `aaaaaaaa-…-aaa1..7` is shared with the other two COMMITting probes, so
-- these rows persist across probes and across runs. `…aaa1` may already be
-- `role = 'university_admin'` when this file runs — irrelevant here, because
-- get_blocked_relationship_user_ids() is scoped to the CALLER, not to any role.
--
-- The literal counts in TESTS a/b/c below (= 1, = 1, = 0) are LOAD-BEARING, not
-- incidental: "A blocks B yields exactly ONE id, bidirectionally, and leaks
-- nothing about the unrelated C/D pair" is the property under test, so they must
-- not be softened to `>= 1`. They are safe against re-runs and reordering
-- because this file is the ONLY writer of `blocked_users` rows for these
-- personas and every seed is ON CONFLICT-guarded — the precondition the counts
-- rely on. Adding a second block involving A/B here changes the expected count.
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


-- This probe COMMITs, so the four '' token columns are mandatory: a NULL in any GoTrue
-- string column 500s the whole admin user API. See content_reports_user_type.test.sql for
-- the full note and docs/handoffs/authed-ui-pass-2026-08-06.md defect 4 for the incident —
-- block-a..e@pitt.edu were five of the eleven rows that poisoned the stack.
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
  (:'user_a'::uuid, 'block-a@pitt.edu'),
  (:'user_b'::uuid, 'block-b@pitt.edu'),
  (:'user_c'::uuid, 'block-c@pitt.edu'),
  (:'user_d'::uuid, 'block-d@pitt.edu'),
  (:'user_e'::uuid, 'block-e@pitt.edu')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
SELECT u.id, u.email, u.full_name
FROM (VALUES
  (:'user_a'::uuid, 'block-a@pitt.edu', 'Blocker A'),
  (:'user_b'::uuid, 'block-b@pitt.edu', 'Blocked B'),
  (:'user_c'::uuid, 'block-c@pitt.edu', 'Blocker C'),
  (:'user_d'::uuid, 'block-d@pitt.edu', 'Blocked D'),
  (:'user_e'::uuid, 'block-e@pitt.edu', 'Unrelated E')
) AS u(id, email, full_name)
ON CONFLICT (id) DO NOTHING;

-- A blocks B; C blocks D (unrelated pair for leakage test)
INSERT INTO public.blocked_users (blocker_id, blocked_id)
VALUES
  (:'user_a'::uuid, :'user_b'::uuid),
  (:'user_c'::uuid, :'user_d'::uuid)
ON CONFLICT DO NOTHING;

COMMIT;

CREATE OR REPLACE FUNCTION pg_temp._blocked_ids_as(p_uid uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
    true
  );
  RETURN QUERY SELECT * FROM public.get_blocked_relationship_user_ids();
  PERFORM pg_temp._assume('postgres');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._blocked_ids_anon()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.get_blocked_relationship_user_ids();
  PERFORM pg_temp._assume('postgres');
  RETURN 'UNEXPECTED_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._blocked_ids_no_jwt()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_count FROM public.get_blocked_relationship_user_ids();
  PERFORM pg_temp._assume('postgres');
  RETURN v_count;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

\echo '--- TEST a: A blocks B - caller A returns {B} ---'
SELECT CASE
  WHEN (
    SELECT count(*) FROM pg_temp._blocked_ids_as(:'user_a'::uuid)
  ) = 1
  AND (
    SELECT bool_and(uid = :'user_b'::uuid)
    FROM pg_temp._blocked_ids_as(:'user_a'::uuid) AS uid
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_a;

\echo '--- TEST b: A blocks B - caller B returns {A} (bidirectional) ---'
SELECT CASE
  WHEN (
    SELECT count(*) FROM pg_temp._blocked_ids_as(:'user_b'::uuid)
  ) = 1
  AND (
    SELECT bool_and(uid = :'user_a'::uuid)
    FROM pg_temp._blocked_ids_as(:'user_b'::uuid) AS uid
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_b;

\echo '--- TEST c: unrelated E has no block rows - empty ---'
SELECT CASE
  WHEN (SELECT count(*) FROM pg_temp._blocked_ids_as(:'user_e'::uuid)) = 0 THEN 'PASS'
  ELSE 'FAIL'
END AS test_c;

\echo '--- TEST d: anon cannot execute RPC ---'
SELECT CASE
  WHEN pg_temp._blocked_ids_anon() ILIKE '%permission denied%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._blocked_ids_anon()
END AS test_d;

\echo '--- TEST e: authenticated with no auth.uid() returns empty ---'
SELECT CASE
  WHEN pg_temp._blocked_ids_no_jwt() = 0 THEN 'PASS'
  ELSE 'FAIL: count=' || pg_temp._blocked_ids_no_jwt()::text
END AS test_e;

\echo '--- TEST f: C blocks D - unrelated A sees no leakage ---'
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1
    FROM pg_temp._blocked_ids_as(:'user_a'::uuid) AS uid
    WHERE uid IN (:'user_c'::uuid, :'user_d'::uuid)
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_f;

\echo '--- TEST g: search_path pinned on function ---'
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_blocked_relationship_user_ids'
      AND p.proconfig IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM unnest(p.proconfig) AS cfg
        WHERE cfg LIKE 'search_path=%'
      )
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_g;

\echo '--- TEST h: function body schema-qualifies blocked_users ---'
SELECT CASE
  WHEN (
    SELECT pg_get_functiondef(p.oid)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_blocked_relationship_user_ids'
  ) LIKE '%public.blocked_users%'
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_h;
