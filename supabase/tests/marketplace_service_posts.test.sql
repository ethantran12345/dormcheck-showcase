-- covers: 20260910000000_marketplace_service_posts.sql
-- Service posts on marketplace_listings (migration 20260910000000).
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/marketplace_service_posts.test.sql
--
-- Three things this pins, all of which have a history of going wrong quietly:
--
--  1. STATUS CHECK EXACT-SET DRIFT. marketplace_listings_status_check has been
--     dropped and re-added eight times, and 20260731030000 silently deleted
--     'pending_review' by re-adding a set that predated it. A DROP/re-ADD is a
--     replacement, so "not narrower than before" is not enough — section 1
--     asserts set EQUALITY in both directions, the same shape as
--     content_type_check_drift.test.sql.
--  2. THE TWO LIFECYCLES CANNOT BLEED. An item must never reach 'claimed' and a
--     service post must never reach 'sold'.
--  3. NO PAYMENTS. A service post's price is pinned at 0 by the DB, not by the
--     client. This is a product rule, so it is asserted as one.
--
-- Plus the open -> claimed -> completed round trip through the RPCs, the
-- non-owner/cross-tenant denials, and the guest view inheriting service posts.
--
-- Wrapped in BEGIN..ROLLBACK: writes nothing that outlives the run, so it is
-- order-independent under TEST_DB_ORDER=reverse|shuffle.

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


