-- Room Gallery trust pass (desktop Student Setups UX handoff):
-- 1. student_setups.is_hidden - moderation flag so admin/test content can be
--    blocked from every gallery query without deleting rows (audit trail kept).
-- 2. Hide known pittadmin test posts (waterfall/dune/flowers stock images).
-- 3. get_setups_preview() now excludes photos belonging to hidden setups.
-- 4. content_reports.chk_content_type gains 'student_setup' so room photos
--    are reportable through the existing ReportContentDialog flow.
--
-- THIS FILE IS APPLIED ON PROD AND IS MAINTAINED FOR REPLAY SAFETY (amended
-- 2026-07-27). Its only remaining consumer is `supabase db reset` — prod stores
-- the SQL it actually ran, and `list_branches` confirms no staging/preview
-- environment exists. Sections 2 and 4 below were amended so a replay cannot
-- destroy state; see `git show 5805ac87:docs/tasks/PLAN.md` for the evidence and DO NOT "restore"
-- them to match what prod ran.

-- 1. Moderation flag ---------------------------------------------------------
ALTER TABLE public.student_setups
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.student_setups.is_hidden IS
'Moderation flag: hidden setups are excluded from all gallery queries and the
public preview RPC. Set true for test/admin/non-room content instead of deleting.';

-- 2. Hide known test content (pittadmin seed posts) ---------------------------
-- INTENTIONALLY REMOVED (amended 2026-07-27).
--
-- This section used to `UPDATE public.student_setups SET is_hidden = true WHERE
-- author_name = 'pittadmin'`. That statement is NOT idempotent in the way that
-- matters: on a replay it re-hides any pittadmin setup a moderator has since
-- deliberately un-hidden, and `is_hidden` carries no history column, so the prior
-- value is unrecoverable from the database. It was the only irreversible
-- statement in this file.
--
-- Deleting it is a no-op against prod, which holds 2 student_setups rows, 0 with
-- author_name = 'pittadmin' and 0 with is_hidden = true (read 2026-07-27) — the
-- statement's effect is already fully realised and it has no targets left. On a
-- fresh reset there are no seed rows to hide either. Removing it is therefore
-- strictly safer than any conditional rewrite. See `git show 5805ac87:docs/tasks/PLAN.md` §2b.

-- 3. Public preview teaser excludes hidden setups ------------------------------
-- INTENTIONALLY NO DDL HERE (amended 2026-07-26).
--
-- This section used to `CREATE OR REPLACE FUNCTION public.get_setups_preview()`
-- (zero-arg) to add the `NOT ss.is_hidden` filter. That was a copy-paste from the
-- pre-tenant-scoping body: 20260721000001_preview_rpc_tenant_scoping.sql had already
-- DROPped the zero-arg overload and replaced it with
-- `get_setups_preview(p_university_id uuid DEFAULT NULL)` — whose body ALREADY carries
-- the `NOT ss.is_hidden` filter. Re-creating the zero-arg version here resurrected a
-- dropped overload, so a filename-order `supabase db reset` ended with BOTH overloads
-- and any zero-arg call failed with 42725 "function ... is not unique".
--
-- Prod never had that problem: it applied these under apply-time versions
-- (preview_rpc_tenant_scoping = 20260721231607) and holds exactly ONE overload,
-- `get_setups_preview(uuid)`, whose definition, comment and ACL match
-- 20260721000001 byte-for-byte. Removing this block is therefore a PROVEN NO-OP
-- against prod and restores `db reset` ≡ prod. Hidden-setup exclusion is unchanged:
-- it lives in the (uuid) overload. See docs/DECISIONS.md 2026-07-26.

-- 3b. Admin moderation: admins can update setups (set is_hidden) from the
--     Reports Queue. Mirrors the owner-or-admin pattern on seller_ratings /
--     roommate_search_posts. Policies OR together with the owner update policy.
DROP POLICY IF EXISTS rls_student_setups_update_admin ON public.student_setups;
CREATE POLICY rls_student_setups_update_admin ON public.student_setups
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
  ));

