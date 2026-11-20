-- covers: 20260929000000_listing_building_tenant_consistency.sql
-- covers: 20261002000000_buildings_marketplace_group_scope.sql
-- A listing may point at a building at its own school, or at any school sharing its
-- marketplace group — and at nothing else (migrations 20260929000000, widened by
-- 20261002000000).
--
-- WHAT CHANGED AND WHY THE OLD ASSERTION WAS WRONG. 20260929000000 asserted
-- `building.university_id = listing.university_id`, and this file asserted it back.
-- Both were wrong about the domain: a building is a physical object. Skyvue is a mile
-- from CMU, Carlow is across the street from Pitt, and the 40-row Oakland registry is
-- "the buildings in Oakland", not "Pitt's buildings" — its `university_id` records who
-- seeded the row, not who may live there. The old rule forbade the actual product
-- case, so `case 2` below now asserts the OPPOSITE of what it asserted before, on
-- purpose. The guard is not removed; its predicate is corrected to the marketplace
-- group, which is the boundary the rest of the marketplace has used since
-- 20260918000000.
--
-- The claim under test is NOT "the trigger function reads correctly". It is that a
-- caller who sets `building_id` by hand — one raw POST to PostgREST, since as of
-- 2026-08-18 the composer never requires the field at all — cannot land a row whose
-- building sits outside its listing's marketplace group. So every
-- case here ATTEMPTS the write as a real `authenticated` client and reads the outcome,
-- and the negative cases assert the row is ABSENT afterwards rather than trusting the
-- error string.
--
-- The three failure modes this file is shaped to catch, each of which would let it
-- pass for the wrong reason:
--
--   1. A HARNESS EXEMPTION. `set_config('role', …)` changes current_user but not
--      session_user, and this repo has three shipped triggers that exempt
--      session_user IN ('postgres','supabase_admin'). Under that idiom a probe can
--      assert a guard while standing outside it. pg_temp._assume() reproduces the
--      real client identity (session_user='authenticator'), same as
--      sublease_verified_lister_gate.test.sql; harness_role_fidelity.test.sql fails
--      the suite if that stops being true.
--
--   2. AN INVISIBLE ROW. `public.buildings` carries a RESTRICTIVE tenant_isolation
--      policy. If the trigger function were invoker-rights, its lookup of an
--      out-of-group building inside a Pitt session would return zero rows, the
--      function would take its "no such building, let the FK complain" branch, and the
--      insert would be REFUSED — by the foreign key, with 23503. A test that only
--      asserted "it errored" would go green on a trigger that never ran. So every
--      negative asserts the SQLSTATE is 23514 (the trigger) and NOT 23503 (the FK).
--
--   3. A GUARD THAT ONLY WIDENED. The group arm makes the rule LOOSER, so a trigger
--      body that accidentally allows everything now passes cases 2 and 3 and only
--      fails on the out-of-group case. That case therefore uses a school with
--      `marketplace_group IS NULL` — the state a brand-new tenant is in before anyone
--      puts it in a group — and is asserted for both the trigger and the RLS policy.
--
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/listing_building_tenant_consistency.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ─────────────
-- Identical to sublease_verified_lister_gate.test.sql; see the note there.
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

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- A NULL condition is a FAILURE, never a pass. `cond` comes from expressions like
  -- `state = '23514'` where `state` can be NULL, and `NULL` in an IF reads as false
  -- but would insert as NULL and slip past a `WHERE NOT pass` tally.
  INSERT INTO test_results VALUES (label, coalesce(cond, false), detail);
  IF NOT coalesce(cond, false) THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: % %', label, CASE WHEN detail = '' THEN '' ELSE '(' || detail || ')' END;
  END IF;
END;
$$;

-- Returns 'sqlstate|message' on failure, NULL on success. The SQLSTATE is carried
-- out deliberately: "it raised" is not the assertion — "the TRIGGER raised" is, and
-- 23514 vs 23503 is the only thing that separates them.
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
  RETURN SQLSTATE || '|' || SQLERRM;
END;
$$;

