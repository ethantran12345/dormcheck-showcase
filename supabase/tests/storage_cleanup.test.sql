-- covers: 20261013000000_storage_cleanup.sql
--
-- Server-side image cleanup (A2): the private images-held bucket, the
-- 'auto_hold_image' audit action, and storage_unreferenced_objects() — the one
-- function the orphan sweeper and account deletion use to decide what to delete.
--
-- WHY THIS FILE EXISTS. The sweeper DELETES what this function returns. Two
-- failures would be unrecoverable: the function reaching images-quarantine (objects
-- held under the REPORT Act's one-year clock) or images-held (photos a moderator
-- has not ruled on), and the function calling a live photo unreferenced. Both are
-- asserted against the shipped function, not a re-implementation.
--
-- WHAT IS ASSERTED
--   §0 images-held exists, is private, no storage policy names it; auto_hold_image
--      is accepted by the action CHECK.
--   §1 a student and anon can neither list nor write images-held.
--   §2 the function refuses images-quarantine and images-held BY NAME (even as the
--      service role), refuses a non-upload bucket, a future cutoff and a limit over
--      500, and is not executable by authenticated or anon.
--   §3 against seeded objects: an old unreferenced object is listed; a referenced
--      one (plain URL, percent-encoded URL, inside a text[] column) is not; a recent
--      unreferenced one is not; the owner filter narrows to that owner.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/storage_cleanup.test.sql

\set ON_ERROR_STOP on

\set uni_a   '00000000-0000-4000-8000-000000000001'
\set student 'ad4a0000-0000-4000-8000-0000000000e1'
\set other   'ad4a0000-0000-4000-8000-0000000000e2'

