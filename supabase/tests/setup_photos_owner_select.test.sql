-- covers: 20260925000000_setup_photos_owner_select_for_cleanup.sql
-- Probe for 20260925000000_setup_photos_owner_select_for_cleanup.
--
-- That migration re-adds a SELECT policy on storage.objects for the setup-photos
-- bucket. Security Pass 4 had removed the broad public SELECT correctly, but with
-- NO replacement the Storage API's delete path (which resolves the object through
-- SELECT first) returned `200 []` and orphaned every refused upload. The fix
-- restores visibility confined to the caller's own UUID prefix.
--
-- A one-directional test is worthless here, and that is the whole reason this file
-- exists. "The owner can see their own photo" passes just as happily against
-- `USING (bucket_id = 'setup-photos')` — i.e. against a policy that shows every
-- student every other student's uploads. So both directions are asserted
-- BEHAVIOURALLY, against a live pair of accounts in the SAME tenant:
--
--   · the owner reads their own object back (the cleanup path the migration exists
--     to unblock actually works);
--   · a second Pitt student reads ZERO rows for that same object, and sees exactly
--     their own row and nothing else when they scan the whole bucket;
--   · anon reads nothing at all.
--
-- The bucket-wide scans are what make the negative load-bearing: a per-object
-- lookup returning 0 rows can also mean "the seed drifted", whereas "you can see
-- exactly one row and it is yours" cannot pass while the predicate is loosened.
--
-- DELETE is asserted STRUCTURALLY, not behaviourally, and the distinction is
-- deliberate: `storage.protect_objects_delete` raises on any direct
-- `DELETE FROM storage.objects` ("Use the Storage API instead"), so the statement
-- never reaches the RLS predicate and a behavioural claim about it would be a green
-- assertion that cannot go red. What is checked instead is that the own-folder
-- DELETE policy still exists with its folder predicate intact -- the realistic
-- regression, and the other half of the cleanup this SELECT policy was added to
-- enable. Same for the bucket's public-read flag, which is the migration's stated
-- tradeoff: image delivery keeps running off the public object URL, so if that flag
-- were flipped the new policy would silently become the only read path.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/setup_photos_owner_select.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so guards keyed on
-- session_user would be silently exempt here and a probe asserting one would go green for
-- the wrong reason. pg_temp._assume() reproduces the real client identity — session
-- authorization AND role. supabase/tests/harness_role_fidelity.test.sql fails the suite the
-- moment this idiom stops yielding session_user='authenticator'.
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  PERFORM set_config('session_authorization', NULL, true);
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

-- Seeding runs as session_user='postgres', transaction-local.
SELECT pg_temp._assume('postgres');

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
   ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