-- ── fixtures ────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
        ARRAY['andrew.cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('5e111111-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('5e111111-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('5e111111-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so the seed columns
-- must live in ON CONFLICT DO UPDATE or they are silently dropped.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('5e111111-0000-4000-8000-000000000001', 'Poster',    '00000000-0000-4000-8000-000000000001', 'user'),
  ('5e111111-0000-4000-8000-000000000002', 'Helper',    '00000000-0000-4000-8000-000000000001', 'user'),
  ('5e111111-0000-4000-8000-000000000003', 'Outsider',  '00000000-0000-4000-8000-000000000002', 'user')
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
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN SQLERRM;
END;
$$;

-- ── 1. status CHECK exact-set drift guard ───────────────────────────────────
-- Update this list ONLY together with a migration that changes the constraint,
-- never to make a failing test pass. Re-read the header of
-- 20260910000000_marketplace_service_posts.sql § 4 before you touch it.
CREATE TEMP TABLE _authorized_status(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized_status VALUES
  ('available'), ('pending'), ('sold'),
  ('under_review'), ('expired'), ('pending_review'),
  -- 20260910000000: the service lifecycle.
  ('open'), ('claimed'), ('completed');

WITH actual AS (
  SELECT m[1] AS value
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
  WHERE c.conrelid = 'public.marketplace_listings'::regclass
    AND c.conname = 'marketplace_listings_status_check'
),
missing AS (SELECT value FROM _authorized_status EXCEPT SELECT value FROM actual),
extra   AS (SELECT value FROM actual EXCEPT SELECT value FROM _authorized_status)
SELECT CASE
  WHEN (SELECT count(*) FROM missing) > 0
    THEN 'FAIL marketplace_listings_status_check is TOO NARROW, missing: '
         || (SELECT string_agg(value, ', ') FROM missing)
         || ' — a later DROP/re-ADD replaced the set instead of restating it'
  WHEN (SELECT count(*) FROM extra) > 0
    THEN 'FAIL marketplace_listings_status_check is TOO BROAD, unexpected: '
         || (SELECT string_agg(value, ', ') FROM extra)
  ELSE 'PASS marketplace_listings_status_check is exactly the 9 authorized values'
END AS status_exact_set_equality;

SELECT CASE
  WHEN convalidated THEN 'PASS marketplace_listings_status_check is validated'
  ELSE 'FAIL marketplace_listings_status_check exists but is NOT VALID'
END AS status_validated
FROM pg_constraint
WHERE conrelid = 'public.marketplace_listings'::regclass
  AND conname = 'marketplace_listings_status_check';

-- ── 2. post_type CHECK exact-set guard ──────────────────────────────────────
CREATE TEMP TABLE _authorized_post_type(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized_post_type VALUES
  ('item'), ('sublease'), ('request_help'), ('offer_help');

WITH actual AS (
  SELECT m[1] AS value
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
  WHERE c.conrelid = 'public.marketplace_listings'::regclass
    AND c.conname = 'marketplace_listings_post_type_check'
),
missing AS (SELECT value FROM _authorized_post_type EXCEPT SELECT value FROM actual),
extra   AS (SELECT value FROM actual EXCEPT SELECT value FROM _authorized_post_type)
SELECT CASE
  WHEN (SELECT count(*) FROM missing) > 0
    THEN 'FAIL post_type CHECK is TOO NARROW, missing: '
         || (SELECT string_agg(value, ', ') FROM missing)
  WHEN (SELECT count(*) FROM extra) > 0
    THEN 'FAIL post_type CHECK is TOO BROAD, unexpected: '
         || (SELECT string_agg(value, ', ') FROM extra)
  ELSE 'PASS post_type CHECK is exactly the 4 registry values (src/lib/postTypes.ts)'
END AS post_type_exact_set_equality;

-- ── 3. behaviour ────────────────────────────────────────────────────────────
DO $$
DECLARE
  poster   uuid := '5e111111-0000-4000-8000-000000000001';
  helper   uuid := '5e111111-0000-4000-8000-000000000002';
  outsider uuid := '5e111111-0000-4000-8000-000000000003';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  svc      uuid := '5e222222-0000-4000-8000-000000000001';
  item     uuid := '5e222222-0000-4000-8000-000000000002';
  err text;
  got_status text;
  got_claimer uuid;
  got_completed timestamptz;
  n int;
BEGIN
  -- 3a. Seed one approved, open service post and one ordinary item (seed path:
  -- auth.role() is NULL here, so the pre-moderation insert trigger is exempt).
  INSERT INTO public.marketplace_listings
    (id, user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category, service_date, service_duration_minutes, service_location, service_notes)
  VALUES
    (svc, poster, 'Need help moving out of Towers', 0, 'Other', uni, 'open', 'approved',
     'request_help', 'move_help', current_date + 3, 120, 'Towers lobby', 'Two suitcases and a mini fridge.');

  INSERT INTO public.marketplace_listings
    (id, user_id, title, price, category, university_id, status, moderation_decision, post_type)
  VALUES
    (item, poster, 'Desk lamp', 12, 'Decor', uni, 'available', 'approved', 'item');

  -- 3b. NO PAYMENTS: the DB refuses a priced service post.
  BEGIN
    INSERT INTO public.marketplace_listings
      (user_id, title, price, category, university_id, status, moderation_decision, post_type, service_category)
    VALUES (poster, 'Paid ride', 25, 'Other', uni, 'open', 'approved', 'request_help', 'rides');
    PERFORM pg_temp._assert('a service post with a nonzero price is rejected', false,
      'the row was accepted — a price on a service post implies money owed');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('a service post with a nonzero price is rejected', true);
  END;

  -- 3c. A service post carries a category; the shape gate holds it.
  BEGIN
    INSERT INTO public.marketplace_listings
      (user_id, title, price, category, university_id, status, moderation_decision, post_type)
    VALUES (poster, 'Vague ask', 0, 'Other', uni, 'open', 'approved', 'offer_help');
    PERFORM pg_temp._assert('a service post without service_category is rejected', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('a service post without service_category is rejected', true);
  END;

  -- 3d. An item may not carry service fields.
  BEGIN
    INSERT INTO public.marketplace_listings
      (user_id, title, price, category, university_id, status, moderation_decision, post_type, service_category)
    VALUES (poster, 'Bookshelf', 30, 'Furniture', uni, 'available', 'approved', 'item', 'move_help');
    PERFORM pg_temp._assert('an item post may not carry service fields', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('an item post may not carry service fields', true);
  END;

  -- 3e. The two lifecycles cannot bleed into each other.
  BEGIN
    UPDATE public.marketplace_listings SET status = 'sold' WHERE id = svc;
    PERFORM pg_temp._assert('a service post cannot become sold', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('a service post cannot become sold', true);
  END;
  BEGIN
    UPDATE public.marketplace_listings
       SET status = 'claimed', claimed_by = helper, claimed_at = now() WHERE id = item;
    PERFORM pg_temp._assert('an item post cannot become claimed', false, 'accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('an item post cannot become claimed', true);
  END;

  -- 3f. is_sublease stays a faithful mirror of post_type.
  SELECT count(*) INTO n FROM public.marketplace_listings
   WHERE id IN (svc, item) AND is_sublease IS TRUE;
  PERFORM pg_temp._assert('post_type keeps the legacy is_sublease mirror in sync', n = 0, n::text);

  -- 3g. The owner cannot claim their own post.
  err := pg_temp._exec_as(poster, format('SELECT public.claim_service_post(%L)', svc));
  PERFORM pg_temp._assert('the poster cannot claim their own post', err IS NOT NULL, coalesce(err, 'accepted'));

  -- 3h. A student at another university cannot claim it.
  err := pg_temp._exec_as(outsider, format('SELECT public.claim_service_post(%L)', svc));
  PERFORM pg_temp._assert('a cross-tenant student cannot claim the post', err IS NOT NULL, coalesce(err, 'accepted'));

  -- 3i. A peer claims it: open -> claimed.
  err := pg_temp._exec_as(helper, format('SELECT public.claim_service_post(%L)', svc));
  PERFORM pg_temp._assert('a same-university peer can claim an open post', err IS NULL, coalesce(err, ''));
  SELECT status, claimed_by INTO got_status, got_claimer
    FROM public.marketplace_listings WHERE id = svc;
  PERFORM pg_temp._assert('the claim lands as claimed + claimed_by',
    got_status = 'claimed' AND got_claimer = helper,
    coalesce(got_status, '<null>') || '/' || coalesce(got_claimer::text, '<null>'));

  -- 3j. A second claimer is turned away.
  err := pg_temp._exec_as(outsider, format('SELECT public.claim_service_post(%L)', svc));
  PERFORM pg_temp._assert('an already-claimed post cannot be claimed again', err IS NOT NULL, coalesce(err, 'accepted'));

  -- 3k. Completion: claimed -> completed.
  err := pg_temp._exec_as(poster, format('SELECT public.complete_service_post(%L)', svc));
  PERFORM pg_temp._assert('the poster can complete a claimed post', err IS NULL, coalesce(err, ''));
  SELECT status, completed_at INTO got_status, got_completed
    FROM public.marketplace_listings WHERE id = svc;
  PERFORM pg_temp._assert('completion lands as completed + completed_at',
    got_status = 'completed' AND got_completed IS NOT NULL,
    coalesce(got_status, '<null>'));

  -- 3l. An uninvolved student cannot complete someone else's post.
  UPDATE public.marketplace_listings
     SET status = 'claimed', completed_at = NULL WHERE id = svc;
  err := pg_temp._exec_as(outsider, format('SELECT public.complete_service_post(%L)', svc));
  PERFORM pg_temp._assert('an uninvolved student cannot complete the post', err IS NOT NULL, coalesce(err, 'accepted'));
  UPDATE public.marketplace_listings
     SET status = 'completed', completed_at = now() WHERE id = svc;

  -- 3m. Reputation reuses seller_rating_stats. The completed pair earns the
  --     right to rate through the EXISTING seller_ratings table — no second
  --     rating system — even with no accepted DM thread between them.
  err := pg_temp._exec_as(helper, format(
    'INSERT INTO public.seller_ratings (rater_id, seller_id, listing_id, stars) VALUES (%L, %L, %L, 5)',
    helper, poster, svc));
  PERFORM pg_temp._assert('a completed service post earns the right to rate the poster',
    err IS NULL, coalesce(err, ''));
  -- Read the aggregate the way the app does: as the authenticated peer. The
  -- view sits behind seller_ratings' same-university SELECT policy, so reading
  -- it with no JWT returns nothing and would make this assertion vacuous.
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', helper::text, 'role', 'authenticated')::text, true);
  SELECT rating_count INTO n FROM public.seller_rating_stats WHERE seller_id = poster;
  PERFORM pg_temp._assume('postgres');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp._assert('the rating aggregates in the EXISTING seller_rating_stats view',
    coalesce(n, 0) = 1, coalesce(n::text, '<null>'));

  -- 3n. A pair with neither a completed post nor an accepted thread still cannot rate.
  err := pg_temp._exec_as(outsider, format(
    'INSERT INTO public.seller_ratings (rater_id, seller_id, stars) VALUES (%L, %L, 5)',
    outsider, poster));
  PERFORM pg_temp._assert('an unrelated student still cannot rate', err IS NOT NULL, coalesce(err, 'accepted'));

  -- 3o. The guest projection inherits service posts (open/claimed), and never
  --     leaks the claimer or a contact column.
  UPDATE public.marketplace_listings SET status = 'open', claimed_by = NULL,
         claimed_at = NULL, completed_at = NULL WHERE id = svc;
  SELECT count(*) INTO n FROM public.marketplace_public WHERE id = svc;
  PERFORM pg_temp._assert('an open service post is visible to guests', n = 1, n::text);
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'marketplace_public'
     AND column_name IN ('claimed_by', 'instagram_handle', 'snapchat_handle', 'phone_number');
  PERFORM pg_temp._assert('the guest view exposes no claimer identity or contact column', n = 0, n::text);
  SELECT count(*) INTO n FROM public.marketplace_public
   WHERE id = svc AND service_category = 'move_help' AND price = 0;
  PERFORM pg_temp._assert('guests see the structured service fields and a zero price', n = 1, n::text);
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION 'marketplace_service_posts probe: % assertion(s) failed', fails;
  END IF;
END $$;

ROLLBACK;
