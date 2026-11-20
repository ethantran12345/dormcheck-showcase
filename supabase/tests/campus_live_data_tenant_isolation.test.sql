-- covers: 20261004000000_campus_live_data.sql
-- Probe for 20261004000000_campus_live_data.
--
-- That migration adds ten campus_* tables holding data ingested from a university's
-- public feeds, each class A: a permissive `USING (true)` SELECT policy for
-- authenticated, narrowed by the standard RESTRICTIVE tenant_isolation policy.
-- The permissive half is what makes a one-directional test worthless here — "a Pitt
-- student can read Pitt's laundry rooms" passes just as happily if the RESTRICTIVE
-- policy were never applied at all, i.e. against a schema where CMU reads Pitt's
-- dining menus. So both directions are asserted behaviourally, against two students
-- at DIFFERENT schools, with rows seeded for BOTH:
--
--   · each student reads their own school's row (the app works);
--   · each student scanning the table without a predicate sees EXACTLY one row, and
--     it is their own school's (the isolation actually confines, and cannot be
--     satisfied by a drifted seed that left the other school's row missing);
--   · anon reads nothing at all, on every table.
--
-- Writes are asserted separately and structurally as well as behaviourally: every
-- ingest runs as the service role, so no app role holds INSERT/UPDATE/DELETE on any
-- of these tables. A behavioural INSERT denial alone would not distinguish "RLS
-- refused it" from "the grant is missing", and the grant is the real control here,
-- so both are checked.
--
-- Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/campus_live_data_tenant_isolation.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
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

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true),
  ('00000000-0000-4000-8000-000000000002', 'cmu',  'Carnegie Mellon University', 'CMU', ARRAY['andrew.cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('7c000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Pitt student
  ('7c000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- CMU student
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so seed columns must land in
-- the ON CONFLICT branch (reference-db-probe-profiles-precreated).
INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('7c000000-0000-4000-8000-0000000000c1', 'Campus Pitt Student', '00000000-0000-4000-8000-000000000001'),
  ('7c000000-0000-4000-8000-0000000000c2', 'Campus CMU Student',  '00000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Clear whatever a real ingest has already written. The "sees exactly one row"
-- assertions below are the load-bearing ones and they only mean something against a
-- known table, so the probe owns its data outright. Safe: the whole file runs inside
-- a transaction that ends in ROLLBACK.
DELETE FROM public.campus_dining_menus;
DELETE FROM public.campus_dining_hours;
DELETE FROM public.campus_dining_locations;
DELETE FROM public.campus_laundry_machines;
DELETE FROM public.campus_laundry_rooms;
DELETE FROM public.campus_academic_events;
DELETE FROM public.campus_course_catalog;
DELETE FROM public.campus_ingest_cursor;
DELETE FROM public.campus_ingest_runs;

-- One row per school on each representative table. The second school's row is not
-- decoration: it is what lets an unpredicated scan distinguish "confined to my
-- school" from "the table happened to be empty".
INSERT INTO public.campus_laundry_rooms (university_id, external_id, upstream_name, residence_hall) VALUES
  ('00000000-0000-4000-8000-000000000001', 'probe-pitt-room', 'PROBE PITT HALL', 'Probe Pitt Hall'),
  ('00000000-0000-4000-8000-000000000002', 'probe-cmu-room',  'PROBE CMU HALL',  'Probe CMU Hall');

INSERT INTO public.campus_dining_locations (university_id, external_id, name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'probe-pitt-loc', 'Probe Pitt Eatery'),
  ('00000000-0000-4000-8000-000000000002', 'probe-cmu-loc',  'Probe CMU Eatery');

INSERT INTO public.campus_academic_events (university_id, calendar, event_date, title) VALUES
  ('00000000-0000-4000-8000-000000000001', 'academic', DATE '2026-09-04', 'Probe Pitt add/drop ends'),
  ('00000000-0000-4000-8000-000000000002', 'academic', DATE '2026-09-04', 'Probe CMU add/drop ends');

INSERT INTO public.campus_ingest_runs (university_id, source, ok) VALUES
  ('00000000-0000-4000-8000-000000000001', 'laundry', true),
  ('00000000-0000-4000-8000-000000000002', 'laundry', true);

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
  pitt_u uuid := '7c000000-0000-4000-8000-0000000000c1';
  cmu_u  uuid := '7c000000-0000-4000-8000-0000000000c2';
  tables text[] := ARRAY[
    'campus_laundry_rooms', 'campus_dining_locations', 'campus_academic_events', 'campus_ingest_runs'
  ];
  t text;
  n int;
  seen uuid;
  denied boolean;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- ── 1. Each student reads their own school's row (the app works) ──────────
    -- _assert() returns the session to postgres, so the role must be re-assumed
    -- before EVERY read (reference-db-probe-assert-resets-role).
    PERFORM pg_temp._as_user(pitt_u);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE university_id = $1', t)
      INTO n USING '00000000-0000-4000-8000-000000000001'::uuid;
    PERFORM pg_temp._assert(t || ': a Pitt student reads their own school''s row', n = 1, n::text);

    -- ── 2. …and cannot read the other school's ───────────────────────────────
    PERFORM pg_temp._as_user(pitt_u);
    EXECUTE format('SELECT count(*) FROM public.%I WHERE university_id = $1', t)
      INTO n USING '00000000-0000-4000-8000-000000000002'::uuid;
    PERFORM pg_temp._assert(t || ': a Pitt student cannot read CMU''s row', n = 0, n::text);

    -- ── 3. The confinement holds on an unpredicated scan ─────────────────────
    -- This is the load-bearing one: it goes red the moment the RESTRICTIVE policy
    -- is dropped, because the permissive USING (true) alone shows both rows.
    PERFORM pg_temp._as_user(cmu_u);
    EXECUTE format('SELECT count(*), (array_agg(DISTINCT university_id))[1] FROM public.%I', t) INTO n, seen;
    PERFORM pg_temp._assert(t || ': a CMU student scanning the table sees exactly one row', n = 1, n::text);
    PERFORM pg_temp._assert(t || ': …and that row is CMU''s',
      seen = '00000000-0000-4000-8000-000000000002'::uuid, coalesce(seen::text, '<null>'));

    -- ── 4. anon reads nothing ────────────────────────────────────────────────
    PERFORM pg_temp._assume('anon');
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      denied := false;
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
      n := 0;
    END;
    PERFORM pg_temp._assert(t || ': anon reads nothing (no grant, or no rows)', denied OR n = 0,
      format('denied=%s rows=%s', denied, n));

    -- ── 5. No app role may write ─────────────────────────────────────────────
    -- Two independent controls, asserted separately because they fail differently.
    -- (a) BEHAVIOURAL: a student inserting a row for their OWN school is refused.
    -- Their own school is the case that matters — a cross-tenant insert is refused
    -- by the tenant predicate and would pass even if writes were wide open.
    PERFORM pg_temp._as_user(pitt_u);
    BEGIN
      EXECUTE format(
        'INSERT INTO public.%I (university_id) VALUES ($1)', t)
        USING '00000000-0000-4000-8000-000000000001'::uuid;
      denied := false;
    EXCEPTION WHEN insufficient_privilege OR sqlstate '42501' THEN
      denied := true;
    WHEN others THEN
      -- A NOT NULL or CHECK violation means the statement got PAST the access
      -- controls, which is exactly what must not happen. Treat it as not denied.
      denied := false;
    END;
    PERFORM pg_temp._assert(t || ': a student cannot INSERT a row for their own school', denied, t);

    -- (b) STRUCTURAL: Supabase's default privileges hand authenticated the full
    -- arwdDxtm set on every new public table, so the revoke has to be explicit.
    -- Without it RLS is the only thing standing between a student and a write, and
    -- one future permissive policy would open the path silently.
    PERFORM pg_temp._assert(
      t || ': authenticated holds no INSERT/UPDATE/DELETE grant',
      NOT has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
      AND NOT has_table_privilege('authenticated', format('public.%I', t), 'UPDATE')
      AND NOT has_table_privilege('authenticated', format('public.%I', t), 'DELETE'),
      t);

    -- ── 6. …and the RESTRICTIVE policy is actually present ───────────────────
    -- Structural, and deliberately so: assertions 1-3 are behavioural, but a future
    -- migration could satisfy them by accident while dropping the named policy the
    -- class-A audit greps for.
    SELECT count(*) INTO n
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = t
       AND p.polname = 'tenant_isolation' AND p.polpermissive IS FALSE
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%current_university_id%';
    PERFORM pg_temp._assert(t || ': RESTRICTIVE tenant_isolation policy present on current_university_id()',
      n = 1, n::text);
  END LOOP;

  -- ── 7. The write path that does exist is the service role ─────────────────
  -- Every ingest connects with the service key and bypasses RLS. If that stopped
  -- being true the crons would fail closed, which is the safe direction, but the
  -- assertion names the assumption rather than leaving it implicit.
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM public.campus_laundry_rooms;
  PERFORM pg_temp._assert('campus_laundry_rooms: a BYPASSRLS session sees both schools (ingest path intact)',
    n = 2, n::text);

  PERFORM pg_temp._assume('postgres');
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed in campus_live_data_tenant_isolation', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
