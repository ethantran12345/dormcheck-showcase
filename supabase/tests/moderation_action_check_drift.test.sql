-- covers: 20260630131348_vrsa_moderation_actions.sql
-- covers: 20261013000000_storage_cleanup.sql
-- Action CHECK drift guard for public.moderation_actions.moderation_actions_action_check.
-- Run: psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/tests/moderation_action_check_drift.test.sql
--
-- DELIBERATELY SEPARATE FROM content_type_check_drift.test.sql. That probe guards
-- WHAT was moderated (content_type); this one guards WHAT THE ADMIN DID (action).
-- Different constraint class, different failure blast radius: a too-narrow
-- content_type blocks a report from being filed, a too-narrow `action` blocks the
-- admin's audit row from being written AFTER the destructive moderation has already
-- happened — the action succeeds and the audit log silently loses it. Do not merge
-- the two files; the value sets have no reason to move together.
--
-- History (why an exact-set assertion, not "at least N"):
--   20260630131348_vrsa_moderation_actions  created it with THREE actions:
--       dismiss_report, delete_content, restore_listing
--   20260712220421_report_escalation_and_admin_email_log  widened it to FOUR by
--       DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (L33-L36) — the same bare
--       drop/re-add pattern that silently deleted values from the content_type
--       CHECK in 20260731040000. It happened to enumerate the full set correctly.
--       The next migration to touch it may not; that is what this file catches.
--   All four values have live callers in src/pages/admin/ReportsPage.tsx and
--   src/components/admin/AutoHeldListingsPanel.tsx, so a narrowing is a runtime
--   break, not a cosmetic one.
--
-- Wrapped in BEGIN..ROLLBACK, so it writes nothing that outlives the run and is
-- order-independent under TEST_DB_ORDER=reverse|shuffle. Section 6 mutates the
-- constraint on purpose and undoes it with ROLLBACK TO SAVEPOINT.

\set ON_ERROR_STOP on

BEGIN;

-- The authorized set. Update this list ONLY together with a migration that
-- changes the constraint, never to make a failing test pass.
CREATE TEMP TABLE _authorized_action(value text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _authorized_action VALUES
  ('dismiss_report'),    -- 20260630131348
  ('delete_content'),    -- 20260630131348
  ('restore_listing'),   -- 20260630131348
  ('escalate_report'),   -- added 20260712220421
  ('auto_reject_image'), -- added 20260916000000_moderation_actions_automated_image_screen.sql
  ('auto_hold_image');   -- added 20261013000000_storage_cleanup.sql

-- The verdict is a FUNCTION, not an inline query, so section 6 can re-run the
-- exact same assertion against a deliberately-broken constraint. A self-test that
-- re-implemented the check would prove nothing about the check that ships.
CREATE FUNCTION pg_temp._action_verdict() RETURNS text
LANGUAGE sql AS $$
  WITH actual AS (
    SELECT m[1] AS value
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
    WHERE c.conrelid = 'public.moderation_actions'::regclass
      AND c.conname = 'moderation_actions_action_check'
  ),
  missing AS (SELECT value FROM _authorized_action EXCEPT SELECT value FROM actual),
  extra   AS (SELECT value FROM actual EXCEPT SELECT value FROM _authorized_action)
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.moderation_actions'::regclass
        AND conname = 'moderation_actions_action_check')
      THEN 'FAIL moderation_actions_action_check does not exist — the audit log accepts any action string'
    WHEN (SELECT count(*) FROM missing) > 0
      THEN 'FAIL moderation_actions_action_check is TOO NARROW, missing: '
           || (SELECT string_agg(value, ', ' ORDER BY value) FROM missing)
    WHEN (SELECT count(*) FROM extra) > 0
      THEN 'FAIL moderation_actions_action_check is TOO BROAD, unexpected: '
           || (SELECT string_agg(value, ', ' ORDER BY value) FROM extra)
    ELSE 'PASS moderation_actions_action_check is exactly the 6 authorized actions'
  END;
$$;

-- 1. EXACT set equality against the live constraint definition.
SELECT pg_temp._action_verdict() AS exact_set_equality;

-- 2. The constraint must be validated, not left NOT VALID by a partial repair.
SELECT CASE
  WHEN convalidated THEN 'PASS moderation_actions_action_check is validated'
  ELSE 'FAIL moderation_actions_action_check exists but is NOT VALID'
END AS validated
FROM pg_constraint
WHERE conrelid = 'public.moderation_actions'::regclass
  AND conname = 'moderation_actions_action_check';