-- Read a scalar count as a real authenticated client, so RLS applies. Restores
-- `postgres` before returning, because _assert() and every later read run outside
-- the impersonation.
CREATE OR REPLACE FUNCTION pg_temp._count_as(p_uid uuid, p_sql text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RAISE;
END;
$$;

-- ── fixtures ────────────────────────────────────────────────────────────────
-- THREE tenants. Two share a marketplace group (the product case), and the third has
-- `marketplace_group IS NULL` — which is what makes the negative case load-bearing.
-- Without it every assertion here would also pass against a trigger that allows
-- everything, since Pitt, CMU and Carlow are all in `pittsburgh`.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
   ARRAY['pitt.edu'], true, 'pittsburgh'),
  ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
   ARRAY['andrew.cmu.edu', 'cmu.edu'], true, 'pittsburgh'),
  ('00000000-0000-4000-8000-0000000000ff', 'probe-nogroup', 'Probe University (no group)', 'Probe',
   ARRAY['probe-nogroup.edu'], true, NULL)
ON CONFLICT (id) DO UPDATE
  SET email_domains     = EXCLUDED.email_domains,
      is_active         = true,
      marketplace_group = EXCLUDED.marketplace_group;

-- Verified listers: a confirmed address at a live tenant domain plus a housing
-- record, which is what can_post_sublease() requires. The gate under test here is the
-- building one, so every lister must clear that other gate cleanly — otherwise a
-- refusal proves nothing about these migrations.
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  ('dddddddd-0000-4000-8000-000000000301', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'building-probe@pitt.edu', now()),
  ('dddddddd-0000-4000-8000-000000000302', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'building-probe-2@pitt.edu', now()),
  ('dddddddd-0000-4000-8000-000000000303', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'building-probe@andrew.cmu.edu', now()),
  ('dddddddd-0000-4000-8000-0000000003ff', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'building-probe@probe-nogroup.edu', now())
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, email_confirmed_at = EXCLUDED.email_confirmed_at;

-- The auth.users trigger creates the profiles row first, so every seeded column has
-- to be repeated in the ON CONFLICT branch or it is silently dropped.
INSERT INTO public.profiles (id, full_name, university_id, role, current_dorm) VALUES
  ('dddddddd-0000-4000-8000-000000000301', 'Building Probe',
   '00000000-0000-4000-8000-000000000001', 'user', 'Sutherland Hall'),
  ('dddddddd-0000-4000-8000-000000000302', 'Building Probe Two',
   '00000000-0000-4000-8000-000000000001', 'user', 'Sutherland Hall'),
  ('dddddddd-0000-4000-8000-000000000303', 'Building Probe CMU',
   '00000000-0000-4000-8000-000000000002', 'user', 'Morewood Gardens'),
  ('dddddddd-0000-4000-8000-0000000003ff', 'Building Probe Nogroup',
   '00000000-0000-4000-8000-0000000000ff', 'user', 'Probe Hall')
ON CONFLICT (id) DO UPDATE
  SET university_id = EXCLUDED.university_id,
      role          = EXCLUDED.role,
      current_dorm  = EXCLUDED.current_dorm;

-- One subleasable building per tenant. `abbr` is NOT NULL and globally unique, so
-- these use the OC- convention scripts/seed-sublease-buildings.mjs mints.
INSERT INTO public.buildings (id, abbr, name, address, lat, lng, university_id, kind, is_subleasable) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'OC-TESTPITT1', 'Probe Apartments (Pitt)',
   '3333 Forbes Ave, Pittsburgh, PA 15213', 40.4419, -79.9569,
   '00000000-0000-4000-8000-000000000001', 'off_campus', true),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'OC-TESTCMU01', 'Probe Apartments (CMU)',
   '5000 Forbes Ave, Pittsburgh, PA 15213', 40.4433, -79.9436,
   '00000000-0000-4000-8000-000000000002', 'off_campus', true),
  ('bbbbbbbb-0000-4000-8000-0000000000ff', 'OC-TESTNOGRP', 'Probe Apartments (no group)',
   '1 Nowhere Rd, Elsewhere, PA 00000', 41.0000, -80.0000,
   '00000000-0000-4000-8000-0000000000ff', 'off_campus', true)
ON CONFLICT (id) DO UPDATE
  SET university_id = EXCLUDED.university_id, is_subleasable = EXCLUDED.is_subleasable;

-- ── shape of the guard: the conventions this repo requires of a definer fn ───
DO $$
DECLARE
  v_secdef boolean;
  v_config text[];
  v_src    text;
