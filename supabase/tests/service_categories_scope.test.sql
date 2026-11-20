-- covers: 20260924000000_service_categories_scope_and_limits.sql
-- Student services at release shape (migration 20260924000000).
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/service_categories_scope.test.sql
--
-- Five things this pins, each of which is a guardrail that is worth nothing if
-- it lives only in the client:
--
--  1. CATEGORY VOCABULARY, as set EQUALITY in both directions. A DROP/re-ADD of
--     marketplace_listings_service_category_check is a replacement, so "not
--     narrower" is not enough — the retired placeholder values ('moving',
--     'storage', 'ride', 'other') must be GONE, and a free-text category must be
--     impossible. Same shape as the status drift guard in
--     marketplace_service_posts.test.sql § 1.
--  2. NO CATCH-ALL, NO LICENSE-GATED TRADE, NO FOOD. Asserted as a product rule,
--     because the absence of the value IS the control.
--  3. ONE ACTIVE OFFER PER PROVIDER, in the DB rather than the form.
--  4. A REVIEW WITHOUT A COMPLETED JOB IS IMPOSSIBLE. Inherited from
--     rls_seller_ratings_insert + has_completed_service_between(); re-asserted
--     here because it is now load-bearing for a second surface.
--  5. REMOTE REACH IS OFF. universities.remote_services_open defaults false on
--     every row, a remote listing does not cross schools while it is false, and
--     a LOCAL listing does not cross even when it is true.
--
-- Plus the post-approval edit rate limit, and the fact that it does NOT throttle
-- the claim/complete lifecycle.
--
-- Wrapped in BEGIN..ROLLBACK: writes nothing that outlives the run, so it is
-- order-independent under TEST_DB_ORDER=reverse|shuffle.

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ───────────
-- Identical to marketplace_service_posts.test.sql. PostgREST connects as
-- session_user='authenticator' and SET ROLEs; set_config('role', …) alone leaves
-- session_user superuser, which silently exempts every trigger keyed on it.
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

-- ── fixtures ────────────────────────────────────────────────────────────────
-- Pitt and CMU already share marketplace_group 'pittsburgh' (20260918000000),
-- so neither can demonstrate "beyond the group". `farside` is deliberately
-- ungrouped: it is the school a REMOTE category would have to reach, and the
-- one a LOCAL category must never reach.
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000001', 'pitt', 'University of Pittsburgh', 'Pitt',
        ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active, marketplace_group)