-- 3. No leftover temp-named constraint from an interrupted add-under-a-temp-name
--    → VALIDATE → drop old → RENAME swap (the pattern .claude/rules/supabase-backend.md
--    mandates instead of the bare drop/re-add 20260712220421 used).
SELECT CASE
  WHEN count(*) = 0 THEN 'PASS no leftover moderation_actions_action_check_new'
  ELSE 'FAIL moderation_actions_action_check_new still present — an interrupted constraint swap'
END AS no_leftover
FROM pg_constraint
WHERE conrelid = 'public.moderation_actions'::regclass
  AND conname = 'moderation_actions_action_check_new';

-- 4. Behavioral check on a copy of the table. INCLUDING CONSTRAINTS copies CHECKs
--    (not FKs), INCLUDING DEFAULTS is required so the NOT NULL `id` keeps its
--    gen_random_uuid() default — without it every probe insert fails on id rather
--    than on the CHECK under test, making the whole section silently vacuous.
CREATE TEMP TABLE _probe_action (LIKE public.moderation_actions INCLUDING CONSTRAINTS INCLUDING DEFAULTS) ON COMMIT DROP;

-- Strip NOT NULL from every column except `action`, for the same reason.
DO $$
DECLARE col text;
BEGIN
  FOR col IN
    SELECT a.attname FROM pg_attribute a
    WHERE a.attrelid = '_probe_action'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull AND a.attname <> 'action'
  LOOP
    EXECUTE format('ALTER TABLE _probe_action ALTER COLUMN %I DROP NOT NULL', col);
  END LOOP;
END $$;

-- moderation_actions also CHECKs content_type; supply a value that satisfies it so
-- the probe fails on the `action` CHECK or not at all.
CREATE FUNCTION pg_temp._accepts_action(p_value text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO _probe_action (action, content_type) VALUES (p_value, 'marketplace_listing');
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END;
$$;

SELECT CASE
  WHEN bool_and(pg_temp._accepts_action(value))
    THEN 'PASS all 6 authorized actions are accepted'
  ELSE 'FAIL an authorized action was rejected: '
       || (SELECT string_agg(value, ', ' ORDER BY value) FROM _authorized_action
           WHERE NOT pg_temp._accepts_action(value))
END AS accepts_authorized
FROM _authorized_action;

-- 5. An arbitrary unknown action is rejected, proving the constraint is enforcing
--    at all rather than having been dropped and never re-added.
SELECT CASE
  WHEN pg_temp._accepts_action('definitely_not_a_moderation_action')
    THEN 'FAIL a bogus action was accepted — moderation_actions_action_check is not enforcing'
  ELSE 'PASS a bogus action is rejected'
END AS rejects_bogus;

-- 6. NEGATIVE SELF-TEST — prove section 1 actually fires red -------------------
--    Reproduces the exact regression this file exists to catch: re-add the
--    constraint with the pre-20260712220421 three-action set, i.e. a migration
--    that "restores" the constraint from the older migration and silently drops
--    'escalate_report'. The verdict must go red AND name the missing value.
--    Its text is compared, never printed — printing it would emit the literal
--    FAIL token that scripts/test-db.sh greps for and fail this probe for passing.
SAVEPOINT before_drift;

ALTER TABLE public.moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_action_check
  CHECK (action IN ('dismiss_report', 'delete_content', 'restore_listing'));

SELECT CASE
  WHEN pg_temp._action_verdict() LIKE 'FAIL%TOO NARROW%escalate_report%'
    THEN 'PASS negative self-test: dropping escalate_report is detected as TOO NARROW'
  ELSE 'FAIL the drift guard did NOT fire on a constraint missing escalate_report — section 1 is vacuous'
END AS negative_test_narrow;

ROLLBACK TO SAVEPOINT before_drift;

--    And the mirror case: a value nobody authorized gets added.
SAVEPOINT before_broad;

ALTER TABLE public.moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_action_check
  CHECK (action IN ('dismiss_report', 'delete_content', 'restore_listing',
                    'escalate_report', 'auto_reject_image', 'auto_hold_image', 'shadow_ban'));

SELECT CASE
  WHEN pg_temp._action_verdict() LIKE 'FAIL%TOO BROAD%shadow_ban%'
    THEN 'PASS negative self-test: an unauthorized action is detected as TOO BROAD'
  ELSE 'FAIL the drift guard did NOT fire on an unauthorized added action'
END AS negative_test_broad;

ROLLBACK TO SAVEPOINT before_broad;

-- The savepoint rollbacks must have restored the real constraint. If this line
-- disagrees with section 1, the self-test leaked.
SELECT CASE
  WHEN pg_temp._action_verdict() LIKE 'PASS%'
    THEN 'PASS the negative self-test left the real constraint intact'
  ELSE 'FAIL the negative self-test leaked — the constraint is not back to its authorized shape'
END AS self_test_restored;

ROLLBACK;
