-- covers: 20261011010000_storage_owner_select_for_cleanup.sql
-- Probe for 20261011010000_storage_owner_select_for_cleanup: the setup-photos fix
-- (20260925000000, probed by setup_photos_owner_select.test.sql) extended to the six
-- other uid-prefixed public buckets, whose client cleanup was a silent no-op.
--
-- Same two-directional design as setup_photos_owner_select.test.sql, and for the same
-- reason: "the owner can see their own object" passes just as happily against
-- `USING (bucket_id = '<b>')`, a policy that shows every student every other student's
-- uploads. So per bucket, against two students at the SAME school:
--   · the owner resolves their own object (the delete path can now find it);
--   · a classmate reads ZERO rows for it;
--   · a classmate scanning the whole bucket sees exactly one row, their own;
--   · anon reads nothing;
--   · structural pin: the SELECT policy is own-folder and TO authenticated only.
-- DELETE stays structural-only in the setup-photos probe for the reason given there
-- (storage.protect_objects_delete raises on a direct DELETE).
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/storage_owner_select_for_cleanup.test.sql

BEGIN;

-- Harness role fidelity: see setup_photos_owner_select.test.sql / harness_role_fidelity.test.sql.
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
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin.';
END $_assume$;

SELECT pg_temp._assume('postgres');

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('7b000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('7b000000-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('7b000000-0000-4000-8000-0000000000b1', 'Upload Owner',     '00000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-0000000000b2', 'Upload Classmate', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- One object per student per bucket, under its owner's UUID prefix (the shape src/ writes).
INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
SELECT b, u || '/probe.jpg', u::uuid, u
  FROM unnest(ARRAY['avatars', 'dm-photos', 'marketplace-images', 'roommate-post-photos',
                    'business-logos', 'business-banners']) AS b
 CROSS JOIN unnest(ARRAY['7b000000-0000-4000-8000-0000000000b1',
                         '7b000000-0000-4000-8000-0000000000b2']) AS u;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  INSERT INTO test_results VALUES (label, coalesce(cond, false), detail);
  IF NOT coalesce(cond, false) THEN RAISE NOTICE 'FAIL: % - %', label, detail;
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
  owner_u     uuid := '7b000000-0000-4000-8000-0000000000b1';
  classmate_u uuid := '7b000000-0000-4000-8000-0000000000b2';
  owner_obj     text := '7b000000-0000-4000-8000-0000000000b1/probe.jpg';
  classmate_obj text := '7b000000-0000-4000-8000-0000000000b2/probe.jpg';
  b text;
  n int;
  visible text;
BEGIN
  FOREACH b IN ARRAY ARRAY['avatars', 'dm-photos', 'marketplace-images', 'roommate-post-photos',
                           'business-logos', 'business-banners']
  LOOP
    -- _assert() returns to postgres, so re-assume the caller before every read.
    PERFORM pg_temp._as_user(owner_u);
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b AND name = owner_obj;
    PERFORM pg_temp._assert(b || ': owner resolves their own object (cleanup can delete it)', n = 1, n::text);

    PERFORM pg_temp._as_user(classmate_u);
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b AND name = owner_obj;
    PERFORM pg_temp._assert(b || ': a classmate cannot read the owner''s object', n = 0, n::text);

    PERFORM pg_temp._as_user(classmate_u);
    SELECT count(*), max(name) INTO n, visible FROM storage.objects WHERE bucket_id = b;
    PERFORM pg_temp._assert(b || ': classmate bucket scan sees exactly their own row',
      n = 1 AND visible = classmate_obj, n::text || ' / ' || coalesce(visible, '<null>'));

    PERFORM pg_temp._assume('anon');
    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = b;
    PERFORM pg_temp._assert(b || ': signed-out visitor reads zero object rows', n = 0, n::text);

    SELECT count(*) INTO n FROM pg_policy
     WHERE polrelid = 'storage.objects'::regclass
       AND polname = 'Owners can view their own ' || b || ' objects'
       AND polcmd = 'r'
       AND pg_get_expr(polqual, polrelid) LIKE '%' || b || '%'
       AND pg_get_expr(polqual, polrelid) LIKE '%foldername%'
       AND (SELECT array_agg(rolname::text ORDER BY rolname) FROM pg_roles WHERE oid = ANY (polroles))
           = ARRAY['authenticated']::text[];
    PERFORM pg_temp._assert(b || ': SELECT policy is own-folder and granted to authenticated only', n = 1, n::text);
  END LOOP;
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed in storage_owner_select_for_cleanup', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
