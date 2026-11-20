-- Local-only seed + adversarial matrix for get_group_checklist_settlement_context.
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/settlement_rpc_local_test.sql

\set ON_ERROR_STOP on

-- Fixed UUIDs
\set user_a 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
\set user_b 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2'
\set user_c 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3'
\set user_p 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4'
\set user_d 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5'
\set user_x 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6'
\set user_y 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7'
\set g1 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1'
\set g2 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2'
\set ph_g1 'cccccccc-cccc-cccc-cccc-ccccccccccc1'
\set ph_g2 'cccccccc-cccc-cccc-cccc-ccccccccccc2'
\set outsider 'dddddddd-dddd-dddd-dddd-dddddddddddd'

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


-- Minimal auth.users (local test personas).
-- This probe COMMITs, so the four '' token columns are mandatory: a NULL in any GoTrue
-- string column 500s the whole admin user API. See content_reports_user_type.test.sql for
-- the full note and docs/handoffs/authed-ui-pass-2026-08-06.md defect 4 for the incident —
-- x/y/out@pitt.edu were three of the eleven rows that poisoned the stack.
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
  (:'user_a'::uuid, 'a@pitt.edu'),
  (:'user_b'::uuid, 'b@pitt.edu'),
  (:'user_c'::uuid, 'c@pitt.edu'),
  (:'user_p'::uuid, 'p@pitt.edu'),
  (:'user_d'::uuid, 'd@pitt.edu'),
  (:'user_x'::uuid, 'x@pitt.edu'),
  (:'user_y'::uuid, 'y@pitt.edu'),
  (:'outsider'::uuid, 'out@pitt.edu')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, venmo_username, zelle_info, university_id)
SELECT u.id, u.email, u.full_name, u.venmo, u.zelle, '00000000-0000-4000-8000-000000000001'::uuid
FROM (VALUES
  (:'user_a'::uuid, 'a@pitt.edu', 'Alice A', '@alice', 'alice-zelle@pitt.edu'),
  (:'user_b'::uuid, 'b@pitt.edu', 'Bob B', '@bob', 'bob-zelle@pitt.edu'),
  (:'user_c'::uuid, 'c@pitt.edu', 'Carol C', '@carol', 'carol-zelle@pitt.edu'),
  (:'user_p'::uuid, 'p@pitt.edu', 'Pat Pending', NULL, NULL),
  (:'user_d'::uuid, 'd@pitt.edu', 'Dan D', '@dan', 'dan-zelle@pitt.edu'),
  (:'user_x'::uuid, 'x@pitt.edu', 'Xavier X', '@xavier', 'x-zelle@pitt.edu'),
  (:'user_y'::uuid, 'y@pitt.edu', 'Yolanda Y', '@yolanda', 'y-zelle@pitt.edu'),
  (:'outsider'::uuid, 'out@pitt.edu', 'Outsider O', '@outsider', 'out@pitt.edu')
) AS u(id, email, full_name, venmo, zelle)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  venmo_username = EXCLUDED.venmo_username,
  zelle_info = EXCLUDED.zelle_info,
  university_id = EXCLUDED.university_id;

-- Groups.
-- `ranking_collaborations.university_id` lost its Pitt DEFAULT in the 2026-07-10 multi-tenant
-- migration and is now derived from the INSERTing user's profile or passed explicitly. This
-- file seeds as `postgres` (auth.uid() IS NULL), so it is passed explicitly.
INSERT INTO public.ranking_collaborations (id, owner_id, group_name, status, university_id)
VALUES
  (:'g1'::uuid, :'user_a'::uuid, 'G1 Test Group', 'accepted', '00000000-0000-4000-8000-000000000001'),
  (:'g2'::uuid, :'user_x'::uuid, 'G2 Test Group', 'accepted', '00000000-0000-4000-8000-000000000001')
-- Fixtures here are COMMITted, and the rest of this file's seeds are already
-- ON CONFLICT-guarded; without this the second run dies on ranking_collaborations_pkey.
ON CONFLICT (id) DO NOTHING;

-- G1 members: A,B,C accepted; P pending
INSERT INTO public.ranking_group_members (group_id, user_id, role, status)
VALUES
  (:'g1'::uuid, :'user_a'::uuid, 'owner', 'accepted'),
  (:'g1'::uuid, :'user_b'::uuid, 'collaborator', 'accepted'),
  (:'g1'::uuid, :'user_c'::uuid, 'collaborator', 'accepted'),
  (:'g1'::uuid, :'user_p'::uuid, 'collaborator', 'pending')
ON CONFLICT (group_id, user_id) DO NOTHING;

-- G2 members: X,Y accepted
INSERT INTO public.ranking_group_members (group_id, user_id, role, status)
VALUES
  (:'g2'::uuid, :'user_x'::uuid, 'owner', 'accepted'),
  (:'g2'::uuid, :'user_y'::uuid, 'collaborator', 'accepted')
ON CONFLICT (group_id, user_id) DO NOTHING;

-- Payment rows
INSERT INTO public.payment_history (id, group_id, payer_id, receiver_id, amount, method, status, note)
VALUES
  (:'ph_g1'::uuid, :'g1'::uuid, :'user_a'::uuid, :'user_b'::uuid, 42.50, 'venmo', 'confirmed', 'G1 A pays B'),
  (:'ph_g2'::uuid, :'g2'::uuid, :'user_x'::uuid, :'user_y'::uuid, 99.00, 'zelle', 'sent', 'G2 X pays Y')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Helper: run RPC as a user
