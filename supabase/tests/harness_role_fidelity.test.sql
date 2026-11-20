-- HARNESS SELF-TEST: does assuming a role in this suite reproduce a REAL client?
--
-- This probe exists because of H1 in docs/security/reaudit-2026-08-06.md, which is a finding
-- about the scanner rather than the target. Until 2026-08-06 every probe here assumed a role
-- with `set_config('role', 'authenticated', true)`. That changes `current_user` but NOT
-- `session_user`, and three shipped triggers — protect_profile_role, protect_profile_is_admin,
-- protect_listing_verified_at — exempt `session_user IN ('postgres','supabase_admin')`. So
-- under the old idiom a plain user's own profile row happily took `role = 'superadmin'`,
-- `is_admin = true` and a new `university_id`, while the real client path refused all three.
-- The schema was sound; the TEST would have lied, and it would have lied in the direction
-- that reports a safe system as wide open (or, worse, blesses a guard that was never exercised).
--
-- Two things are asserted here, and they are different claims:
--
--   §1-2  MECHANISM. pg_temp._assume() yields the identity PostgREST actually presents
--         (session_user='authenticator', current_user='authenticated'/'anon'), and still
--         yields the historical seeding identity (session_user='postgres') for 'postgres'.
--         If someone reverts the idiom, this goes red immediately.
--
--   §3-4  CONSEQUENCE. The three previously-invisible guards are now exercised end to end:
--         a plain user cannot escalate their own role / is_admin / university_id, and a
--         lister cannot stamp their own verified_at. Every one of these assertions FAILED
--         (i.e. the write succeeded) under the old idiom — that is the mutation check, and
--         it was run: reverting _assume() to set_config('role',…) turns §3 red.
--
--   §5    INVENTORY. The set of functions whose body keys on `session_user` is pinned. A NEW
--         guard written that way is invisible to any probe that has not thought about this,
--         so adding one must land together with coverage here. The pin is the forcing function.
--
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/harness_role_fidelity.test.sql

\set ON_ERROR_STOP on

\set u_plain   'f1de1000-0000-4000-8000-00000000f001'
\set u_other   'f1de1000-0000-4000-8000-00000000f002'
\set uni       '00000000-0000-4000-8000-000000000001'
\set uni_alt   'f1de1000-0000-4000-8000-00000000fa11'
\set listing   'f1de1000-0000-4000-8000-00000000f101'

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- The helper under test. Kept byte-identical to the copy every other probe carries: if the
-- two ever drift, this file is asserting something the rest of the suite does not do.
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

CREATE OR REPLACE FUNCTION pg_temp._as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END $$;

