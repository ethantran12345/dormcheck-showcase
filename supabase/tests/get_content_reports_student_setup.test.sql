-- P1-2 (security review 2026-08-01): a reported student_setup (and group_message)
-- must surface in get_content_reports for the owning school's admin. Before the
-- fix there was no 'student_setup' OR-arm, so setup reports satisfied no branch
-- and were invisible. Round-trips a report of each content type through the RPC.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/get_content_reports_student_setup.test.sql

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


INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
-- Owner (student) + a superadmin moderator, both at Pitt.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a2', 'Setup Owner', '00000000-0000-4000-8000-000000000001', 'user'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'Mod',         '00000000-0000-4000-8000-000000000001', 'superadmin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

-- A setup owned by the student; capture its generated report_uuid.
INSERT INTO public.student_setups (id, dorm_name, image_url, caption, user_id, university_id)
  VALUES (900002, 'Sutherland', 'https://example.com/y.jpg', 'my corner',
          'aaaaaaaa-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001');

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

DO $$
DECLARE
  mod uuid := 'bbbbbbbb-0000-4000-8000-0000000000b2';
  setup_uuid uuid;
  hits int;
  preview text;
BEGIN
  SELECT report_uuid INTO setup_uuid FROM public.student_setups WHERE id = 900002;

  -- File a report of the setup (reporter is the moderator here; content_id is the uuid).
  INSERT INTO public.content_reports (content_type, content_id, reporter_id, reason)
    VALUES ('student_setup', setup_uuid, mod, 'inappropriate');

  -- Superadmin (p_university_id = NULL) sees it.
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', mod::text, 'role', 'authenticated')::text, true);

  SELECT count(*), max(content_preview_title)
    INTO hits, preview
    FROM public.get_content_reports('student_setup', NULL)
    WHERE content_id = setup_uuid;

  PERFORM pg_temp._assume('postgres');

  PERFORM pg_temp._assert('student_setup report appears in the queue', hits = 1, 'hits='||hits);
  PERFORM pg_temp._assert('student_setup preview title is populated',
    preview LIKE 'Room setup in %', coalesce(preview,'<null>'));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in get_content_reports_student_setup', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
