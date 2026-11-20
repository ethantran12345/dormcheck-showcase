-- P0-1 (security review 2026-08-01): the BEFORE INSERT trigger
-- force_insert_pre_moderation (migration 20260830000000) must land every
-- end-user INSERT as 'pending_review' with moderation_* nulled, reject an
-- attempt to self-assign moderation_decision, and leave the service_role path
-- untouched. All inside a rolled-back transaction.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_insert_moderation_gate.test.sql

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
  ('dddddddd-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('dddddddd-0000-4000-8000-000000000101', 'Insert User', '00000000-0000-4000-8000-000000000001', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

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

DO $$
DECLARE
  u uuid := 'dddddddd-0000-4000-8000-000000000101';
  err text;
  got_status text;
  got_decision text;
BEGIN
  -- 1. An end-user INSERT claiming status='available' must land 'pending_review'.
  err := pg_temp._exec_as(u,
    'INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000101'', '''||u||''', ''sneaky'', 10, ''other'', '
    || '''00000000-0000-4000-8000-000000000001'', ''available'')');
  PERFORM pg_temp._assert('end-user insert succeeds', err IS NULL, coalesce(err,''));
  SELECT status, moderation_decision INTO got_status, got_decision
    FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000101';
  PERFORM pg_temp._assert('claimed available is forced to pending_review',
    got_status = 'pending_review', coalesce(got_status,'<null>'));
  -- Folded in from the parallel session's draft: the landed row must also carry
  -- NO moderation decision — a non-null decision would pre-approve it.
  PERFORM pg_temp._assert('landed row carries no moderation_decision',
    got_decision IS NULL, coalesce(got_decision,'<null>'));

  -- 2. Self-assigning moderation_decision is rejected outright.
  err := pg_temp._exec_as(u,
    'INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status, moderation_decision) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000102'', '''||u||''', ''forged'', 10, ''other'', '
    || '''00000000-0000-4000-8000-000000000001'', ''pending_review'', ''approved'')');
  PERFORM pg_temp._assert('self-assigned moderation_decision is rejected', err IS NOT NULL, coalesce(err,''));

  -- 3. The service_role path is unaffected: a seeded row can be born approved+available.
  -- Clear the residual authenticated JWT claims left by _exec_as (is_local, still
  -- in this tx) so this raw INSERT runs as postgres (auth.role() = NULL → exempt).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp._assume('postgres');
  INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status, moderation_decision)
    VALUES ('eeeeeeee-0000-4000-8000-000000000103', u, 'service seed', 10, 'other',
            '00000000-0000-4000-8000-000000000001', 'available', 'approved');
  SELECT status, moderation_decision INTO got_status, got_decision
    FROM public.marketplace_listings WHERE id = 'eeeeeeee-0000-4000-8000-000000000103';
  PERFORM pg_temp._assert('service/seed path keeps available+approved',
    got_status = 'available' AND got_decision = 'approved', coalesce(got_status,'')||'/'||coalesce(got_decision,''));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in marketplace_insert_moderation_gate', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