BEGIN
  SELECT prosecdef, proconfig, prosrc INTO v_secdef, v_config, v_src
  FROM pg_proc WHERE oid = 'public.validate_listing_building_tenant()'::regprocedure;

  PERFORM pg_temp._assert('trigger fn is SECURITY DEFINER', coalesce(v_secdef, false));
  -- Pinned search_path is not decoration on a definer function: without it the
  -- caller chooses which `buildings` the lookup resolves to.
  PERFORM pg_temp._assert('trigger fn pins search_path',
    v_config IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%'),
    coalesce(array_to_string(v_config, ','), '<null>'));

  -- The trigger must NOT reach for shares_marketplace(): that helper resolves the
  -- viewer against current_university_id(), so the invariant would depend on who
  -- issued the write. A service-role backfill has no current_university_id() at all.
  PERFORM pg_temp._assert('trigger fn does NOT depend on the session (no shares_marketplace)',
    v_src NOT LIKE '%shares_marketplace%');
  PERFORM pg_temp._assert('trigger fn compares marketplace_group directly',
    v_src LIKE '%marketplace_group%');

  PERFORM pg_temp._assert('trigger is BEFORE INSERT OR UPDATE on marketplace_listings',
    EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.marketplace_listings'::regclass
        AND tgname = 'trg_validate_listing_building_tenant'
        AND NOT tgisinternal
        AND (tgtype::int & 2) > 0    -- BEFORE
        AND (tgtype::int & 4) > 0    -- INSERT
        AND (tgtype::int & 16) > 0   -- UPDATE
    ));

  -- Ordering is load-bearing: trg_set_university_id derives a null university_id
  -- from the inserting profile, and must run first or this trigger compares a real
  -- building against NULL and rejects a legitimate post.
  PERFORM pg_temp._assert('trg_set_university_id fires before the building check',
    'trg_set_university_id' < 'trg_validate_listing_building_tenant');
END $$;

-- ── the RLS half: the registry reads at GROUP range, and stops there ─────────
DO $$
DECLARE
  v_using text;
  v_check text;
  n int;
BEGIN
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
  FROM pg_policy
  WHERE polrelid = 'public.buildings'::regclass AND polname = 'tenant_isolation';

  PERFORM pg_temp._assert('buildings.tenant_isolation reads at marketplace-group range',
    v_using LIKE '%shares_marketplace%', coalesce(v_using, '<null>'));
  -- Read wide, write narrow — the same split marketplace_listings ships. If this
  -- inverts, a student could write a registry row into another school.
  PERFORM pg_temp._assert('buildings.tenant_isolation WITH CHECK stays own-school',
    v_check NOT LIKE '%shares_marketplace%', coalesce(v_check, '<null>'));

  -- Behavioural, not textual. A CMU student must SEE the Pitt-seeded Oakland row —
  -- this is the whole point of the change, and it is what the picker depends on.
  n := pg_temp._count_as('dddddddd-0000-4000-8000-000000000303',
    'SELECT count(*) FROM public.buildings WHERE id = ''bbbbbbbb-0000-4000-8000-000000000001''');
  PERFORM pg_temp._assert('a CMU student SEES the Pitt-seeded Oakland building', n = 1, n::text);

  -- ...and the groupless school still sees only its own. This is the assertion that
  -- separates "widened to the group" from "widened to everything".
  n := pg_temp._count_as('dddddddd-0000-4000-8000-0000000003ff',
    'SELECT count(*) FROM public.buildings WHERE id = ''bbbbbbbb-0000-4000-8000-000000000001''');
  PERFORM pg_temp._assert('a GROUPLESS school does NOT see the Pitt building', n = 0, n::text);

  n := pg_temp._count_as('dddddddd-0000-4000-8000-0000000003ff',
    'SELECT count(*) FROM public.buildings WHERE id = ''bbbbbbbb-0000-4000-8000-0000000000ff''');
  PERFORM pg_temp._assert('a GROUPLESS school still sees its own building', n = 1, n::text);

  -- The reverse direction of the same isolation: the group cannot see out of itself.
  n := pg_temp._count_as('dddddddd-0000-4000-8000-000000000301',
    'SELECT count(*) FROM public.buildings WHERE id = ''bbbbbbbb-0000-4000-8000-0000000000ff''');
  PERFORM pg_temp._assert('a Pitt student does NOT see the groupless school''s building', n = 0, n::text);
