-- P3 (guest exposure review 2026-08-01): the hardened anon marketplace
-- projection (20260830050000) must hold four properties:
--   A  no user_id column on either view (the per-student join key is gone);
--   D  fail-closed moderation predicate — a NULL-decision listing is invisible
--      to anon even when status='available'; an approved one is visible;
--   §  meetup_location on the anon path has room-number-shaped tokens stripped
--      (building-level text survives);
--   F  anon holds no SELECT on private.marketplace_listings_contact.
-- Plus, since 20260911000000 (#144/#155):
--   N  seller_name on the anon path is a FIRST NAME ONLY — no surname ever
--      reaches an unauthenticated caller.
-- All inside a rolled-back transaction.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_guest_view_harden.test.sql

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
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('71000000-0000-4000-8000-000000000001', 'Guest View Seller', '00000000-0000-4000-8000-000000000001', 'user')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Seeded as postgres (exempt from the P0-1 insert gate): one approved listing
-- with a room number in its meetup text, one NULL-decision 'available' row.
INSERT INTO public.marketplace_listings
  (id, user_id, title, price, category, university_id, status, moderation_decision, meetup_location)
VALUES
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
   'approved lamp', 5, 'other', '00000000-0000-4000-8000-000000000001',
   'available', 'approved', 'Nordenberg Room 1201B'),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000001',
   'legacy null-decision lamp', 5, 'other', '00000000-0000-4000-8000-000000000001',
   'available', NULL, 'Towers Lobby');

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
  n bigint;
  loc text;
  sname text;
BEGIN
  -- A: no user_id column on either projection.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'marketplace_public' AND column_name = 'user_id';
  PERFORM pg_temp._assert('public wrapper has no user_id column', n = 0, 'n='||n);
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'private' AND table_name = 'marketplace_public' AND column_name = 'user_id';
  PERFORM pg_temp._assert('private view has no user_id column', n = 0, 'n='||n);

  -- D: anon sees the approved row, never the NULL-decision one. Read under the
  -- anon role, then RESET before asserting (anon cannot write test_results).
  DECLARE
    n_approved bigint; n_null bigint;
  BEGIN
    PERFORM pg_temp._assume('anon');
    SELECT count(*) INTO n_approved FROM public.marketplace_public
     WHERE id = '72000000-0000-4000-8000-000000000001';
    SELECT count(*) INTO n_null FROM public.marketplace_public
     WHERE id = '72000000-0000-4000-8000-000000000002';
    SELECT meetup_location INTO loc FROM public.marketplace_public
     WHERE id = '72000000-0000-4000-8000-000000000001';
    SELECT seller_name INTO sname FROM public.marketplace_public
     WHERE id = '72000000-0000-4000-8000-000000000001';
    PERFORM pg_temp._assume('postgres');
    PERFORM pg_temp._assert('anon sees the approved listing', n_approved = 1, 'n='||n_approved);
    PERFORM pg_temp._assert('anon never sees a NULL-decision listing (fail closed)', n_null = 0, 'n='||n_null);
    PERFORM pg_temp._assert('meetup_location is room-number-stripped for anon',
      loc = 'Nordenberg', coalesce(loc, '<null>'));
    -- #144/#155: FIRST NAME ONLY. The seeded seller is 'Guest View Seller', so a
    -- regression to p.full_name shows up as the whole string rather than 'Guest'.
    -- Asserted as an equality AND as "single token", because the equality alone
    -- would still pass for a one-word full name in some future seed.
    PERFORM pg_temp._assert('seller_name is the first name only for anon',
      sname = 'Guest', coalesce(sname, '<null>'));
    PERFORM pg_temp._assert('seller_name carries no surname (single token) for anon',
      sname !~ '\s', coalesce(sname, '<null>'));
  END;

  -- F: anon holds no SELECT on the private contact view.
  PERFORM pg_temp._assert('anon has no select on private.marketplace_listings_contact',
    NOT has_table_privilege('anon', 'private.marketplace_listings_contact', 'select'));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in marketplace_guest_view_harden', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