-- Two students at the SAME school. Cross-tenant separation is covered elsewhere
-- (tenant_isolation.test.sql); the leak this policy governs is between classmates,
-- which is the harder case and the one a tenant predicate would not catch.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('7a000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Owner of the photo
  ('7a000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Classmate, no relationship to it
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so seed columns must land in
-- the ON CONFLICT branch (reference-db-probe-profiles-precreated).
INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('7a000000-0000-4000-8000-0000000000a1', 'Setup Owner',     '00000000-0000-4000-8000-000000000001'),
  ('7a000000-0000-4000-8000-0000000000a2', 'Setup Classmate', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- One object per student, both in setup-photos, each under its owner's UUID prefix —
-- exactly the shape src/ writes. The classmate's row is not decoration: it is what
-- lets the bucket-wide scan distinguish "confined to my folder" from "empty result".
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('setup-photos', '7a000000-0000-4000-8000-0000000000a1/desk.jpg',
   '7a000000-0000-4000-8000-0000000000a1', '7a000000-0000-4000-8000-0000000000a1'),
  ('setup-photos', '7a000000-0000-4000-8000-0000000000a2/bunk.jpg',
   '7a000000-0000-4000-8000-0000000000a2', '7a000000-0000-4000-8000-0000000000a2');

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

DO $$
DECLARE
  owner_u     uuid := '7a000000-0000-4000-8000-0000000000a1';
  classmate_u uuid := '7a000000-0000-4000-8000-0000000000a2';
  owner_obj    text := '7a000000-0000-4000-8000-0000000000a1/desk.jpg';
  classmate_obj text := '7a000000-0000-4000-8000-0000000000a2/bunk.jpg';
  n int;
  visible text;
BEGIN
  -- ── 1. The owner can resolve their own object ─────────────────────────────
  -- This is the direction the migration was written for: Storage resolves the
  -- object through SELECT before it will delete it, so a 0-row read here is the
  -- `200 []` orphan the migration header describes.
  PERFORM pg_temp._as_user(owner_u);
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'setup-photos' AND name = owner_obj;
  PERFORM pg_temp._assert('setup-photos: owner reads their own object (cleanup can resolve it)',
    n = 1, n::text);

  -- ── 2. A classmate cannot ────────────────────────────────────────────────
  -- Same school, same bucket, someone else's prefix. This is the assertion that
  -- goes red against `USING (bucket_id = 'setup-photos')`.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'setup-photos' AND name = owner_obj;
  PERFORM pg_temp._assert('setup-photos: a classmate cannot read the owner''s object',
    n = 0, n::text);

  -- ── 3. …and the confinement holds across the whole bucket ────────────────
  -- Scanning without a name predicate: each caller must see exactly one row, their
  -- own. A loosened predicate shows two here even if assertion 2 were somehow
  -- satisfied by a drifted seed.
  PERFORM pg_temp._as_user(classmate_u);
  SELECT count(*), max(name) INTO n, visible FROM storage.objects
   WHERE bucket_id = 'setup-photos';
  PERFORM pg_temp._assert('setup-photos: classmate scanning the bucket sees exactly one row',
    n = 1, n::text);
  PERFORM pg_temp._assert('setup-photos: …and that one row is their own',
    visible = classmate_obj, coalesce(visible, '<null>'));

  PERFORM pg_temp._as_user(owner_u);
  SELECT count(*), max(name) INTO n, visible FROM storage.objects
   WHERE bucket_id = 'setup-photos';
  PERFORM pg_temp._assert('setup-photos: owner scanning the bucket sees exactly one row',
    n = 1, n::text);
  PERFORM pg_temp._assert('setup-photos: …and that one row is their own',
    visible = owner_obj, coalesce(visible, '<null>'));

  -- ── 4. anon reads nothing ────────────────────────────────────────────────
  -- The policy is granted TO authenticated. A signed-out visitor still gets images
  -- through the public object URL; it must not get the object table.
  PERFORM pg_temp._assume('anon');
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'setup-photos';
  PERFORM pg_temp._assert('setup-photos: signed-out visitor reads zero object rows',
    n = 0, n::text);

  -- ── 5. Structural pins (see the header for why these are not behavioural) ─
  PERFORM pg_temp._assume('postgres');

  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'storage.objects'::regclass
     AND polname = 'Users can view their own setup photo objects'
     AND polcmd = 'r'
     AND pg_get_expr(polqual, polrelid) LIKE '%setup-photos%'
     AND pg_get_expr(polqual, polrelid) LIKE '%foldername%'
     AND (SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles WHERE oid = ANY (polroles))
         = ARRAY['authenticated']::text[];
  PERFORM pg_temp._assert('setup-photos: SELECT policy is own-folder and granted to authenticated only',
    n = 1, n::text);

  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid = 'storage.objects'::regclass
     AND polname = 'Users can delete their own setup photos'
     AND polcmd = 'd'
     AND pg_get_expr(polqual, polrelid) LIKE '%setup-photos%'
     AND pg_get_expr(polqual, polrelid) LIKE '%foldername%';
  PERFORM pg_temp._assert('setup-photos: own-folder DELETE policy still present (the other half of cleanup)',
    n = 1, n::text);

  SELECT count(*) INTO n FROM storage.buckets
   WHERE id = 'setup-photos' AND public IS true AND file_size_limit = 10485760;
  PERFORM pg_temp._assert('setup-photos: bucket still public-read with a 10MB cap',
    n = 1, n::text);

  PERFORM pg_temp._assume('postgres');
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed in setup_photos_owner_select', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