END $$;

-- ── the write path, attempted for real ──────────────────────────────────────
DO $$
DECLARE
  err   text;
  state text;
  n     int;
BEGIN
  -- 1. THE FAILURE PATH, BY RAW CALL. A Pitt lister, a Pitt listing, and an
  --    OUT-OF-GROUP building id typed straight into the INSERT — exactly what a
  --    caller can send by hand. university_id is passed
  --    EXPLICITLY so the mismatch does not depend on trigger ordering.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000301',
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, is_sublease, sublease_start, sublease_end, building_name, building_id) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000301'', ''dddddddd-0000-4000-8000-000000000301'', '
    || '''Probe Apartments (no group)'', 800, ''other'', ''00000000-0000-4000-8000-000000000001'', '
    || 'true, ''2026-09-01'', ''2026-12-20'', ''Probe Apartments (no group)'', '
    || '''bbbbbbbb-0000-4000-8000-0000000000ff'')');

  state := split_part(coalesce(err, ''), '|', 1);
  PERFORM pg_temp._assert('out-of-group building_id is REFUSED', err IS NOT NULL,
    coalesce(err, '(no error - a groupless school''s building landed on a Pitt listing)'));

  -- 23514, not 23503. See the header: an FK error here would mean the trigger's
  -- lookup came back empty, i.e. it never actually inspected the out-of-group row.
  PERFORM pg_temp._assert('...raised by the TRIGGER (SQLSTATE 23514), not the FK (23503)',
    state = '23514', 'SQLSTATE=' || coalesce(nullif(state, ''), '<none>'));

  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000301';
  PERFORM pg_temp._assert('out-of-group row absent afterwards', n = 0, n::text);

  -- 2. THE PRODUCT CASE, and the assertion that used to say the opposite. A CMU
  --    student subletting a room in an Oakland building whose registry row was
  --    seeded under Pitt. Same marketplace group, so it lands — WITH its building,
  --    which is what makes it pinnable on the map.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000303',
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, is_sublease, sublease_start, sublease_end, building_name, building_id) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000306'', ''dddddddd-0000-4000-8000-000000000303'', '
    || '''Probe Apartments (Pitt)'', 800, ''other'', ''00000000-0000-4000-8000-000000000002'', '
    || 'true, ''2026-09-01'', ''2026-12-20'', ''Probe Apartments (Pitt)'', '
    || '''bbbbbbbb-0000-4000-8000-000000000001'')');
  PERFORM pg_temp._assert('a CMU listing may reference a Pitt-seeded building in the SAME GROUP',
    err IS NULL, coalesce(err, ''));

  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000306'
      AND building_id = 'bbbbbbbb-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('...and the row kept its building, so it can be pinned', n = 1, n::text);

  -- 3. Same school still works. Without this, case 1 is satisfied by a trigger that
  --    rejects everything.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000301',
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, is_sublease, sublease_start, sublease_end, building_name, building_id) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000302'', ''dddddddd-0000-4000-8000-000000000301'', '
    || '''Probe Apartments (Pitt)'', 800, ''other'', ''00000000-0000-4000-8000-000000000001'', '
    || 'true, ''2026-09-01'', ''2026-12-20'', ''Probe Apartments (Pitt)'', '
    || '''bbbbbbbb-0000-4000-8000-000000000001'')');
  PERFORM pg_temp._assert('same-school building_id is ACCEPTED', err IS NULL, coalesce(err, ''));

  -- 4. A NULL building with REAL COORDINATES is the ordinary case now, not an
  --    edge one. Since 2026-08-18 a sublease is `building_name` = the typed
  --    address plus the lat/lng it geocoded to, and `building_id` is set only when
  --    the lister happened to accept an autocomplete suggestion. If this ever
  --    fails, the composer's default path is blocked at the database.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000302',
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, is_sublease, sublease_start, sublease_end, building_name, latitude, longitude) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000303'', ''dddddddd-0000-4000-8000-000000000302'', '
    || '''428 Semple St'', 800, ''other'', ''00000000-0000-4000-8000-000000000001'', '
    || 'true, ''2026-09-01'', ''2026-12-20'', ''428 Semple St'', 40.4386, -79.9556)');
  PERFORM pg_temp._assert('a typed address with coordinates and NO building_id is accepted',
    err IS NULL, coalesce(err, ''));

  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000303'
      AND building_id IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;
  PERFORM pg_temp._assert('...and it keeps its coordinates, so the map can pin it', n = 1, n::text);

  -- ...and the legacy shape — a name, no id, no coordinates — is still writable,
  -- because the rows Phase 1's typed fallback left behind must stay updatable.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000302',
    'UPDATE public.marketplace_listings SET building_name = ''428 Semple Street'' '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-000000000303''');
  PERFORM pg_temp._assert('a null-building sublease is still editable', err IS NULL, coalesce(err, ''));

  -- 5. THE UPDATE HALF. An insert-only check is theatre: post with your own
  --    building, then repoint it. `building_id` is an ordinary column with no
  --    protect-trigger of its own, so this is a one-statement attack.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000301',
    'UPDATE public.marketplace_listings '
    || 'SET building_id = ''bbbbbbbb-0000-4000-8000-0000000000ff'' '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-000000000302''');
  state := split_part(coalesce(err, ''), '|', 1);
  PERFORM pg_temp._assert('repointing at an OUT-OF-GROUP building is REFUSED',
    err IS NOT NULL, coalesce(err, '(no error)'));
  PERFORM pg_temp._assert('...also by the trigger (23514)',
    state = '23514', 'SQLSTATE=' || coalesce(nullif(state, ''), '<none>'));

  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000302'
      AND building_id = 'bbbbbbbb-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('listing still points at its original building', n = 1, n::text);

  -- ...while repointing WITHIN the group is allowed, which is the other half of the
  -- same rule and the one a too-strict fix would break.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000301',
    'UPDATE public.marketplace_listings '
    || 'SET building_id = ''bbbbbbbb-0000-4000-8000-000000000002'' '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-000000000302''');
  PERFORM pg_temp._assert('repointing at an IN-GROUP building is allowed',
    err IS NULL, coalesce(err, ''));

  -- 6. The invariant is about the ROW, not about subleases. An ITEM carrying an
  --    out-of-group building_id is the same wrong pin in Phase 2, and `is_sublease`
  --    is nowhere in the trigger's condition — asserted, because "it only applies to
  --    subleases" is exactly the kind of scope assumption that ages badly.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000302',
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, building_id) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000304'', ''dddddddd-0000-4000-8000-000000000302'', '
    || '''desk lamp'', 10, ''other'', ''00000000-0000-4000-8000-000000000001'', '
    || '''bbbbbbbb-0000-4000-8000-0000000000ff'')');
  state := split_part(coalesce(err, ''), '|', 1);
  PERFORM pg_temp._assert('an ITEM cannot carry an out-of-group building either',
    state = '23514', 'SQLSTATE=' || coalesce(nullif(state, ''), '<none>') || ' ' || coalesce(err, ''));