VALUES ('00000000-0000-4000-8000-0000000000f1', 'farside', 'Farside University', 'Farside',
        ARRAY['farside.edu'], true, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('5e222222-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('5e222222-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('5e222222-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- The auth.users trigger creates the profiles row first, so seed columns must
-- live in ON CONFLICT DO UPDATE or they are silently dropped.
INSERT INTO public.profiles (id, full_name, university_id, role) VALUES
  ('5e222222-0000-4000-8000-000000000001', 'Provider', '00000000-0000-4000-8000-000000000001', 'user'),
  ('5e222222-0000-4000-8000-000000000002', 'Peer',     '00000000-0000-4000-8000-000000000001', 'user'),
  ('5e222222-0000-4000-8000-000000000003', 'Distant',  '00000000-0000-4000-8000-0000000000f1', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, university_id = EXCLUDED.university_id;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- NULL is not PASS. A condition that evaluates to NULL used to land in the
  -- results table as a non-failure; coalesce it to false so an unevaluable
  -- assertion reads as broken rather than green.
  INSERT INTO test_results VALUES (label, coalesce(cond, false), detail);
  IF NOT coalesce(cond, false) THEN RAISE NOTICE 'FAIL: % - %', label, detail;
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

CREATE OR REPLACE FUNCTION pg_temp._count_as(p_uid uuid, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql INTO n;
  PERFORM pg_temp._assume('postgres');
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN n;
END;
$$;

-- ── 1. category CHECK exact-set drift guard ─────────────────────────────────
-- Update this list ONLY together with a migration that changes the constraint,
-- never to make a failing test pass.
CREATE TEMP TABLE _authorized_category(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized_category VALUES
  ('move_help'), ('rides'), ('tech_repair'), ('printing'), ('photography'),
  ('tutoring'), ('resume_review'), ('design'), ('editing');

DO $$
DECLARE
  missing text;
  extra   text;
BEGIN
  WITH actual AS (
    SELECT m[1] AS value
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
    WHERE c.conrelid = 'public.marketplace_listings'::regclass
      AND c.conname = 'marketplace_listings_service_category_check'
  )
  SELECT (SELECT string_agg(value, ', ') FROM (SELECT value FROM _authorized_category EXCEPT SELECT value FROM actual) q),
         (SELECT string_agg(value, ', ') FROM (SELECT value FROM actual EXCEPT SELECT value FROM _authorized_category) q)
    INTO missing, extra;

  PERFORM pg_temp._assert('the category CHECK is not too narrow', missing IS NULL,
                          coalesce('missing: ' || missing, ''));
  -- This is the direction that catches a resurrected placeholder: a later
  -- migration re-adding the historical union would show up here as 'moving,
  -- other, ride, storage' and nowhere else.
  PERFORM pg_temp._assert('the category CHECK is not too wide', extra IS NULL,
                          coalesce('extra: ' || extra, ''));
END $$;

-- ── 2. the vocabulary is the control ────────────────────────────────────────
DO $$
DECLARE
  provider uuid := '5e222222-0000-4000-8000-000000000001';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  banned   text;
  err      text;
  n        integer;
BEGIN
  FOREACH banned IN ARRAY ARRAY[
    -- no catch-all …
    'other', 'misc', 'general',
    -- … no license-gated trade …
    'nails', 'hair', 'braiding', 'massage', 'medical',
    -- … no food, at any wording …
    'food', 'baking', 'meal_prep', 'catering',
    -- … and no free text.
    'whatever you need', 'MOVE_HELP', 'move_help ', ''
  ] LOOP
    BEGIN
      INSERT INTO public.marketplace_listings
        (user_id, title, price, category, university_id, status, post_type, service_category)
      VALUES (provider, 'Probe', 0, 'Other', uni, 'pending_review', 'offer_help', banned);
      PERFORM pg_temp._assert(format('category %L is rejected', banned), false, 'accepted');
      RAISE EXCEPTION 'rollback probe';
    EXCEPTION
      WHEN check_violation THEN
        PERFORM pg_temp._assert(format('category %L is rejected', banned), true);
      WHEN others THEN
        PERFORM pg_temp._assert(format('category %L is rejected', banned),
                                SQLERRM = 'rollback probe' IS NOT TRUE, SQLERRM);
    END;
  END LOOP;

  -- The scope function agrees with the constraint, in both directions.
  SELECT count(*) INTO n FROM _authorized_category
   WHERE public.service_category_scope(value) IS NULL;
  PERFORM pg_temp._assert('every authorized category has a scope', n = 0, n::text);

  SELECT count(*) INTO n FROM _authorized_category
   WHERE public.service_category_scope(value) NOT IN ('local', 'remote');
  PERFORM pg_temp._assert('no category has a scope outside local/remote', n = 0, n::text);

  PERFORM pg_temp._assert('a retired placeholder has no scope',
                          public.service_category_scope('moving') IS NULL
                          AND public.service_category_scope('other') IS NULL);

  SELECT count(*) INTO n FROM _authorized_category
   WHERE public.service_category_scope(value) = 'remote';
  PERFORM pg_temp._assert('exactly four categories are remote', n = 4, n::text);
END $$;

-- ── 3. one active offer per provider, enforced by the DB ────────────────────
DO $$
DECLARE
  provider uuid := '5e222222-0000-4000-8000-000000000001';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  first_id uuid;
  err      text;
  n        integer;
BEGIN
  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category)
  VALUES (provider, 'Airport rides', 0, 'Other', uni, 'open', 'approved', 'offer_help', 'rides')
  RETURNING id INTO first_id;

  -- Straight through the owner's own client path, not a superuser insert.
  err := pg_temp._exec_as(provider, format(
    'INSERT INTO public.marketplace_listings
       (user_id, title, price, category, university_id, status, post_type, service_category)
     VALUES (%L, ''Tech repair'', 0, ''Other'', %L, ''pending_review'', ''offer_help'', ''tech_repair'')',
    provider, uni));
  PERFORM pg_temp._assert('a second active offer is refused', err IS NOT NULL, coalesce(err, 'accepted'));

  -- pending_review counts as active, or the cap only bites after approval and a
  -- provider can queue a backlog behind the moderator.
  UPDATE public.marketplace_listings SET status = 'pending_review', moderation_decision = NULL
   WHERE id = first_id;
  err := pg_temp._exec_as(provider, format(
    'INSERT INTO public.marketplace_listings
       (user_id, title, price, category, university_id, status, post_type, service_category)
     VALUES (%L, ''Printing'', 0, ''Other'', %L, ''pending_review'', ''offer_help'', ''printing'')',
    provider, uni));
  PERFORM pg_temp._assert('a second offer queued behind moderation is refused',
                          err IS NOT NULL, coalesce(err, 'accepted'));

  -- Taking the first one down frees the slot.
  UPDATE public.marketplace_listings SET status = 'expired' WHERE id = first_id;
  err := pg_temp._exec_as(provider, format(
    'INSERT INTO public.marketplace_listings
       (user_id, title, price, category, university_id, status, post_type, service_category)
     VALUES (%L, ''Printing'', 0, ''Other'', %L, ''pending_review'', ''offer_help'', ''printing'')',
    provider, uni));
  PERFORM pg_temp._assert('taking the offer down frees the slot', err IS NULL, coalesce(err, ''));

  -- REQUESTS are not capped: two unrelated asks are two genuine asks, and
  -- capping them just pushes the second into free text where nothing screens it.
  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, post_type, service_category)
  VALUES (provider, 'Need a hand moving', 0, 'Other', uni, 'open', 'request_help', 'move_help');
  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, post_type, service_category)
  VALUES (provider, 'Need a ride Friday', 0, 'Other', uni, 'open', 'request_help', 'rides');
  SELECT count(*) INTO n FROM public.marketplace_listings
   WHERE user_id = provider AND post_type = 'request_help' AND status = 'open';
  PERFORM pg_temp._assert('two open requests from one student are allowed', n = 2, n::text);
END $$;

-- ── 4. a review with no completed job is impossible ─────────────────────────
DO $$
DECLARE
  provider uuid := '5e222222-0000-4000-8000-000000000001';
  peer     uuid := '5e222222-0000-4000-8000-000000000002';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  job      uuid;
  err      text;
BEGIN
  -- Section 3 deliberately leaves an active offer behind; the one-active-offer
  -- index would reject this section's fixture otherwise.
  DELETE FROM public.marketplace_listings WHERE user_id = provider;
  DELETE FROM public.seller_ratings WHERE rater_id = peer AND seller_id = provider;

  err := pg_temp._exec_as(peer, format(
    'INSERT INTO public.seller_ratings (rater_id, seller_id, stars) VALUES (%L, %L, 5)',
    peer, provider));
  PERFORM pg_temp._assert('a review with no completed job is refused',
                          err IS NOT NULL, coalesce(err, 'accepted'));

  -- An OPEN job is not a completed one.
  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category, claimed_by, claimed_at)
  VALUES (provider, 'Resume look-over', 0, 'Other', uni, 'claimed', 'approved',
          'offer_help', 'resume_review', peer, now())
  RETURNING id INTO job;

  err := pg_temp._exec_as(peer, format(
    'INSERT INTO public.seller_ratings (rater_id, seller_id, stars) VALUES (%L, %L, 5)',
    peer, provider));
  PERFORM pg_temp._assert('a review on a merely CLAIMED job is refused',
                          err IS NOT NULL, coalesce(err, 'accepted'));

  -- Completing it is what earns the right.
  UPDATE public.marketplace_listings
     SET status = 'completed', completed_at = now() WHERE id = job;
  err := pg_temp._exec_as(peer, format(
    'INSERT INTO public.seller_ratings (rater_id, seller_id, stars) VALUES (%L, %L, 5)',
    peer, provider));
  PERFORM pg_temp._assert('a review after completion is accepted', err IS NULL, coalesce(err, ''));

  -- The provider-profile figure counts jobs completed AS THE PROVIDER: an offer
  -- they posted and saw through, or a request someone else posted that they
  -- claimed and finished. Not the requests they had done FOR them.
  PERFORM pg_temp._assert('a completed offer counts for the provider',
                          public.service_completion_count(provider) = 1,
                          public.service_completion_count(provider)::text);
  PERFORM pg_temp._assert('the same job does not count for the requester',
                          public.service_completion_count(peer) = 0,
                          public.service_completion_count(peer)::text);

  DELETE FROM public.seller_ratings WHERE rater_id = peer AND seller_id = provider;
  DELETE FROM public.marketplace_listings WHERE id = job;
END $$;

-- ── 5. remote reach is OFF, and local never crosses ─────────────────────────
DO $$
DECLARE
  provider uuid := '5e222222-0000-4000-8000-000000000001';
  distant  uuid := '5e222222-0000-4000-8000-000000000003';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  far      uuid := '00000000-0000-4000-8000-0000000000f1';
  remote_l uuid;
  local_l  uuid;
  n        integer;
BEGIN
  -- The shipped default, on every row, with no exceptions. This is the
  -- assertion that says "the feature is inert in production".
  SELECT count(*) INTO n FROM public.universities WHERE remote_services_open;
  PERFORM pg_temp._assert('no university has remote services open', n = 0, n::text);

  DELETE FROM public.marketplace_listings WHERE user_id = provider;

  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category)
  VALUES (provider, 'Calc II tutoring', 0, 'Other', uni, 'open', 'approved',
          'offer_help', 'tutoring')
  RETURNING id INTO remote_l;

  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category)
  VALUES (provider, 'Need a hand moving', 0, 'Other', uni, 'open', 'approved',
          'request_help', 'move_help')
  RETURNING id INTO local_l;

  n := pg_temp._count_as(distant, format(
    'SELECT count(*)::int FROM public.marketplace_listings WHERE id = %L', remote_l));
  PERFORM pg_temp._assert('a remote listing does not cross schools while remote is closed',
                          n = 0, n::text);

  -- Open it on BOTH sides — one side alone must not be enough.
  UPDATE public.universities SET remote_services_open = true WHERE id = uni;
  n := pg_temp._count_as(distant, format(
    'SELECT count(*)::int FROM public.marketplace_listings WHERE id = %L', remote_l));
  PERFORM pg_temp._assert('one side opening remote is not enough', n = 0, n::text);

  UPDATE public.universities SET remote_services_open = true WHERE id = far;
  n := pg_temp._count_as(distant, format(
    'SELECT count(*)::int FROM public.marketplace_listings WHERE id = %L', remote_l));
  PERFORM pg_temp._assert('a remote listing crosses once both schools opt in', n = 1, n::text);

  -- The whole point of the local/remote split: a task that needs the provider
  -- physically present must not travel, no matter what the flag says.
  n := pg_temp._count_as(distant, format(
    'SELECT count(*)::int FROM public.marketplace_listings WHERE id = %L', local_l));
  PERFORM pg_temp._assert('a LOCAL listing never crosses, even with remote open', n = 0, n::text);

  -- Posting stays confined to your own school in every configuration.
  PERFORM pg_temp._assert('a cross-school write is still refused',
    pg_temp._exec_as(distant, format(
      'INSERT INTO public.marketplace_listings
         (user_id, title, price, category, university_id, status, post_type, service_category)
       VALUES (%L, ''Editing'', 0, ''Other'', %L, ''pending_review'', ''offer_help'', ''editing'')',
      distant, uni)) IS NOT NULL);

  UPDATE public.universities SET remote_services_open = false WHERE id IN (uni, far);