CREATE OR REPLACE FUNCTION pg_temp._rpc_as(p_uid uuid, p_group uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  SELECT public.get_group_checklist_settlement_context(p_group) INTO v;
  PERFORM pg_temp._assume('postgres');
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._rpc_as_expect_error(p_uid uuid, p_group uuid, p_msg text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._rpc_as(p_uid, p_group);
  RETURN 'UNEXPECTED_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  IF SQLERRM LIKE '%' || p_msg || '%' THEN
    RETURN 'OK: ' || SQLERRM;
  END IF;
  RETURN 'WRONG_ERROR: ' || SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._rpc_anon(p_group uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM public.get_group_checklist_settlement_context(p_group);
  PERFORM pg_temp._assume('postgres');
  RETURN 'UNEXPECTED_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._rpc_no_jwt(p_group uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.get_group_checklist_settlement_context(p_group);
  PERFORM pg_temp._assume('postgres');
  RETURN 'UNEXPECTED_SUCCESS';
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

\echo '--- TEST a: C sees A<->B payment in G1 ---'
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM jsonb_array_elements(pg_temp._rpc_as(:'user_c'::uuid, :'g1'::uuid)->'payment_history') e
    WHERE (e->>'payer_id') = :'user_a'
      AND (e->>'receiver_id') = :'user_b'
      AND (e->>'amount')::numeric = 42.50
  ) THEN 'PASS'
  ELSE 'FAIL'
END AS test_a;

\echo '--- TEST b: D non-member G1 ---'
SELECT CASE
  WHEN pg_temp._rpc_as_expect_error(:'user_d'::uuid, :'g1'::uuid, 'Not authorized') LIKE 'OK:%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._rpc_as_expect_error(:'user_d'::uuid, :'g1'::uuid, 'Not authorized')
END AS test_b;

\echo '--- TEST c: P pending G1 ---'
SELECT CASE
  WHEN pg_temp._rpc_as_expect_error(:'user_p'::uuid, :'g1'::uuid, 'Not authorized') LIKE 'OK:%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._rpc_as_expect_error(:'user_p'::uuid, :'g1'::uuid, 'Not authorized')
END AS test_c;

\echo '--- TEST d: C random group ---'
SELECT CASE
  WHEN pg_temp._rpc_as_expect_error(:'user_c'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'Not authorized') LIKE 'OK:%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._rpc_as_expect_error(:'user_c'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'Not authorized')
END AS test_d;

-- TEST e's `= 3` is LOAD-BEARING: "the RPC returns the accepted members and
-- ONLY the accepted members" is the property under test, so it must stay an
-- equality — never widened to `>= 3`. It does assume nothing else added an
-- accepted member to G1, and this file COMMITs into a persona namespace shared
-- with content_reports_user_type / get_blocked_relationship_user_ids (see the
-- note at the top of the former). Rather than assume that precondition, assert
-- it directly against the base table first, so a violation reports as "G1 seed
-- drifted" instead of as an RPC bug.
\echo '--- TEST e0: precondition - G1 has exactly 3 accepted members in the base table ---'
SELECT CASE
  WHEN (
    SELECT count(*) FROM public.ranking_group_members
    WHERE group_id = :'g1'::uuid AND status = 'accepted'
  ) = 3 THEN 'PASS'
  ELSE 'FAIL: G1 accepted-member seed drifted, got ' || (
    SELECT count(*)::text FROM public.ranking_group_members
    WHERE group_id = :'g1'::uuid AND status = 'accepted'
  )
END AS test_e0;

\echo '--- TEST e: members handles only accepted G1 set ---'
WITH resp AS (
  SELECT pg_temp._rpc_as(:'user_c'::uuid, :'g1'::uuid) AS j
),
member_ids AS (
  SELECT jsonb_array_elements(j->'members')->>'user_id' AS uid FROM resp
),
checks AS (
  SELECT
    (SELECT count(*) FROM member_ids) = 3 AS count_ok,
    (SELECT bool_and(uid IN (:'user_a', :'user_b', :'user_c')) FROM member_ids) AS ids_ok,
    NOT EXISTS (SELECT 1 FROM member_ids WHERE uid IN (:'user_p', :'user_d', :'outsider')) AS no_outsiders,
    (SELECT count(*) FROM member_ids m JOIN public.profiles p ON p.id = m.uid::uuid WHERE p.venmo_username IS NOT NULL OR p.zelle_info IS NOT NULL) >= 3 AS handles_present
)
SELECT CASE WHEN count_ok AND ids_ok AND no_outsiders AND handles_present THEN 'PASS' ELSE 'FAIL' END AS test_e
FROM checks;

\echo '--- TEST f: C G1 has zero G2 rows ---'
WITH resp AS (SELECT pg_temp._rpc_as(:'user_c'::uuid, :'g1'::uuid) AS j)
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'payment_history') e WHERE e->>'group_id' = :'g2'
  )
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'legacy_payments') e WHERE e->>'group_id' = :'g2'
  )
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'payment_acks') e WHERE e->>'group_id' = :'g2'
  )
  THEN 'PASS'
  ELSE 'FAIL'
END AS test_f
FROM resp;

\echo '--- TEST g: no JWT ---'
SELECT CASE
  WHEN pg_temp._rpc_no_jwt(:'g1'::uuid) LIKE '%Not authenticated%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._rpc_no_jwt(:'g1'::uuid)
END AS test_g;

\echo '--- TEST h: anon role denied ---'
SELECT CASE
  WHEN pg_temp._rpc_anon(:'g1'::uuid) ILIKE '%permission denied%' THEN 'PASS'
  ELSE 'FAIL: ' || pg_temp._rpc_anon(:'g1'::uuid)
END AS test_h;
