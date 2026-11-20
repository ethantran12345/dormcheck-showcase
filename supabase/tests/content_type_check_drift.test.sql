-- Content-type CHECK drift guard for BOTH moderation CHECKs:
--   public.content_reports.chk_content_type
--   public.moderation_actions.moderation_actions_content_type_check
-- In each case the value set is an EQUALITY, not a lower bound.
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/content_type_check_drift.test.sql
--
-- Guards both directions of drift, because each has bitten this repo:
--   TOO NARROW  — a migration DROPs and re-ADDs chk_content_type listing only the
--                 values it is introducing, silently deleting the rest.
--                 20260731040000 shipped this way and would have deleted
--                 'group_message'.
--   TOO BROAD   — an unrelated value creeps in. The set is an equality, so a
--                 "not narrower than N" assertion would not notice.
--
-- HISTORY: from 20260701053717_teardown_student_reviews until 20260906000000 the
-- two sets differed on purpose - content_reports EXCLUDED 'student_review' while
-- moderation_actions RETAINED it, because the latter is an append-only audit log
-- holding historical review-moderation rows. 20260906000000_restore_dorm_reviews
-- restored dorm ratings and readmitted 'student_review' to content_reports, so
-- the two sets now agree and section 5 asserts THAT instead. Note what this means
-- for reporting: a restored review carries no free text, so these are post-hoc
-- reports of a bad-faith rating, never pre-moderation.
--
-- Wrapped in BEGIN..ROLLBACK, so it writes nothing that outlives the run and is
-- order-independent under TEST_DB_ORDER=reverse|shuffle.

\set ON_ERROR_STOP on

BEGIN;

-- The authorized set. Update this list ONLY together with a migration that
-- changes the constraint, never to make a failing test pass.
CREATE TEMP TABLE _authorized(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized VALUES
  ('marketplace_listing'), ('roommate_post'), ('building_chat_link'),
  ('user'), ('seller_rating'), ('student_setup'), ('group_message'),
  -- Added by 20260825010000_dm_message_reporting.sql (DM reporting). Additive:
  -- every previously valid value stays valid.
  ('dm_message'),
  -- Re-admitted by 20260906000000_restore_dorm_reviews.sql, reversing the
  -- 20260701053717 teardown. Additive: every previously valid value stays valid.
  ('student_review');

-- 1. EXACT set equality against the live constraint definition, parsed out of
--    pg_get_constraintdef. Symmetric difference must be empty in both directions.
WITH actual AS (
  SELECT m[1] AS value
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
  WHERE c.conrelid = 'public.content_reports'::regclass
    AND c.conname = 'chk_content_type'
),
missing AS (SELECT value FROM _authorized EXCEPT SELECT value FROM actual),
extra   AS (SELECT value FROM actual EXCEPT SELECT value FROM _authorized)
SELECT CASE
  WHEN (SELECT count(*) FROM missing) > 0
    THEN 'FAIL chk_content_type is TOO NARROW, missing: '
         || (SELECT string_agg(value, ', ') FROM missing)
  WHEN (SELECT count(*) FROM extra) > 0
    THEN 'FAIL chk_content_type is TOO BROAD, unexpected: '
         || (SELECT string_agg(value, ', ') FROM extra)
  ELSE 'PASS chk_content_type is exactly the 9 authorized values'
END AS exact_set_equality;

-- 2. The constraint must be validated, not left NOT VALID by a partial repair.
SELECT CASE
  WHEN convalidated THEN 'PASS chk_content_type is validated'
  ELSE 'FAIL chk_content_type exists but is NOT VALID'
END AS validated
FROM pg_constraint
WHERE conrelid = 'public.content_reports'::regclass AND conname = 'chk_content_type';

-- 3. No leftover temporary constraint from an interrupted repair swap.
SELECT CASE
  WHEN count(*) = 0 THEN 'PASS no leftover chk_content_type_new'
  ELSE 'FAIL chk_content_type_new still present — an interrupted repair. Recovery procedure: git show 5805ac87:docs/tasks/PLAN.md (rollback step 0)'
END AS no_leftover
FROM pg_constraint
WHERE conrelid = 'public.content_reports'::regclass AND conname = 'chk_content_type_new';

-- 4. Behavioral check: the constraint actually accepts/rejects what it should.
--    Copies content_reports' CHECK constraints onto a temp table (INCLUDING
--    CONSTRAINTS copies CHECKs but not FKs), so each value can be exercised
--    without seeding profiles/auth.users fixtures. The predicate under test is
--    the real one, read from the live catalog.
-- INCLUDING DEFAULTS is required as well as CONSTRAINTS: without it the copied
-- NOT NULL `id` has no gen_random_uuid() default and every probe insert fails on
-- id rather than on the CHECK under test.
CREATE TEMP TABLE _probe (LIKE public.content_reports INCLUDING CONSTRAINTS INCLUDING DEFAULTS) ON COMMIT DROP;