END $$;

-- ── 6. post-approval edit rate limit ────────────────────────────────────────
DO $$
DECLARE
  provider uuid := '5e222222-0000-4000-8000-000000000001';
  peer     uuid := '5e222222-0000-4000-8000-000000000002';
  uni      uuid := '00000000-0000-4000-8000-000000000001';
  job      uuid;
  err      text;
  n        integer;
BEGIN
  DELETE FROM public.marketplace_listings WHERE user_id = provider;

  INSERT INTO public.marketplace_listings
    (user_id, title, price, category, university_id, status, moderation_decision,
     post_type, service_category)
  VALUES (provider, 'Airport rides', 0, 'Other', uni, 'open', 'approved',
          'offer_help', 'rides')
  RETURNING id INTO job;

  err := pg_temp._exec_as(provider, format(
    'UPDATE public.marketplace_listings SET title = ''Airport rides, cheap'' WHERE id = %L', job));
  PERFORM pg_temp._assert('the first edit after approval goes through', err IS NULL, coalesce(err, ''));

  SELECT service_edit_count INTO n FROM public.marketplace_listings WHERE id = job;
  PERFORM pg_temp._assert('the edit is counted', n = 1, n::text);

  -- Since 20261011000000 an edit to a screened field sends the post back to
  -- pending_review (rescreen_listing_on_edit), so the moderator DOES re-run on
  -- UPDATE now. Re-approve it here the way moderate-listing would, so every
  -- check below is about a LIVE post again: the throttle still has to make a
  -- rewrite loop on a public post slow, review or not.
  UPDATE public.marketplace_listings SET status = 'open', moderation_decision = 'approved'
   WHERE id = job;

  -- The bait-and-switch: approved, then rewritten into something else.
  err := pg_temp._exec_as(provider, format(
    'UPDATE public.marketplace_listings SET title = ''Something else entirely'' WHERE id = %L', job));
  PERFORM pg_temp._assert('an immediate second edit is refused', err IS NOT NULL, coalesce(err, 'accepted'));

  -- A lifecycle write is not a content edit and must never be throttled: a
  -- claim that fails because the poster fixed a typo is a broken feature.
  err := pg_temp._exec_as(peer, format('SELECT public.claim_service_post(%L)', job));
  PERFORM pg_temp._assert('claiming is not throttled by the edit limit', err IS NULL, coalesce(err, ''));

  SELECT service_edit_count INTO n FROM public.marketplace_listings WHERE id = job;
  PERFORM pg_temp._assert('a claim does not consume an edit', n = 1, n::text);

  -- Past the cap, no waiting helps.
  UPDATE public.marketplace_listings
     SET service_edit_count = 10, service_last_edit_at = now() - interval '3 days',
         status = 'open', moderation_decision = 'approved', claimed_by = NULL, claimed_at = NULL
   WHERE id = job;
  err := pg_temp._exec_as(provider, format(
    'UPDATE public.marketplace_listings SET title = ''Try again'' WHERE id = %L', job));
  PERFORM pg_temp._assert('the total edit cap holds regardless of elapsed time',
                          err IS NOT NULL, coalesce(err, 'accepted'));

  -- A pre-moderation row is a draft the feed cannot see; editing it is free.
  UPDATE public.marketplace_listings
     SET status = 'pending_review', moderation_decision = NULL,
         service_edit_count = 0, service_last_edit_at = NULL
   WHERE id = job;
  err := pg_temp._exec_as(provider, format(
    'UPDATE public.marketplace_listings SET title = ''Draft edit one'' WHERE id = %L', job));
  PERFORM pg_temp._assert('editing a pre-moderation draft is not throttled', err IS NULL, coalesce(err, ''));
  err := pg_temp._exec_as(provider, format(
    'UPDATE public.marketplace_listings SET title = ''Draft edit two'' WHERE id = %L', job));
  PERFORM pg_temp._assert('editing a pre-moderation draft twice is not throttled', err IS NULL, coalesce(err, ''));
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION 'service_categories_scope probe: % assertion(s) failed', fails;
  END IF;
END $$;

ROLLBACK;
