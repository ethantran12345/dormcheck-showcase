-- Pre-publish auto-moderation gate: DB-level guarantees (migration 20260719150000).
-- Asserts the status CHECK accepts pending_review, the hardened
-- guard_listing_status_change blocks an owner self-transitioning OUT of the
-- pre-scan hold (while an admin can approve), and admin_list_held_listings is
-- admin-only + returns the held/rejected set. All inside a rolled-back tx.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_pre_moderation.test.sql

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


-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Pitt tenant (root). Created by seed/migration in a real stack; ensure here so
-- the test is order-independent.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

-- Null-email throwaway users (null email skips the signup domain gate).
INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- is_admin is DERIVED from role by the sync_is_admin_from_role trigger
-- (is_admin := role <> 'user') and is direct-write-protected, so seed the role.
-- The admin is a superadmin: satisfies the RPC's role gate, is_superadmin()
-- (so the tenant_isolation UPDATE policy admits the cross-owner status change),
-- and the guard trigger's admin exemption.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'Mod Owner',    '00000000-0000-4000-8000-000000000001', 'user'),
  ('dddddddd-0000-4000-8000-000000000002', 'Mod Admin',    '00000000-0000-4000-8000-000000000001', 'superadmin'),
  ('dddddddd-0000-4000-8000-000000000003', 'Mod Outsider', '00000000-0000-4000-8000-000000000001', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

-- Listings owned by the owner, seeded as postgres (INSERT: OLD is NULL, so the
-- status guard doesn't fire on create).
INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status, moderation_decision, moderation_reason, moderation_categories) VALUES
  ('eeeeeeee-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'pending owner listing', 10, 'other', '00000000-0000-4000-8000-000000000001', 'pending_review', NULL, NULL, NULL),
  ('eeeeeeee-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000001', 'pending admin listing', 10, 'other', '00000000-0000-4000-8000-000000000001', 'pending_review', NULL, NULL, NULL),
  ('eeeeeeee-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000001', 'held listing',    10, 'other', '00000000-0000-4000-8000-000000000001', 'under_review', 'held',     'Flagged for review by the automated safety filter.', ARRAY['harassment']),
  ('eeeeeeee-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000001', 'rejected listing',10, 'other', '00000000-0000-4000-8000-000000000001', 'under_review', 'rejected', 'Photo or text violates the marketplace content policy.', ARRAY['sexual']);

-- ── Harness ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

-- Run a statement as an authenticated user; returns SQLERRM or NULL.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- Count rows a SETOF query returns for an authenticated user.
CREATE OR REPLACE FUNCTION pg_temp._count_as(p_uid uuid, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') s' INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

-- ── Assertions ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  owner    uuid := 'dddddddd-0000-4000-8000-000000000001';
  admin    uuid := 'dddddddd-0000-4000-8000-000000000002';
  outsider uuid := 'dddddddd-0000-4000-8000-000000000003';
  l_pending_owner uuid := 'eeeeeeee-0000-4000-8000-000000000001';
  l_pending_admin uuid := 'eeeeeeee-0000-4000-8000-000000000002';
  l_held          uuid := 'eeeeeeee-0000-4000-8000-000000000003';
  err text;
  st  text;
BEGIN
  -- 1. status CHECK accepts pending_review (seed insert above already landed it).
  SELECT status INTO st FROM public.marketplace_listings WHERE id = l_pending_owner;
  PERFORM _assert('status CHECK accepts pending_review', st = 'pending_review', 'got ' || coalesce(st, 'NULL'));

  -- 2. Owner CANNOT self-transition out of pending_review (hardened guard).
  err := pg_temp._exec_as(owner,
    'UPDATE public.marketplace_listings SET status = ''available'' WHERE id = ''' || l_pending_owner || '''');
  PERFORM _assert('owner blocked from pending_review -> available', err IS NOT NULL AND err ILIKE '%under review%', coalesce(err, 'no error'));
  SELECT status INTO st FROM public.marketplace_listings WHERE id = l_pending_owner;
  PERFORM _assert('blocked listing stays pending_review', st = 'pending_review', 'got ' || coalesce(st, 'NULL'));

  -- 3. Owner still cannot leave under_review either (pre-existing invariant).
  err := pg_temp._exec_as(owner,
    'UPDATE public.marketplace_listings SET status = ''available'' WHERE id = ''' || l_held || '''');
  PERFORM _assert('owner blocked from under_review -> available', err IS NOT NULL AND err ILIKE '%under review%', coalesce(err, 'no error'));

  -- 4. Admin CAN approve a pending_review listing (guard exempts admins; the
  --    owner-or-admin UPDATE policy grants the write).
  err := pg_temp._exec_as(admin,
    'UPDATE public.marketplace_listings SET status = ''available'', moderation_decision = ''approved'' WHERE id = ''' || l_pending_admin || '''');
  PERFORM _assert('admin approves pending_review -> available', err IS NULL, coalesce(err, ''));
  SELECT status INTO st FROM public.marketplace_listings WHERE id = l_pending_admin;
  PERFORM _assert('admin-approved listing is available', st = 'available', 'got ' || coalesce(st, 'NULL'));

  -- 5. admin_list_held_listings returns the held + rejected set for an admin,
  --    clamped to the admin's university.
  PERFORM _assert('admin_list_held_listings returns held+rejected for admin',
    pg_temp._count_as(admin, 'SELECT * FROM public.admin_list_held_listings(NULL)') >= 2);
  PERFORM _assert('admin_list_held_listings includes the held listing',
    pg_temp._count_as(admin, 'SELECT * FROM public.admin_list_held_listings(NULL) WHERE listing_id = ''' || l_held || '''') = 1);

  -- 6. A non-admin cannot call admin_list_held_listings.
  err := pg_temp._exec_as(outsider, 'SELECT * FROM public.admin_list_held_listings(NULL)');
  PERFORM _assert('non-admin blocked from admin_list_held_listings', err IS NOT NULL, coalesce(err, 'no error'));
END $$;

-- ── Summary / hard fail ──────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  RAISE NOTICE 'marketplace_pre_moderation: % assertions, % failed',
    (SELECT count(*) FROM test_results), failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'marketplace_pre_moderation FAILED: % assertion(s) — see FAIL notices above', failed;
  END IF;
END $$;

ROLLBACK;