BEGIN;

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

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._try_as(uid uuid, stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._count_as(uid uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp._as_user(uid);
  EXECUTE q INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN -1;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._count_anon(q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE q INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN -1;
END $$;

-- Run a statement as the service role (what the sweeper and edge functions are).
CREATE OR REPLACE FUNCTION pg_temp._try_service(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('service_role');
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._try(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  (:'uni_a', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO auth.users (id, instance_id, aud, role, email,
                        confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
  (:'student'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sweep-student@pitt.edu', '', '', '', ''),
  (:'other'::uuid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sweep-other@pitt.edu', '', '', '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, email, full_name, university_id, role) VALUES
  (:'student'::uuid, 'sweep-student@pitt.edu', 'Sweep Student', :'uni_a', 'user'),
  (:'other'::uuid,   'sweep-other@pitt.edu',   'Sweep Other',   :'uni_a', 'user')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, university_id = EXCLUDED.university_id, role = EXCLUDED.role;

-- Seeded objects (names are unique to this probe so the seed data cannot collide).
--   live-plain     referenced by profiles.avatar_url, plain URL
--   live space.jpg referenced percent-encoded (live%20space.jpg) in profile_photos[]
--   orphan-old     referenced by nothing, 3 days old          -> LISTED
--   orphan-new     referenced by nothing, 1 hour old          -> not listed (cutoff)
--   other-orphan   referenced by nothing, 3 days old, owned by `other`
INSERT INTO storage.objects (bucket_id, name, owner, owner_id, created_at) VALUES
  ('avatars', :'student' || '/sweepprobe-live-plain.jpg',     :'student'::uuid, :'student', now() - interval '3 days'),
  ('avatars', :'student' || '/sweepprobe-live space.jpg',     :'student'::uuid, :'student', now() - interval '3 days'),
  ('avatars', :'student' || '/sweepprobe-orphan-old.jpg',     :'student'::uuid, :'student', now() - interval '3 days'),
  ('avatars', :'student' || '/sweepprobe-orphan-new.jpg',     :'student'::uuid, :'student', now() - interval '1 hour'),
  ('avatars', :'other'   || '/sweepprobe-other-orphan.jpg',   :'other'::uuid,   :'other',   now() - interval '3 days'),
  ('images-held', 'f0000000-0000-4000-8000-000000000001/' || :'student' || '/sweepprobe-held.jpg', :'student'::uuid, :'student', now() - interval '3 days')
ON CONFLICT DO NOTHING;

UPDATE public.profiles
   SET avatar_url = 'http://127.0.0.1:54321/storage/v1/object/public/avatars/' || :'student' || '/sweepprobe-live-plain.jpg',
       profile_photos = ARRAY['http://127.0.0.1:54321/storage/v1/object/public/avatars/' || :'student' || '/sweepprobe-live%20space.jpg']
 WHERE id = :'student'::uuid;

CREATE TEMP TABLE _r (k text PRIMARY KEY, err text, n bigint, names text);
GRANT ALL ON _r TO service_role, authenticated, anon;

-- ═══ §0 shape ════════════════════════════════════════════════════════════════════════
INSERT INTO _r (k, n) SELECT '0a', count(*) FROM storage.buckets WHERE id = 'images-held' AND public = false;
INSERT INTO _r (k, n) SELECT '0b', count(*) FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'images-held';
INSERT INTO _r (k, err) VALUES ('0c', pg_temp._try(
  'INSERT INTO public.moderation_actions (admin_id, action, content_type, content_id, reason) '
  || 'VALUES (NULL, ''auto_hold_image'', ''profile_photo'', gen_random_uuid(), ''probe: hold row'')'));

-- ═══ §1 nobody but the service role ══════════════════════════════════════════════════
INSERT INTO _r (k, n) VALUES ('1a', pg_temp._count_as(:'student'::uuid,
  'SELECT count(*) FROM storage.objects WHERE bucket_id = ''images-held'''));
INSERT INTO _r (k, err) VALUES ('1b', pg_temp._try_as(:'student'::uuid,
  format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''images-held'', %L, %L, %L)',
         :'student' || '/planted.jpg', :'student', :'student')));
INSERT INTO _r (k, n) VALUES ('1c', pg_temp._count_anon(
  'SELECT count(*) FROM storage.objects WHERE bucket_id = ''images-held'''));

-- ═══ §2 refusals ═════════════════════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('2a', pg_temp._try_service(
  'SELECT count(*) FROM public.storage_unreferenced_objects(''images-quarantine'', now() - interval ''1 day'')'));
INSERT INTO _r (k, err) VALUES ('2b', pg_temp._try_service(
  'SELECT count(*) FROM public.storage_unreferenced_objects(''images-held'', now() - interval ''1 day'')'));
INSERT INTO _r (k, err) VALUES ('2c', pg_temp._try_service(
  'SELECT count(*) FROM public.storage_unreferenced_objects(''templates'', now() - interval ''1 day'')'));
INSERT INTO _r (k, err) VALUES ('2d', pg_temp._try_service(
  'SELECT count(*) FROM public.storage_unreferenced_objects(''avatars'', now() + interval ''1 day'')'));
INSERT INTO _r (k, err) VALUES ('2e', pg_temp._try_service(
  'SELECT count(*) FROM public.storage_unreferenced_objects(''avatars'', now() - interval ''1 day'', NULL, 501)'));
INSERT INTO _r (k, err) VALUES ('2f', pg_temp._try_as(:'student'::uuid,
  'SELECT count(*) FROM public.storage_unreferenced_objects(''avatars'', now() - interval ''1 day'')'));
INSERT INTO _r (k, n) SELECT '2g',
  (has_function_privilege('anon', 'public.storage_unreferenced_objects(text, timestamptz, uuid, integer)', 'EXECUTE'))::int;

-- ═══ §3 what it lists ════════════════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('3x', pg_temp._try_service($q$
  INSERT INTO _r (k, names)
  SELECT '3a', string_agg(name, ',' ORDER BY name)
    FROM public.storage_unreferenced_objects('avatars', now() - interval '1 day')
   WHERE name LIKE '%sweepprobe-%'
$q$));
INSERT INTO _r (k, err) VALUES ('3y', pg_temp._try_service(format($q$
  INSERT INTO _r (k, names)
  SELECT '3b', string_agg(name, ',' ORDER BY name)
    FROM public.storage_unreferenced_objects('avatars', now() - interval '1 day', %L::uuid)
   WHERE name LIKE '%%sweepprobe-%%'
$q$, :'other')));

-- ═══ verdicts ════════════════════════════════════════════════════════════════════════
\echo '--- §0 shape ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0a') = 1 THEN 'PASS'
  ELSE 'FAIL: images-held is missing or public' END AS held_bucket_is_private;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0b') = 0 THEN 'PASS'
  ELSE 'FAIL: a storage policy names images-held' END AS no_policy_opens_held;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '0c') IS NULL THEN 'PASS'
  ELSE 'FAIL: auto_hold_image refused: ' || (SELECT err FROM _r WHERE k = '0c') END AS auto_hold_image_accepted;

\echo '--- §1 nobody but the service role ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '1a') = 0 THEN 'PASS'
  ELSE 'FAIL: a student can list held objects (saw ' || (SELECT n FROM _r WHERE k = '1a') || ')' END AS student_sees_no_held;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1b') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a student wrote into images-held' END AS student_cannot_write_held;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '1c') = 0 THEN 'PASS'
  ELSE 'FAIL: anon can list held objects' END AS anon_sees_no_held;

\echo '--- §2 refusals ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2a') LIKE '%preserved bucket%' THEN 'PASS'
  ELSE 'FAIL: images-quarantine was not refused: ' || coalesce((SELECT err FROM _r WHERE k = '2a'), '<no error>') END AS quarantine_refused;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2b') LIKE '%preserved bucket%' THEN 'PASS'
  ELSE 'FAIL: images-held was not refused: ' || coalesce((SELECT err FROM _r WHERE k = '2b'), '<no error>') END AS held_refused;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2c') LIKE '%not a sweepable%' THEN 'PASS'
  ELSE 'FAIL: a non-upload bucket was accepted: ' || coalesce((SELECT err FROM _r WHERE k = '2c'), '<no error>') END AS other_bucket_refused;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2d') LIKE '%past moment%' THEN 'PASS'
  ELSE 'FAIL: a future cutoff was accepted' END AS future_cutoff_refused;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2e') LIKE '%1..500%' THEN 'PASS'
  ELSE 'FAIL: a limit over 500 was accepted' END AS limit_capped;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2f') LIKE '%permission denied%' THEN 'PASS'
  ELSE 'FAIL: a student could call the function: ' || coalesce((SELECT err FROM _r WHERE k = '2f'), '<no error>') END AS student_cannot_call;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '2g') = 0 THEN 'PASS'
  ELSE 'FAIL: anon can execute the function' END AS anon_cannot_call;

\echo '--- §3 what it lists ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '3x') IS NULL
             AND (SELECT names FROM _r WHERE k = '3a') =
                 :'student' || '/sweepprobe-orphan-old.jpg,' || :'other' || '/sweepprobe-other-orphan.jpg'
  THEN 'PASS'
  ELSE 'FAIL: expected exactly the two old orphans, got '
       || coalesce((SELECT names FROM _r WHERE k = '3a'), '<none>') || ' / ' || coalesce((SELECT err FROM _r WHERE k = '3x'), '')
  END AS lists_only_old_unreferenced;
SELECT CASE WHEN (SELECT names FROM _r WHERE k = '3b') = :'other' || '/sweepprobe-other-orphan.jpg' THEN 'PASS'
  ELSE 'FAIL: owner filter returned ' || coalesce((SELECT names FROM _r WHERE k = '3b'), '<none>')
       || ' / ' || coalesce((SELECT err FROM _r WHERE k = '3y'), '') END AS owner_filter_narrows;

ROLLBACK;
