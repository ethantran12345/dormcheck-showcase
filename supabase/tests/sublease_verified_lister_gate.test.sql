-- covers: 20260907000000_sublease_verified_lister_gate.sql
-- Subleases behind a verified-LISTER gate (migration 20260907000000).
--
-- The claim under test is not "the policy text is right" — it is that an
-- UNVERIFIED account cannot get a sublease row into the table, by any route the
-- client has. So every case here ATTEMPTS the write as `authenticated` and reads
-- the outcome, and the negative cases assert the row is absent afterwards rather
-- than trusting the error string.
--
-- Also covered: the update escape hatch. An insert gate alone is theatre if you
-- can post an item and flip is_sublease afterwards.
--
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sublease_verified_lister_gate.test.sql

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
ON CONFLICT (id) DO UPDATE SET email_domains = EXCLUDED.email_domains, is_active = true;

-- Four listers, differing ONLY in the two facts the gate reads.
-- NOTE: the auth.users trigger creates the profiles row first, so every profile
-- seed below has to be an ON CONFLICT DO UPDATE, not a plain INSERT.
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at) VALUES
  -- confirmed .edu + a dorm  -> may post
  ('dddddddd-0000-4000-8000-000000000201', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'verified@pitt.edu', now()),
  -- confirmed .edu, NO dorm  -> may not
  ('dddddddd-0000-4000-8000-000000000202', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nodorm@pitt.edu', now()),
  -- UNconfirmed .edu + a dorm -> may not
  ('dddddddd-0000-4000-8000-000000000203', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'unconfirmed@pitt.edu', NULL),
  -- confirmed, but not a tenant domain + a dorm -> may not.
  -- Seeded at a tenant domain and moved off it below: check_university_email_on_signup
  -- is a BEFORE INSERT trigger, so a non-tenant address cannot be inserted directly.
  -- The account shape is real regardless — a domain can be retired from
  -- `universities.email_domains` under accounts that already exist.
  ('dddddddd-0000-4000-8000-000000000204', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'outsider@pitt.edu', now())
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, email_confirmed_at = EXCLUDED.email_confirmed_at;

UPDATE auth.users SET email = 'outsider@gmail.com'
  WHERE id = 'dddddddd-0000-4000-8000-000000000204';

INSERT INTO public.profiles (id, full_name, university_id, role, current_dorm) VALUES
  ('dddddddd-0000-4000-8000-000000000201', 'Verified Lister',
   '00000000-0000-4000-8000-000000000001', 'user', 'Sutherland Hall'),
  ('dddddddd-0000-4000-8000-000000000202', 'No Dorm',
   '00000000-0000-4000-8000-000000000001', 'user', NULL),
  ('dddddddd-0000-4000-8000-000000000203', 'Unconfirmed',
   '00000000-0000-4000-8000-000000000001', 'user', 'Sutherland Hall'),
  ('dddddddd-0000-4000-8000-000000000204', 'Outsider',
   '00000000-0000-4000-8000-000000000001', 'user', 'Sutherland Hall')
ON CONFLICT (id) DO UPDATE
  SET university_id = EXCLUDED.university_id,
      role          = EXCLUDED.role,
      current_dorm  = EXCLUDED.current_dorm;

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

CREATE OR REPLACE FUNCTION pg_temp._insert_sublease(p_uid uuid, p_id uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp._exec_as(p_uid,
    'INSERT INTO public.marketplace_listings '
    || '(id, user_id, title, price, category, university_id, is_sublease, sublease_start, sublease_end, building_name) '
    || 'VALUES (''' || p_id || ''', ''' || p_uid || ''', ''Sutherland Hall'', 800, ''other'', '
    || '''00000000-0000-4000-8000-000000000001'', true, ''2026-09-01'', ''2026-12-20'', ''Sutherland Hall'')');
$$;

-- ── the gate function itself ────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM pg_temp._assert('can_post_sublease: confirmed .edu + dorm',
    public.can_post_sublease('dddddddd-0000-4000-8000-000000000201'));
  PERFORM pg_temp._assert('can_post_sublease: no dorm',
    NOT public.can_post_sublease('dddddddd-0000-4000-8000-000000000202'));
  PERFORM pg_temp._assert('can_post_sublease: unconfirmed email',
    NOT public.can_post_sublease('dddddddd-0000-4000-8000-000000000203'));
  PERFORM pg_temp._assert('can_post_sublease: non-tenant domain',
    NOT public.can_post_sublease('dddddddd-0000-4000-8000-000000000204'));
  PERFORM pg_temp._assert('can_post_sublease: unknown user',
    NOT public.can_post_sublease('dddddddd-0000-4000-8000-0000000009ff'));
END $$;

-- ── the write path, attempted for real ──────────────────────────────────────
DO $$
DECLARE
  err text;
  n   int;
BEGIN
  -- 1. Verified lister: the sublease lands.
  err := pg_temp._insert_sublease('dddddddd-0000-4000-8000-000000000201',
                                  'eeeeeeee-0000-4000-8000-000000000201');
  PERFORM pg_temp._assert('verified lister CAN insert a sublease', err IS NULL, coalesce(err,''));
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000201';
  PERFORM pg_temp._assert('verified sublease row exists', n = 1, n::text);

  -- 2-4. Each unverified shape is REFUSED, and the row is absent afterwards.
  err := pg_temp._insert_sublease('dddddddd-0000-4000-8000-000000000202',
                                  'eeeeeeee-0000-4000-8000-000000000202');
  PERFORM pg_temp._assert('no dorm CANNOT insert a sublease', err IS NOT NULL, coalesce(err,'(no error)'));
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000202';
  PERFORM pg_temp._assert('no-dorm sublease row absent', n = 0, n::text);

  err := pg_temp._insert_sublease('dddddddd-0000-4000-8000-000000000203',
                                  'eeeeeeee-0000-4000-8000-000000000203');
  PERFORM pg_temp._assert('unconfirmed email CANNOT insert a sublease', err IS NOT NULL, coalesce(err,'(no error)'));
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000203';
  PERFORM pg_temp._assert('unconfirmed sublease row absent', n = 0, n::text);

  err := pg_temp._insert_sublease('dddddddd-0000-4000-8000-000000000204',
                                  'eeeeeeee-0000-4000-8000-000000000204');
  PERFORM pg_temp._assert('non-tenant domain CANNOT insert a sublease', err IS NOT NULL, coalesce(err,'(no error)'));
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000204';
  PERFORM pg_temp._assert('non-tenant sublease row absent', n = 0, n::text);

  -- 5. Items are completely unaffected — the gate must not cost an unverified
  --    student their ordinary marketplace post.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000202',
    'INSERT INTO public.marketplace_listings (id, user_id, title, price, category, university_id) '
    || 'VALUES (''eeeeeeee-0000-4000-8000-000000000212'', ''dddddddd-0000-4000-8000-000000000202'', '
    || '''desk lamp'', 10, ''other'', ''00000000-0000-4000-8000-000000000001'')');
  PERFORM pg_temp._assert('unverified user CAN still post an item', err IS NULL, coalesce(err,''));

  -- 6. ...and cannot then flip that item into a sublease. Without this the
  --    insert gate is decoration.
  --    The assertion is on the OUTCOME, not on an error, and deliberately so:
  --    `trg_sync_listing_post_type` (migration 20260910000000) rewrites
  --    is_sublease from post_type in a BEFORE UPDATE trigger, which runs ahead
  --    of the policy's WITH CHECK. So a bare `SET is_sublease = true` can come
  --    back without an error while having changed nothing. What must hold — and
  --    what is checked here — is that the row is not a sublease afterwards, by
  --    either column, whichever route was tried.
  PERFORM pg_temp._exec_as('dddddddd-0000-4000-8000-000000000202',
    'UPDATE public.marketplace_listings SET is_sublease = true '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-000000000212''');
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000212' AND is_sublease;
  PERFORM pg_temp._assert('is_sublease flip leaves the row an item', n = 0, n::text);

  -- ...and the same through the real discriminator, which the trigger DOES honour.
  err := pg_temp._exec_as('dddddddd-0000-4000-8000-000000000202',
    'UPDATE public.marketplace_listings SET post_type = ''sublease'' '
    || 'WHERE id = ''eeeeeeee-0000-4000-8000-000000000212''');
  PERFORM pg_temp._assert('post_type flip to sublease is refused',
    err IS NOT NULL, coalesce(err,'(no error)'));
  SELECT count(*) INTO n FROM public.marketplace_listings
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000212' AND is_sublease;
  PERFORM pg_temp._assert('post_type flip leaves the row an item', n = 0, n::text);
END $$;

-- ── guest browse: subleases stay behind the signed-in wall ──────────────────
-- marketplace_public hard-codes is_sublease = false in the view body, and this
-- asserts the consequence rather than the source: a signed-out visitor sees the
-- verified sublease inserted above NOWHERE.
DO $$
DECLARE
  n_sublease int;
  n_item     int;
BEGIN
  -- `_exec_as` sets request.jwt.claims transaction-locally and only RESETs the
  -- role, so without this the seed below still reads as an end-user request and
  -- the pre-moderation trigger rejects it. Clearing the claims is what actually
  -- returns us to the service/seed path.
  PERFORM set_config('request.jwt.claims', '', true);

  -- Seeded on the service path (as postgres), because the pre-moderation trigger
  -- refuses to let anything move a user-inserted row out of 'pending_review'.
  -- The PAIR is the point: an item and a sublease, identical in every field the
  -- view filters on except the discriminator. If the item is visible and the
  -- sublease is not, the guest wall is doing exactly one thing.
  INSERT INTO public.marketplace_listings
    (id, user_id, title, price, category, university_id, status, moderation_decision,
     is_sublease, sublease_start, sublease_end, building_name)
  VALUES
    ('eeeeeeee-0000-4000-8000-000000000221', 'dddddddd-0000-4000-8000-000000000201',
     'Sutherland Hall', 800, 'other', '00000000-0000-4000-8000-000000000001',
     'available', 'approved', true, '2026-09-01', '2026-12-20', 'Sutherland Hall'),
    ('eeeeeeee-0000-4000-8000-000000000222', 'dddddddd-0000-4000-8000-000000000201',
     'desk lamp', 10, 'other', '00000000-0000-4000-8000-000000000001',
     'available', 'approved', false, NULL, NULL, NULL);

  -- Asserted by id, not by an `is_sublease` predicate: the view does not expose
  -- the discriminator at all, which is itself part of why a guest cannot reach
  -- one. Cross-checked below against the same row being visible to a member.
  SET LOCAL role = 'anon';
  SELECT count(*) INTO n_sublease FROM public.marketplace_public
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000221';
  SELECT count(*) INTO n_item FROM public.marketplace_public
    WHERE id = 'eeeeeeee-0000-4000-8000-000000000222';
  PERFORM pg_temp._assume('postgres');
  PERFORM pg_temp._assert('signed-out visitor sees ZERO subleases', n_sublease = 0, n_sublease::text);
  PERFORM pg_temp._assert('...while the matched item IS guest-visible (the filter is the only difference)',
    n_item = 1, n_item::text);
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) FAILED in sublease_verified_lister_gate', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
