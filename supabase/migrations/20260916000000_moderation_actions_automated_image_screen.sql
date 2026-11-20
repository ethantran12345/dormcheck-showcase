-- Automated image screen: let moderation_actions record a machine reject.
--
-- The `moderate-image` Edge Function screens every non-listing image upload path
-- (profile photos, DM photos, roommate post photos, room-setup photos, business
-- logos/banners, admin dorm photos). On a reject the caller deletes the object,
-- and this table is the only durable trace that it happened — so it has to be
-- able to hold the row.
--
-- Two CHECKs are widened:
--   action       + 'auto_reject_image'  (admin_id stays NULL — the actor is not a
--                                        human moderator; the column is already
--                                        nullable and FK ON DELETE SET NULL)
--   content_type + one value per screened surface
--
-- NOT-NULL / RLS / grants are untouched. The service role writes these rows and
-- bypasses RLS; no new policy is needed, and no client-reachable path is opened.
--
-- ── Two standing rules this file obeys (see 20260731040000 for the incident) ──
--
-- (a) THE VALUE SET IS AN EQUALITY, NOT A LOWER BOUND. Each list below is the
--     EXACT set the database must hold after this file runs in any replay, not
--     just the values being introduced. The prior authorized sets are:
--       action       — 20260712220421 (dismiss_report, delete_content,
--                      restore_listing, escalate_report)
--       content_type — 20260816000000 (student_review, marketplace_listing,
--                      roommate_post, building_chat_link, user, student_setup,
--                      group_message) PLUS dm_message, added later by
--                      20260825010000_dm_message_reporting.sql — omitting it
--                      here silently narrowed the constraint (caught by
--                      supabase/tests/content_type_check_drift.test.sql)
--     'student_review' IS retained deliberately: 20260701053717 removed it from
--     content_reports.chk_content_type but left it here on purpose, because the
--     audit trail outlives the feature it describes.
--
-- (b) NO UNCONSTRAINED WINDOW. Never DROP-then-ADD as two bare statements — if
--     the ADD fails the DROP may already have committed, leaving the table with
--     no CHECK at all. The add-validate-drop-rename swap below is correct whether
--     or not the migration runner wraps this file in a transaction.

-- ── action ───────────────────────────────────────────────────────────────────
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_action_check_new;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_action_check_new
  CHECK (action = ANY (ARRAY[
    'dismiss_report'::text,
    'delete_content'::text,
    'restore_listing'::text,
    'escalate_report'::text,
    'auto_reject_image'::text
  ])) NOT VALID;
ALTER TABLE public.moderation_actions
  VALIDATE CONSTRAINT moderation_actions_action_check_new;
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_action_check;
ALTER TABLE public.moderation_actions
  RENAME CONSTRAINT moderation_actions_action_check_new
    TO moderation_actions_action_check;

-- ── content_type ─────────────────────────────────────────────────────────────
-- The six new values mirror the CONTEXTS set in
-- supabase/functions/moderate-image/index.ts. Keep the two in sync.
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_content_type_check_new;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_content_type_check_new
  CHECK (content_type = ANY (ARRAY[
    'student_review'::text,
    'marketplace_listing'::text,
    'roommate_post'::text,
    'building_chat_link'::text,
    'user'::text,
    'student_setup'::text,
    'group_message'::text,
    'dm_message'::text,
    'profile_photo'::text,
    'dm_photo'::text,
    'roommate_post_photo'::text,
    'setup_photo'::text,
    'business_image'::text,
    'dorm_photo'::text
  ])) NOT VALID;
ALTER TABLE public.moderation_actions
  VALIDATE CONSTRAINT moderation_actions_content_type_check_new;
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_content_type_check;
ALTER TABLE public.moderation_actions
  RENAME CONSTRAINT moderation_actions_content_type_check_new
    TO moderation_actions_content_type_check;

COMMENT ON TABLE public.moderation_actions IS
  'Append-only moderation audit log. admin_id NULL means an automated actor '
  '(action = auto_reject_image, written by the moderate-image Edge Function '
  'under service_role); a non-null admin_id is a human moderator action.';