END $$;

-- ── the service role is not exempt ───────────────────────────────────────────
-- This is a CONSTRAINT, not a permission check, so it must hold for the seed
-- scripts and any future admin path too — the reason this is a trigger rather than a
-- restrictive RLS policy pair, which would bind `authenticated` only. It is also the
-- reason the trigger must not call shares_marketplace(): service_role has no
-- current_university_id(), so a session-resolved helper would evaluate to NULL here
-- and the guard would collapse to "allow".
DO $$
DECLARE
  err   text;
  state text;
BEGIN
  PERFORM pg_temp._assume('service_role');
  BEGIN
    INSERT INTO public.marketplace_listings
      (id, user_id, title, price, category, university_id, building_id)
    VALUES ('eeeeeeee-0000-4000-8000-000000000305', 'dddddddd-0000-4000-8000-000000000301',
            'service-role probe', 10, 'other', '00000000-0000-4000-8000-000000000001',
            'bbbbbbbb-0000-4000-8000-0000000000ff');
    err := NULL;
  EXCEPTION WHEN OTHERS THEN
    err := SQLSTATE || '|' || SQLERRM;
    state := SQLSTATE;
  END;
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('service_role is NOT exempt from the group check',
    state = '23514', 'SQLSTATE=' || coalesce(nullif(state, ''), '<none>') || ' ' || coalesce(err, '(no error)'));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in listing_building_tenant_consistency', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