-- Strip NOT NULL from every column except content_type. Otherwise the probe
-- insert fails on whichever unrelated required column comes first (id, then
-- content_id, then reporter_id, ...) and never reaches the CHECK under test —
-- which would make this section silently vacuous rather than failing loudly.
DO $$
DECLARE col text;
BEGIN
  FOR col IN
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid = '_probe'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull AND a.attname <> 'content_type'
  LOOP
    EXECUTE format('ALTER TABLE _probe ALTER COLUMN %I DROP NOT NULL', col);
  END LOOP;
END $$;

CREATE FUNCTION pg_temp._accepts(p_value text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _probe (content_type) VALUES (p_value);
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END;
$$;

-- Every authorized value is accepted.
SELECT CASE
  WHEN bool_and(pg_temp._accepts(value))
    THEN 'PASS all 9 authorized content_type values are accepted'
  ELSE 'FAIL an authorized content_type value was rejected: '
       || (SELECT string_agg(value, ', ') FROM _authorized WHERE NOT pg_temp._accepts(value))
END AS accepts_authorized
FROM _authorized;

-- student_review is accepted by name. INVERTED at 20260906000000: it was retired
-- by the 2026-07-01 teardown and is now restored, so the assertion that used to
-- prove it was rejected must prove the opposite, or restoring the feature would
-- look like drift.
SELECT CASE
  WHEN pg_temp._accepts('student_review')
    THEN 'PASS student_review is accepted (restored by 20260906000000)'
  ELSE 'FAIL student_review was rejected — dorm-rating reports cannot be filed'
END AS accepts_restored;

-- An arbitrary unknown value is rejected, proving the constraint is enforcing at
-- all rather than having been dropped.
SELECT CASE
  WHEN pg_temp._accepts('definitely_not_a_content_type')
    THEN 'FAIL a bogus content_type was accepted — chk_content_type is not enforcing'
  ELSE 'PASS a bogus content_type is rejected'
END AS rejects_bogus;

-- 5. Same guard for moderation_actions_content_type_check ---------------------
--    Identical drop/re-add mechanics (community_phase1 L270), and it drifted the
--    same way: 20260630131348_vrsa_moderation_actions created it with 5 values,
--    community_phase1 re-added it with 7.

CREATE TEMP TABLE _authorized_ma(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized_ma VALUES
  ('student_review'),   -- KEPT ON PURPOSE — append-only audit log, see header
  ('marketplace_listing'), ('roommate_post'), ('building_chat_link'),
  ('user'), ('student_setup'), ('group_message'),
  ('dm_message'),  -- 20260825010000_dm_message_reporting.sql
  -- The six automated image-screen contexts, added together with
  -- 20260916000000_moderation_actions_automated_image_screen.sql. They mirror the
  -- CONTEXTS set in supabase/functions/moderate-image/index.ts — keep the three in sync.
  ('profile_photo'), ('dm_photo'), ('roommate_post_photo'),
  ('setup_photo'), ('business_image'), ('dorm_photo');

WITH actual AS (
  SELECT m[1] AS value
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
  WHERE c.conrelid = 'public.moderation_actions'::regclass
    AND c.conname = 'moderation_actions_content_type_check'
),
missing AS (SELECT value FROM _authorized_ma EXCEPT SELECT value FROM actual),
extra   AS (SELECT value FROM actual EXCEPT SELECT value FROM _authorized_ma)
SELECT CASE
  WHEN (SELECT count(*) FROM missing) > 0
    THEN 'FAIL moderation_actions_content_type_check is TOO NARROW, missing: '
         || (SELECT string_agg(value, ', ') FROM missing)
  WHEN (SELECT count(*) FROM extra) > 0
    THEN 'FAIL moderation_actions_content_type_check is TOO BROAD, unexpected: '
         || (SELECT string_agg(value, ', ') FROM extra)
  ELSE 'PASS moderation_actions_content_type_check is exactly the 14 authorized values'
END AS ma_exact_set_equality;

SELECT CASE
  WHEN convalidated THEN 'PASS moderation_actions_content_type_check is validated'
  ELSE 'FAIL moderation_actions_content_type_check exists but is NOT VALID'
END AS ma_validated
FROM pg_constraint
WHERE conrelid = 'public.moderation_actions'::regclass
  AND conname = 'moderation_actions_content_type_check';

-- The two lists must now AGREE on student_review: content_reports accepts new
-- reports of a rating, and moderation_actions can record the action taken. A
-- report type that cannot be actioned (or an action for an unreportable type) is
-- the failure this catches.
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM _authorized_ma WHERE value = 'student_review')
   AND EXISTS (SELECT 1 FROM _authorized    WHERE value = 'student_review')
    THEN 'PASS student_review is reportable AND actionable — the two CHECKs agree'
  ELSE 'FAIL student_review is in only one of the two CHECKs — a report that cannot be moderated, or vice versa'
END AS ma_student_review_agreement;

CREATE TEMP TABLE _probe_ma (LIKE public.moderation_actions INCLUDING CONSTRAINTS INCLUDING DEFAULTS) ON COMMIT DROP;

DO $$
DECLARE col text;
BEGIN
  FOR col IN
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid = '_probe_ma'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull AND a.attname <> 'content_type'
  LOOP
    EXECUTE format('ALTER TABLE _probe_ma ALTER COLUMN %I DROP NOT NULL', col);
  END LOOP;
END $$;

CREATE FUNCTION pg_temp._accepts_ma(p_value text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _probe_ma (content_type) VALUES (p_value);
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END;
$$;

SELECT CASE
  WHEN bool_and(pg_temp._accepts_ma(value))
    THEN 'PASS all 14 authorized moderation_actions content_type values are accepted'
  ELSE 'FAIL an authorized moderation_actions content_type value was rejected: '
       || (SELECT string_agg(value, ', ') FROM _authorized_ma WHERE NOT pg_temp._accepts_ma(value))
END AS ma_accepts_authorized
FROM _authorized_ma;

-- Note the INVERSION relative to section 4: here student_review MUST be accepted.
SELECT CASE
  WHEN pg_temp._accepts_ma('student_review')
    THEN 'PASS student_review is still accepted by the moderation_actions audit log'
  ELSE 'FAIL student_review was rejected by moderation_actions — historical audit rows are now unrepresentable'
END AS ma_retains_student_review;

SELECT CASE
  WHEN pg_temp._accepts_ma('definitely_not_a_content_type')
    THEN 'FAIL a bogus content_type was accepted — moderation_actions_content_type_check is not enforcing'
  ELSE 'PASS a bogus moderation_actions content_type is rejected'
END AS ma_rejects_bogus;

ROLLBACK;
