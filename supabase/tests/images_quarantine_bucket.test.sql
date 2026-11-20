-- covers: 20261008000000_images_quarantine_bucket.sql
--
-- The quarantine bucket is private and service-role only, and a quarantined object
-- always carries its preservation clock (migration 20261008000000_images_quarantine_bucket).
--
-- WHY THIS FILE EXISTS. Rejected images now MOVE into `images-quarantine` and must stay
-- there for one year (18 U.S.C. § 2258A(h) as amended by the REPORT Act). Two things
-- can silently undo that: a storage policy that lets a student read or write the
-- bucket, and an audit row that records a quarantine path with no retention date.
-- docs/audits/backend-audit-2026-09-06.md BA-07.
--
-- WHAT IS ASSERTED
--   §0 the bucket exists, is private, and no storage.objects policy names it.
--   §1 a signed-in student can neither list nor write objects in it, and anon sees
--      nothing, even when a quarantined object exists (seeded as the service side).
--   §2 moderation_actions refuses a quarantine_path without preserve_until, and accepts
--      the pair; the partial index for the clock exists.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/images_quarantine_bucket.test.sql

\set ON_ERROR_STOP on

\set uni_a   '00000000-0000-4000-8000-000000000001'
\set student 'ad4a0000-0000-4000-8000-0000000000d1'

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
  (:'student'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quarantine-student@pitt.edu', '', '', '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, email, full_name, university_id, role) VALUES
  (:'student'::uuid, 'quarantine-student@pitt.edu', 'Quarantine Student', :'uni_a', 'user')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, university_id = EXCLUDED.university_id, role = EXCLUDED.role;

-- A quarantined object, as the service side writes it (owner is the uploader on purpose:
-- ownership must NOT be what gates this bucket).
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('images-quarantine', '2026-09-06/setup_photo/setup-photos/1-probe.jpg', :'student'::uuid, :'student')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _r (k text PRIMARY KEY, err text, n bigint);

-- ═══ §0 bucket shape ═════════════════════════════════════════════════════════════════
INSERT INTO _r (k, n) SELECT '0a', count(*) FROM storage.buckets WHERE id = 'images-quarantine' AND public = false;
INSERT INTO _r (k, n) SELECT '0b', count(*) FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'images-quarantine';

-- ═══ §1 nobody but the service role ══════════════════════════════════════════════════
INSERT INTO _r (k, n) VALUES ('1a', pg_temp._count_as(:'student'::uuid,
  'SELECT count(*) FROM storage.objects WHERE bucket_id = ''images-quarantine'''));
INSERT INTO _r (k, err) VALUES ('1b', pg_temp._try_as(:'student'::uuid,
  format('INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES (''images-quarantine'', ''2026-09-06/setup_photo/x/planted.jpg'', %L, %L)', :'student', :'student')));
INSERT INTO _r (k, n) VALUES ('1c', pg_temp._count_anon(
  'SELECT count(*) FROM storage.objects WHERE bucket_id = ''images-quarantine'''));

-- ═══ §2 the clock ════════════════════════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('2a', pg_temp._try(
  'INSERT INTO public.moderation_actions (admin_id, action, content_type, content_id, reason, quarantine_path, preserve_until) '
  || 'VALUES (NULL, ''auto_reject_image'', ''setup_photo'', gen_random_uuid(), ''probe: path without clock'', ''2026-09-06/x'', NULL)'));
INSERT INTO _r (k, err) VALUES ('2b', pg_temp._try(
  'INSERT INTO public.moderation_actions (admin_id, action, content_type, content_id, reason, quarantine_path, preserve_until) '
  || 'VALUES (NULL, ''auto_reject_image'', ''setup_photo'', gen_random_uuid(), ''probe: path with clock'', ''2026-09-06/y'', now() + interval ''366 days'')'));
INSERT INTO _r (k, n) SELECT '2c', count(*) FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = 'moderation_actions' AND indexname = 'idx_moderation_actions_preserve_until';

-- ═══ verdicts ════════════════════════════════════════════════════════════════════════
\echo '--- §0 bucket shape ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0a') = 1 THEN 'PASS'
  ELSE 'FAIL: images-quarantine is missing or public' END AS quarantine_bucket_is_private;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0b') = 0 THEN 'PASS'
  ELSE 'FAIL: ' || (SELECT n FROM _r WHERE k = '0b') || ' storage policy(ies) name images-quarantine' END AS no_policy_opens_quarantine;

\echo '--- §1 nobody but the service role ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '1a') = 0 THEN 'PASS'
  ELSE 'FAIL: a student can list quarantined objects (saw ' || (SELECT n FROM _r WHERE k = '1a') || ')' END AS student_sees_nothing;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1b') IS NOT NULL THEN 'PASS'
  ELSE 'FAIL: a student wrote into the quarantine bucket' END AS student_cannot_write;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '1c') = 0 THEN 'PASS'
  ELSE 'FAIL: anon can list quarantined objects (saw ' || (SELECT n FROM _r WHERE k = '1c') || ')' END AS anon_sees_nothing;

\echo '--- §2 the clock ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2a') LIKE '%moderation_actions_quarantine_needs_clock%' THEN 'PASS'
  ELSE 'FAIL: a quarantine path without preserve_until was accepted: ' || coalesce((SELECT err FROM _r WHERE k = '2a'), '<no error>') END AS path_without_clock_refused;
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '2b') IS NULL THEN 'PASS'
  ELSE 'FAIL: a quarantine path with its clock was refused: ' || (SELECT err FROM _r WHERE k = '2b') END AS path_with_clock_accepted;
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '2c') = 1 THEN 'PASS'
  ELSE 'FAIL: idx_moderation_actions_preserve_until is missing' END AS clock_is_indexed;

ROLLBACK;
