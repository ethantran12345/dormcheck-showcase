-- covers: 20260712220421_report_escalation_and_admin_email_log.sql
-- covers: 20260830020000_moderation_superadmin_scope.sql
-- P1-1 (security review 2026-08-01): moderation is superadmin-only
-- (migration 20260830020000). This is the LIVE cross-tenant probe: a real CMU
-- university_admin must be DENIED Pitt's content_reports — on the base table
-- (RLS re-scoped to is_superadmin()), through get_content_reports even when
-- explicitly asking for Pitt's university id (the RPC clamps non-superadmins to
-- current_university_id()), and on moderation_actions writes. It complements
-- tenant_registry.test.sql, which only proves the policy TEXT references
-- is_superadmin(); this proves the behavior with actual cross-tenant fixtures.
--
-- Reconciled from supabase/tests/security_remediation_2026_08.test.sql, a
-- parallel session's draft that truncated mid-write before these assertions.
-- All inside a rolled-back transaction.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/content_reports_cross_tenant_admin.test.sql

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
VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true),
  ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU', ARRAY['andrew.cmu.edu','cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),  -- Pitt student (setup owner)
  ('61000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),  -- Pitt superadmin
  ('61000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),  -- Pitt university_admin
  ('61000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)   -- CMU university_admin
ON CONFLICT (id) DO NOTHING;

-- DO UPDATE, not DO NOTHING: handle_new_user auto-creates null-university
-- profiles, and the role must land so is_admin derives (sync_is_admin_from_role).
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('61000000-0000-4000-8000-000000000001', 'XT Owner',    '00000000-0000-4000-8000-000000000001', 'user'),
  ('61000000-0000-4000-8000-000000000002', 'XT SA Pitt',  '00000000-0000-4000-8000-000000000001', 'superadmin'),
  ('61000000-0000-4000-8000-000000000003', 'XT UA Pitt',  '00000000-0000-4000-8000-000000000001', 'university_admin'),
  ('61000000-0000-4000-8000-000000000004', 'XT UA CMU',   '00000000-0000-4000-8000-000000000002', 'university_admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

-- A Pitt room setup and a report against it (the content lives at Pitt).
INSERT INTO public.student_setups (id, dorm_name, image_url, caption, user_id, university_id)
  VALUES (900003, 'Nordenberg', 'https://example.com/z.jpg', 'probe corner',
          '61000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

INSERT INTO public.content_reports (id, content_type, content_id, reporter_id, reason)
  SELECT '62000000-0000-4000-8000-000000000001', 'student_setup', ss.report_uuid,
         '61000000-0000-4000-8000-000000000002', 'cross-tenant probe'
  FROM public.student_setups ss WHERE ss.id = 900003;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
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
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp._assume('postgres'); RETURN SQLERRM;
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
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp._assume('postgres'); RAISE;
END;
$$;

DO $$
DECLARE
  sa  uuid := '61000000-0000-4000-8000-000000000002';
  uap uuid := '61000000-0000-4000-8000-000000000003';
  uac uuid := '61000000-0000-4000-8000-000000000004';
  pitt text := '00000000-0000-4000-8000-000000000001';
  rid  text := '62000000-0000-4000-8000-000000000001';
  n bigint;
  err text;
  reason_after text;
BEGIN
  -- Positive control: the superadmin sees the Pitt report both ways. Without
  -- this, every deny below could "pass" against a broken fixture.
  n := pg_temp._count_as(sa, 'SELECT 1 FROM public.content_reports WHERE id = '''||rid||'''');
  PERFORM pg_temp._assert('superadmin reads the report on the base table', n = 1, 'n='||n);
  n := pg_temp._count_as(sa,
    'SELECT 1 FROM public.get_content_reports(''student_setup'', NULL) WHERE report_id = '''||rid||'''');
  PERFORM pg_temp._assert('superadmin sees the report via get_content_reports', n = 1, 'n='||n);

  -- P1-1 core: the CMU university_admin gets NOTHING from Pitt's reports.
  n := pg_temp._count_as(uac, 'SELECT 1 FROM public.content_reports WHERE id = '''||rid||'''');
  PERFORM pg_temp._assert('CMU university_admin denied Pitt report on the base table', n = 0, 'n='||n);

  -- Even explicitly requesting Pitt's university id: non-superadmins are
  -- clamped to current_university_id(), so the Pitt row must not appear.
  n := pg_temp._count_as(uac,
    'SELECT 1 FROM public.get_content_reports(''student_setup'', '''||pitt||''') WHERE report_id = '''||rid||'''');
  PERFORM pg_temp._assert('CMU university_admin denied Pitt report via get_content_reports(pitt)', n = 0, 'n='||n);

  -- Same-school university_admin is ALSO off the base table (superadmin-only);
  -- their read path is the tenant-clamped RPC, which does show their school.
  n := pg_temp._count_as(uap, 'SELECT 1 FROM public.content_reports WHERE id = '''||rid||'''');
  PERFORM pg_temp._assert('Pitt university_admin denied the base table too', n = 0, 'n='||n);
  n := pg_temp._count_as(uap,
    'SELECT 1 FROM public.get_content_reports(''student_setup'', NULL) WHERE report_id = '''||rid||'''');
  PERFORM pg_temp._assert('Pitt university_admin still sees own-school report via the RPC', n = 1, 'n='||n);

  -- Writes: a CMU admin UPDATE must not land (RLS filters the row set — the
  -- statement "succeeds" touching 0 rows, so assert the row is unchanged).
  err := pg_temp._exec_as(uac,
    'UPDATE public.content_reports SET reason = ''tampered'' WHERE id = '''||rid||'''');
  SELECT reason INTO reason_after FROM public.content_reports WHERE id = rid::uuid;
  PERFORM pg_temp._assert('CMU university_admin UPDATE does not land',
    reason_after = 'cross-tenant probe', coalesce(err, coalesce(reason_after,'<null>')));

  -- moderation_actions: WITH CHECK is_superadmin() rejects the admin INSERT.
  err := pg_temp._exec_as(uac,
    'INSERT INTO public.moderation_actions (admin_id, action, content_type, content_id) '
    || 'VALUES ('''||uac||''', ''delete_content'', ''user'', gen_random_uuid())');
  PERFORM pg_temp._assert('CMU university_admin cannot write moderation_actions', err IS NOT NULL, coalesce(err,''));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in content_reports_cross_tenant_admin', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
