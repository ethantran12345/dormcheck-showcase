-- covers: 20260901000000_security_tier1_moderation_and_tenant_scope.sql
-- covers: 20260901000001_security_item2_business_listings_tenant_scope.sql
-- Security queue Tier 1 (migration 20260901000000): business_listings owners
-- must not be able to write moderation columns (is_approved) — the guard
-- trigger restores them for non-admin callers while admins still moderate —
-- and seller_ratings SELECT must be scoped to the seller's university instead
-- of `true`. All inside a rolled-back tx.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security_tier1_moderation_scope.test.sql

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
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
   ARRAY['pitt.edu'], true),
  ('00000000-0000-4000-8000-0000000000b2', 'sec-tier1-b', 'Tier1 Other University', 'T1B',
   ARRAY['t1b.test'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('f1f1f1f1-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('f1f1f1f1-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('f1f1f1f1-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('f1f1f1f1-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- is_admin is derived from role by sync_is_admin_from_role; seed the role.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('f1f1f1f1-0000-4000-8000-000000000001', 'T1 Owner',    '00000000-0000-4000-8000-000000000001', 'user'),
  ('f1f1f1f1-0000-4000-8000-000000000002', 'T1 Admin',    '00000000-0000-4000-8000-000000000001', 'superadmin'),
  ('f1f1f1f1-0000-4000-8000-000000000003', 'T1 Outsider', '00000000-0000-4000-8000-0000000000b2', 'user'),
  ('f1f1f1f1-0000-4000-8000-000000000004', 'T1 Peer',     '00000000-0000-4000-8000-000000000001', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

-- Unapproved listing owned by the owner (seeded as postgres: auth.uid() is
-- NULL so the guard trigger stays out of the way of fixtures).
INSERT INTO public.business_listings (id, user_id, business_name, category, description, university_id, is_approved, is_active)
VALUES ('e1e1e1e1-0000-4000-8000-000000000001', 'f1f1f1f1-0000-4000-8000-000000000001',
        'T1 Bakery', 'food', 'cookies', '00000000-0000-4000-8000-000000000001', false, true);

-- A rating of the Pitt owner (seller) by the Pitt peer.
INSERT INTO public.seller_ratings (id, rater_id, seller_id, stars)
VALUES ('e2e2e2e2-0000-4000-8000-000000000001', 'f1f1f1f1-0000-4000-8000-000000000004',
        'f1f1f1f1-0000-4000-8000-000000000001', 5);

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
  owner    uuid := 'f1f1f1f1-0000-4000-8000-000000000001';
  admin    uuid := 'f1f1f1f1-0000-4000-8000-000000000002';
  outsider uuid := 'f1f1f1f1-0000-4000-8000-000000000003';
  peer     uuid := 'f1f1f1f1-0000-4000-8000-000000000004';
  listing  uuid := 'e1e1e1e1-0000-4000-8000-000000000001';
  err text;
  approved boolean;
  owner_after uuid;
  descr text;
BEGIN
  -- 1. Owner UPDATE setting is_approved=true succeeds as a statement but the
  --    guard trigger restores the moderation column: the row stays unapproved.
  err := pg_temp._exec_as(owner,
    'UPDATE public.business_listings SET is_approved = true WHERE id = ''' || listing || '''');
  PERFORM _assert('owner self-approval UPDATE does not error', err IS NULL, coalesce(err, ''));
  SELECT is_approved INTO approved FROM public.business_listings WHERE id = listing;
  PERFORM _assert('owner self-approval leaves row unapproved', approved = false, 'is_approved=' || approved);

  -- 2. Owner benign edit still works (trigger only freezes guarded columns).
  err := pg_temp._exec_as(owner,
    'UPDATE public.business_listings SET description = ''fresh cookies'' WHERE id = ''' || listing || '''');
  SELECT description INTO descr FROM public.business_listings WHERE id = listing;
  PERFORM _assert('owner benign edit persists', err IS NULL AND descr = 'fresh cookies',
    coalesce(err, 'description=' || coalesce(descr, 'NULL')));

  -- 3. Owner cannot retarget row identity (user_id silently restored).
  err := pg_temp._exec_as(owner,
    'UPDATE public.business_listings SET user_id = ''' || peer || ''' WHERE id = ''' || listing || '''');
  SELECT user_id INTO owner_after FROM public.business_listings WHERE id = listing;
  PERFORM _assert('owner cannot reassign listing ownership', owner_after = owner,
    'user_id=' || owner_after);

  -- 4. Admin approval still works end-to-end.
  err := pg_temp._exec_as(admin,
    'UPDATE public.business_listings SET is_approved = true WHERE id = ''' || listing || '''');
  SELECT is_approved INTO approved FROM public.business_listings WHERE id = listing;
  PERFORM _assert('admin can approve the listing', err IS NULL AND approved = true,
    coalesce(err, 'is_approved=' || approved));

  -- 4b. An owner cannot CREATE an already-approved listing. Without the
  --     INSERT arm of the guard this is a trivial bypass of assertion 1: the
  --     INSERT policy's WITH CHECK only asserts ownership.
  err := pg_temp._exec_as(owner,
    'INSERT INTO public.business_listings (id, user_id, business_name, category, description, university_id, is_approved) ' ||
    'VALUES (''e1e1e1e1-0000-4000-8000-000000000002'', ''' || owner || ''', ''T1 Sneaky'', ''food'', ''x'', ' ||
    '''00000000-0000-4000-8000-000000000001'', true)');
  SELECT is_approved INTO approved FROM public.business_listings
   WHERE id = 'e1e1e1e1-0000-4000-8000-000000000002';
  PERFORM _assert('owner cannot insert a pre-approved listing', approved = false,
    coalesce(err, 'is_approved=' || coalesce(approved::text, 'NULL')));

  -- 5. Owner still sees their own listing (owner-view policy after re-scope).
  PERFORM _assert('owner still sees own listing',
    pg_temp._count_as(owner,
      'SELECT 1 FROM public.business_listings WHERE id = ''' || listing || '''') = 1);

  -- 5b. Approved-listing visibility (migration 20260901000001): the old
  -- "Anyone can view approved listings" TO public policy is replaced by
  -- same-university, authenticated-only. The listing was approved by the
  -- admin in test 3, so both directions are checkable here.
  PERFORM _assert('same-university peer sees the approved listing',
    pg_temp._count_as(peer,
      'SELECT 1 FROM public.business_listings WHERE id = ''' || listing || '''') = 1);
  PERFORM _assert('cross-university user cannot see the approved listing',
    pg_temp._count_as(outsider,
      'SELECT 1 FROM public.business_listings WHERE id = ''' || listing || '''') = 0);

  -- 6. seller_ratings: same-university peer sees the rating…
  PERFORM _assert('same-university user sees seller rating',
    pg_temp._count_as(peer,
      'SELECT 1 FROM public.seller_ratings WHERE seller_id = ''' || owner || '''') = 1);

  -- 7. …a cross-university user sees zero rows.
  PERFORM _assert('cross-university user sees no seller ratings',
    pg_temp._count_as(outsider,
      'SELECT 1 FROM public.seller_ratings WHERE seller_id = ''' || owner || '''') = 0);
END $$;

-- ── Summary / hard fail ──────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  RAISE NOTICE 'security_tier1_moderation_scope: % assertions, % failed',
    (SELECT count(*) FROM test_results), failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'security_tier1_moderation_scope FAILED: % assertion(s) — see notices above', failed;
  END IF;
END $$;

ROLLBACK;