-- 4. Make student setups reportable -------------------------------------------
-- AMENDED 2026-07-27 on two counts, and again 2026-08-17 (see (c)). Read this
-- before editing the value list.
--
-- (a) THE VALUE SET IS AN EQUALITY, NOT A LOWER BOUND. A migration that re-adds
--     chk_content_type must enumerate the EXACT authorized replay/final-state set
--     — the set the database must hold after this file runs in any replay. This
--     section previously listed 6 values (it added only 'student_setup', the value
--     it was introducing). Prod held 7. A replay of the 6-value version silently
--     DELETES 'group_message' and breaks group-message reporting with 23514.
--
--     'group_message' IS INCLUDED DELIBERATELY, even though the migration that
--     "introduces" it (20260816000000_community_phase1.sql) sorts AFTER this file
--     by filename. That is not a mistake and must not be "corrected": including it
--     is what stops a partial replay of this file alone from narrowing the CHECK.
--     The same reasoning now covers 'dm_message' and 'student_review' — see (c).
--
-- (c) THIS LIST IS A STANDING MAINTENANCE OBLIGATION, NOT A HISTORICAL RECORD.
--     Because (a) makes it the final-state set, EVERY later migration that widens
--     content_reports.chk_content_type must ALSO add its new value here, in the
--     same commit. Two did not, and the list rotted:
--       - 20260825010000_dm_message_reporting.sql  added 'dm_message'    (-> 8)
--       - 20260906000000_restore_dorm_reviews.sql  added 'student_review' (-> 9)
--     `npm run test:migration-replay` was red from the first of those onward with
--     "TOO NARROW, missing: student_review, dm_message": a full reset left the
--     CHECK at 9 values and replaying THIS file knocked it back to 7. Both values
--     are added below, which is what the rule in (a) always required.
--
--     Note the reversal on 'student_review'. Before 2026-08-17 this comment said
--     it was "deliberately EXCLUDED" because 20260701053717_teardown_student_reviews
--     retired it. 20260906000000_restore_dorm_reviews UN-retired it, so excluding
--     it here no longer protects a retired value — it deletes a live one.
--
--     The authorized set is defined in supabase/tests/content_type_check_drift.test.sql.
--     That file and this list must always agree; change them together or not at all.
--
-- (b) NO UNCONSTRAINED WINDOW. The old form was DROP-then-ADD as two statements.
--     If the ADD fails (a row violates the narrowed set), the DROP may already have
--     committed, leaving content_reports with NO chk_content_type at all — arbitrary
--     content_type values accepted, strictly worse than the drift being fixed. The
--     add-validate-drop-rename swap below is correct whether or not the migration
--     runner wraps a file in a transaction, so it does not depend on that answer.
--
-- Verified by `npm run test:migration-replay` (replays this file on top of a full
-- reset) and `supabase/tests/content_type_check_drift.test.sql`.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type_new;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type_new
  CHECK (content_type = ANY (ARRAY[
    'marketplace_listing'::text,
    'roommate_post'::text,
    'building_chat_link'::text,
    'user'::text,
    'seller_rating'::text,
    'student_setup'::text,
    'group_message'::text,
    -- Added here 2026-08-17 to satisfy (c). Both are introduced by migrations that
    -- sort AFTER this file; both are listed here for the same reason 'group_message'
    -- is, so replaying this file alone cannot narrow the CHECK.
    'dm_message'::text,      -- 20260825010000_dm_message_reporting.sql
    'student_review'::text   -- 20260906000000_restore_dorm_reviews.sql
  ])) NOT VALID;
ALTER TABLE public.content_reports VALIDATE CONSTRAINT chk_content_type_new;
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports RENAME CONSTRAINT chk_content_type_new TO chk_content_type;