-- Run one statement as `uid` and report the error text, or NULL when it was allowed.
-- The verdicts below check the ROW, not just the error: "it raised" and "it did not change
-- anything" are different claims, and only the second one is the security property.
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

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES (:'uni', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES (:'uni_alt', 'fidelity-alt', 'Fidelity Probe University', 'FPU', ARRAY['fpu.edu'], true)
ON CONFLICT (id) DO NOTHING;

-- This probe ROLLBACKs, so it leaves no auth.users rows behind — but it writes the four
-- GoTrue token columns anyway, because it is the file the next probe author copies from.
-- See content_reports_user_type.test.sql for why a NULL there takes down the admin user API.
INSERT INTO auth.users (id, instance_id, aud, role, email,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  (:'u_plain'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fidelity-plain@pitt.edu', '', '', '', ''),
  (:'u_other'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fidelity-other@pitt.edu', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, university_id, role)
VALUES
  (:'u_plain'::uuid, 'fidelity-plain@pitt.edu', 'Fidelity Plain', :'uni', 'user'),
  (:'u_other'::uuid, 'fidelity-other@pitt.edu', 'Fidelity Other', :'uni', 'user')
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, university_id = EXCLUDED.university_id, role = EXCLUDED.role;

INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id, status)
VALUES (:'listing'::uuid, :'u_plain'::uuid, 'fidelity probe listing', 10, 'other', :'uni', 'available')
ON CONFLICT (id) DO NOTHING;

-- ═══ §1 MECHANISM: the assumed identity is the one a real client presents ════════════════
\echo '--- 1a: _assume(authenticated) presents the PostgREST identity ---'
SELECT CASE WHEN pg_temp._assume('authenticated') IS NOT NULL
             AND session_user = 'authenticator'
             AND current_user = 'authenticated'
       THEN 'PASS' ELSE 'FAIL: session_user=' || session_user || ' current_user=' || current_user
       END AS fidelity_authenticated;

\echo '--- 1b: _assume(anon) presents the guest identity ---'
SELECT CASE WHEN pg_temp._assume('anon') IS NOT NULL
             AND session_user = 'authenticator'
             AND current_user = 'anon'
       THEN 'PASS' ELSE 'FAIL: session_user=' || session_user || ' current_user=' || current_user
       END AS fidelity_anon;

-- ═══ §2 the seeding identity is unchanged from before H1 was addressed ═══════════════════
\echo '--- 2: _assume(postgres) restores the historical seeding identity ---'
SELECT CASE WHEN pg_temp._assume('postgres') IS NOT NULL
             AND session_user = 'postgres'
             AND current_user = 'postgres'
       THEN 'PASS' ELSE 'FAIL: session_user=' || session_user || ' current_user=' || current_user
       END AS fidelity_seed_identity;

-- ═══ §3 CONSEQUENCE: the guards H1 said were invisible now actually deny ═════════════════
-- Each of these three passed as a SUCCESSFUL WRITE under the old idiom. They are the
-- mutation check for this whole change: revert _assume() and §3 goes red.
-- Each verdict below demands the GUARD'S OWN message, not merely "something went wrong".
-- Without that, an RLS predicate that quietly matched zero rows, or a missing column grant,
-- would satisfy a bare "did it raise?" check and the probe would report the trigger as
-- working when the trigger never ran. Matching the message is what pins the denial to
-- protect_profile_role / protect_profile_is_admin / protect_listing_verified_at.
\echo '--- 3a: a plain user cannot escalate their own role ---'
SELECT CASE
  WHEN pg_temp._try_as(:'u_plain'::uuid,
         format('UPDATE public.profiles SET role = %L WHERE id = %L', 'superadmin', :'u_plain'))
       LIKE '%Cannot modify your own role%'
   AND (SELECT role FROM public.profiles WHERE id = :'u_plain'::uuid) = 'user'
  THEN 'PASS'
  ELSE 'FAIL: role is now ' || coalesce((SELECT role::text FROM public.profiles WHERE id = :'u_plain'::uuid), '<gone>')
END AS self_role_escalation_denied;

\echo '--- 3b: a plain user cannot set their own is_admin ---'
SELECT CASE
  WHEN pg_temp._try_as(:'u_plain'::uuid,
         format('UPDATE public.profiles SET is_admin = true WHERE id = %L', :'u_plain'))
       LIKE '%Cannot modify your own is_admin status%'
   AND (SELECT is_admin FROM public.profiles WHERE id = :'u_plain'::uuid) IS NOT TRUE
  THEN 'PASS'
  ELSE 'FAIL: is_admin is now ' || coalesce((SELECT is_admin::text FROM public.profiles WHERE id = :'u_plain'::uuid), '<gone>')
END AS self_is_admin_denied;

-- Note the expected message: protect_profile_role() treats a university_id change as a
-- role change, so a self-relocation is refused by the SAME guard and reports it that way.
\echo '--- 3c: a plain user cannot move themselves to another school ---'
SELECT CASE
  WHEN pg_temp._try_as(:'u_plain'::uuid,
         format('UPDATE public.profiles SET university_id = %L WHERE id = %L', :'uni_alt', :'u_plain'))
       LIKE '%Cannot modify your own role%'
   AND (SELECT university_id FROM public.profiles WHERE id = :'u_plain'::uuid) = :'uni'::uuid
  THEN 'PASS'
  ELSE 'FAIL: university_id is now ' || coalesce((SELECT university_id::text FROM public.profiles WHERE id = :'u_plain'::uuid), '<gone>')
END AS self_tenant_move_denied;

-- ═══ §4 the same blind spot on the listings side ═════════════════════════════════════════
-- Honest caveat, because the mutation check says so: protect_listing_verified_at() exempts
-- only `session_user <> 'postgres'`, NOT the two-name list the profiles guards use. So this
-- verdict stays green even if _assume() is reverted, purely because the runner now connects
-- as supabase_admin. It IS the assertion that was impossible before this lane (the old
-- postgres connection was exempt), and it is a real regression guard — it is simply not
-- sensitive to the same variable as §3. Do not read a green §4 as proof the idiom is intact;
-- §1-3 are what prove that.
\echo '--- 4: a lister cannot stamp verified_at on their own listing ---'
SELECT CASE
  WHEN pg_temp._try_as(:'u_plain'::uuid,
         format('UPDATE public.marketplace_listings SET verified_at = now() WHERE id = %L', :'listing'))
       LIKE '%verified_at is managed by the verification review flow%'
   AND (SELECT verified_at FROM public.marketplace_listings WHERE id = :'listing'::uuid) IS NULL
  THEN 'PASS'
  ELSE 'FAIL: verified_at is now ' || coalesce((SELECT verified_at::text FROM public.marketplace_listings WHERE id = :'listing'::uuid), '<gone>')
END AS self_verified_at_denied;

-- ═══ §5 INVENTORY: pin every guard that keys on session_user ═════════════════════════════
-- A guard your tests cannot see is a guard you have not verified (reaudit §5 rule 3). The
-- harness can see these now, but only because someone came here and wrote the assertion. So
-- the SET is pinned: adding a new session_user-keyed function turns this red, and the way to
-- turn it green is to cover it above and then add the name here — deliberately, in the same
-- commit. Do not "fix" this by widening the list on its own.
\echo '--- 5: the set of session_user-keyed guards is unchanged ---'
SELECT CASE WHEN missing = '' AND unexpected = '' THEN 'PASS'
            ELSE 'FAIL: missing=[' || missing || '] unexpected=[' || unexpected || ']' END
       AS session_user_guard_inventory
FROM (
  WITH expected(name) AS (
    VALUES ('protect_listing_verified_at'),
           ('protect_profile_is_admin'),
           ('protect_profile_role'),
           ('sync_listing_verified_flag')
  ),
  actual(name) AS (
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ILIKE '%session_user%'
  )
  SELECT
    coalesce((SELECT string_agg(name, ', ' ORDER BY name) FROM (SELECT name FROM expected EXCEPT SELECT name FROM actual) m), '') AS missing,
    coalesce((SELECT string_agg(name, ', ' ORDER BY name) FROM (SELECT name FROM actual EXCEPT SELECT name FROM expected) u), '') AS unexpected
) q;

ROLLBACK;
