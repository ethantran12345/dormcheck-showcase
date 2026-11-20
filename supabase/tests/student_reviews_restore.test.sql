-- covers: 20260701053717_teardown_student_reviews.sql
-- covers: 20260906000000_restore_dorm_reviews.sql
-- Restored dorm ratings (20260906000000_restore_dorm_reviews).
-- The load-bearing claim is ELIGIBILITY: only a current resident of a building may
-- rate it, enforced in RLS rather than the client. Everything here runs as
-- `authenticated` with a forged JWT sub, i.e. through the same policy path a
-- direct PostgREST call takes, so a client-only check would fail these.
--
-- Also covers: one-review-per-user-per-building, edit/delete in place, the
-- below-3 average suppression, and the report round-trip through the admin RPC.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/student_reviews_restore.test.sql

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

-- Two halls at the same school: the resident lives in ALPHA and not in BETA.
INSERT INTO public.master_housing (id, residence_hall, university_id) VALUES
  (970001, 'Probe Hall Alpha', '00000000-0000-4000-8000-000000000001'),
  (970002, 'Probe Hall Beta',  '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('cccccccc-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('cccccccc-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('cccccccc-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('dddddddd-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

-- c1/c2/c3 are Alpha residents; d1 is an off-campus student (resident of nothing).
INSERT INTO public.profiles (id, full_name, university_id, role, housing_type, current_dorm) VALUES
  ('cccccccc-0000-4000-8000-0000000000c1', 'Alpha Resident One',   '00000000-0000-4000-8000-000000000001', 'user', 'on-campus', 'Probe Hall Alpha'),
  ('cccccccc-0000-4000-8000-0000000000c2', 'Alpha Resident Two',   '00000000-0000-4000-8000-000000000001', 'user', 'on-campus', 'Probe Hall Alpha'),
  ('cccccccc-0000-4000-8000-0000000000c3', 'Alpha Resident Three', '00000000-0000-4000-8000-000000000001', 'user', 'on-campus', '  probe   hall alpha '),
  ('dddddddd-0000-4000-8000-0000000000d1', 'Off Campus Student',   '00000000-0000-4000-8000-000000000001', 'superadmin', 'off-campus', NULL)
-- NOTE: a trigger on auth.users has ALREADY created each profiles row (with a
-- NULL full_name), so this always takes the DO UPDATE path. Every column the
-- fixture depends on must therefore be listed here, not just in the INSERT -
-- omitting full_name silently produced anonymous-looking authors.
ON CONFLICT (id) DO UPDATE
  SET full_name     = EXCLUDED.full_name,
      housing_type  = EXCLUDED.housing_type,
      current_dorm  = EXCLUDED.current_dorm,
      role          = EXCLUDED.role,
      university_id = EXCLUDED.university_id;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
-- Assertions are recorded while impersonating `authenticated` (that is the whole
-- point of the probe), so the results table has to be writable by that role.
GRANT ALL ON test_results TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  -- COALESCE is load-bearing: a NULL condition (e.g. max() over zero rows
  -- compared to a value) would otherwise record pass = NULL, print PASS via the
  -- ELSE branch, and slip past a `WHERE NOT pass` failure count. Treat unknown
  -- as failure.
  verdict boolean := COALESCE(cond, false);
BEGIN
  INSERT INTO test_results VALUES (label, verdict, detail);
  IF NOT verdict THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp._become(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u::text, 'role', 'authenticated')::text, true);
END;
$$;

DO $$
DECLARE
  r1 uuid := 'cccccccc-0000-4000-8000-0000000000c1';
  r2 uuid := 'cccccccc-0000-4000-8000-0000000000c2';
  r3 uuid := 'cccccccc-0000-4000-8000-0000000000c3';
  outsider uuid := 'dddddddd-0000-4000-8000-0000000000d1';
  review_id uuid;
  n int;
  a numeric;
  txt text;
  ok boolean;
BEGIN
  -- ── Eligibility: a resident may rate their OWN hall ───────────────────────
  PERFORM pg_temp._become(r1);
  INSERT INTO public.student_reviews (building_id, user_id, rating, rating_community, rating_student_life, rating_location)
    VALUES (970001, r1, 4.5, 4.0, 3.5, 5.0)
    RETURNING id INTO review_id;
  PERFORM pg_temp._assert('resident can rate own hall', review_id IS NOT NULL);

  -- is_anonymous defaults TRUE (requirement 5) without the client passing it.
  SELECT is_anonymous INTO ok FROM public.student_reviews WHERE id = review_id;
  PERFORM pg_temp._assert('is_anonymous defaults true', ok IS TRUE, format('got %s', ok));

  -- No comment is ever written (requirement 2).
  SELECT comment INTO txt FROM public.student_reviews WHERE id = review_id;
  PERFORM pg_temp._assert('comment is null on new rows', txt IS NULL, format('got %L', txt));

  -- ── Eligibility: the SAME resident may NOT rate a hall they don't live in ─
  BEGIN
    INSERT INTO public.student_reviews (building_id, user_id, rating)
      VALUES (970002, r1, 5.0);
    PERFORM pg_temp._assert('resident CANNOT rate a different hall', false,
      'insert into Beta unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp._assert('resident CANNOT rate a different hall', true);
  END;

  -- ── Eligibility: an off-campus student may rate nothing ───────────────────
  PERFORM pg_temp._become(outsider);
  BEGIN
    INSERT INTO public.student_reviews (building_id, user_id, rating)
      VALUES (970001, outsider, 1.0);
    PERFORM pg_temp._assert('non-resident CANNOT rate', false, 'insert unexpectedly succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp._assert('non-resident CANNOT rate', true);
  END;

  -- ── Cannot write a review AS someone else, even for your own hall ─────────
  PERFORM pg_temp._become(r2);
  BEGIN
    INSERT INTO public.student_reviews (building_id, user_id, rating)
      VALUES (970001, r1, 1.0);
    PERFORM pg_temp._assert('cannot rate on another user''s behalf', false, 'insert succeeded');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp._assert('cannot rate on another user''s behalf', true);
  END;

  -- ── One review per user per building ─────────────────────────────────────
  PERFORM pg_temp._become(r1);
  BEGIN
    INSERT INTO public.student_reviews (building_id, user_id, rating)
      VALUES (970001, r1, 2.0);
    PERFORM pg_temp._assert('one review per user per building', false, 'duplicate accepted');
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp._assert('one review per user per building', true);
  END;

  -- ── Editable in place ────────────────────────────────────────────────────
  UPDATE public.student_reviews SET rating = 2.5 WHERE id = review_id;
  SELECT rating INTO a FROM public.student_reviews WHERE id = review_id;
  PERFORM pg_temp._assert('own review is editable', a = 2.5, format('got %s', a));

  -- ...but not someone else's.
  PERFORM pg_temp._become(r2);
  UPDATE public.student_reviews SET rating = 1.0 WHERE id = review_id;
  PERFORM pg_temp._become(r1);
  SELECT rating INTO a FROM public.student_reviews WHERE id = review_id;
  PERFORM pg_temp._assert('another user cannot edit my review', a = 2.5, format('got %s', a));

  -- ── Half-step CHECK rejects quarter values ───────────────────────────────
  PERFORM pg_temp._become(r2);
  BEGIN
    INSERT INTO public.student_reviews (building_id, user_id, rating)
      VALUES (970001, r2, 3.2);
    PERFORM pg_temp._assert('rating must be a half step', false, '3.2 accepted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp._assert('rating must be a half step', true);
  END;

  -- ── Average suppression below 3 reviews (requirement 4) ──────────────────
  -- Currently 1 review on Alpha.
  SELECT review_count, avg_overall INTO n, a FROM public.get_dorm_review_stats(970001);
  PERFORM pg_temp._assert('count exposed below threshold', n = 1, format('got %s', n));
  PERFORM pg_temp._assert('averages suppressed at 1 review', a IS NULL, format('got %s', a));

  INSERT INTO public.student_reviews (building_id, user_id, rating, rating_community, rating_student_life, rating_location)
    VALUES (970001, r2, 3.0, 3.0, 3.0, 3.0);
  SELECT review_count, avg_overall INTO n, a FROM public.get_dorm_review_stats(970001);
  PERFORM pg_temp._assert('averages suppressed at 2 reviews', n = 2 AND a IS NULL, format('n=%s avg=%s', n, a));

  -- Third resident: whitespace/case-variant current_dorm must still match.
  PERFORM pg_temp._become(r3);
  INSERT INTO public.student_reviews (building_id, user_id, rating, rating_community, rating_student_life, rating_location)
    VALUES (970001, r3, 5.0, 5.0, 5.0, 5.0);
  SELECT count(*) INTO n FROM public.student_reviews WHERE user_id = r3 AND building_id = 970001;
  PERFORM pg_temp._assert('dorm name match is case/whitespace insensitive', n = 1, format('got %s', n));

  SELECT review_count, avg_overall INTO n, a FROM public.get_dorm_review_stats(970001);
  PERFORM pg_temp._assert('averages revealed at 3 reviews', n = 3 AND a IS NOT NULL, format('n=%s avg=%s', n, a));

  SELECT avg_room INTO a FROM public.get_dorm_review_stats(970001);
  PERFORM pg_temp._assert('per-category average is correct',
    a = round((2.5 + 3.0 + 5.0) / 3.0, 2), format('avg_room=%s', a));

  -- ── Reporting round-trip (requirement 6) ─────────────────────────────────
  INSERT INTO public.content_reports (content_type, content_id, reporter_id, reason)
    VALUES ('student_review', review_id, r3, 'bad faith rating');

  PERFORM pg_temp._become(outsider);  -- superadmin
  SELECT count(*), max(content_preview_body) INTO n, txt
    FROM public.get_content_reports('student_review', NULL)
    WHERE content_id = review_id;
  PERFORM pg_temp._assert('review report reaches the admin queue', n = 1, format('got %s', n));
  PERFORM pg_temp._assert('report preview carries the ratings', txt LIKE 'Room 2.5%', format('got %L', txt));

  SELECT max(content_context) INTO txt
    FROM public.get_content_reports('student_review', NULL)
    WHERE content_id = review_id;
  PERFORM pg_temp._assert('anonymity is surfaced to the moderator',
    txt = 'Posted anonymously', format('got %L', txt));

  -- ── Anonymity is a boundary, not a rendering convention ──────────────────
  -- r1 is anonymous; r3 opted into attribution.
  PERFORM pg_temp._become(r3);
  UPDATE public.student_reviews SET is_anonymous = false WHERE user_id = r3;
  SELECT count(*) INTO n FROM public.student_reviews WHERE user_id = r3 AND NOT is_anonymous;
  PERFORM pg_temp._assert('a resident can opt into attribution', n = 1, format('got %s', n));

  PERFORM pg_temp._become(r2);
  -- Direct table reads see ONLY your own row, so no client can join user_id
  -- against is_anonymous to unmask anyone.
  SELECT count(*) INTO n FROM public.student_reviews WHERE building_id = 970001;
  PERFORM pg_temp._assert('direct select exposes only my own review', n = 1, format('got %s', n));

  -- The RPC is the only path to everyone else's ratings.
  SELECT count(*) INTO n FROM public.get_dorm_reviews(970001);
  PERFORM pg_temp._assert('RPC returns every rating for the hall', n = 3, format('got %s', n));

  SELECT count(*) INTO n FROM public.get_dorm_reviews(970001) WHERE author_name IS NOT NULL;
  PERFORM pg_temp._assert('only the attributed rating carries a name', n = 1, format('got %s', n));

  SELECT max(author_name) INTO txt FROM public.get_dorm_reviews(970001) WHERE NOT is_anonymous;
  PERFORM pg_temp._assert('attributed rating shows the real name',
    txt = 'Alpha Resident Three', format('got %L', txt));

  SELECT count(*) INTO n FROM public.get_dorm_reviews(970001) WHERE is_anonymous AND author_name IS NOT NULL;
  PERFORM pg_temp._assert('anonymous ratings never leak a name', n = 0, format('got %s', n));

  SELECT count(*) INTO n FROM public.get_dorm_reviews(970001) WHERE is_mine;
  PERFORM pg_temp._assert('is_mine marks exactly the caller''s own row', n = 1, format('got %s', n));

  -- ── Deletable in place ───────────────────────────────────────────────────
  PERFORM pg_temp._become(r1);
  DELETE FROM public.student_reviews WHERE id = review_id;
  SELECT count(*) INTO n FROM public.student_reviews WHERE id = review_id;
  PERFORM pg_temp._assert('own review is deletable', n = 0, format('got %s', n));
END;
$$;

-- Top-level statement, so SELECT rather than PERFORM (which is plpgsql-only).
SELECT pg_temp._assume('postgres');

SELECT name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, detail
FROM test_results ORDER BY ctid;

DO $$
DECLARE failures int;
BEGIN
  SELECT count(*) INTO failures FROM test_results WHERE NOT pass;
  IF failures > 0 THEN
    RAISE EXCEPTION 'student_reviews_restore: % assertion(s) failed', failures;
  END IF;
END;
$$;

ROLLBACK;
