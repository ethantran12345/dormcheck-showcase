-- Reportable DMs: a student can report an individual direct message (the
-- moderation path that photo attachments require before students get them).
--
-- WHY report_uuid AND NOT messages.id: `content_reports.content_id` is uuid,
-- but `messages.id` is a BIGINT (group_messages.id is a uuid, which is why
-- group_message reporting needed no such column). `student_setups.report_uuid`
-- already solved exactly this mismatch, so this mirrors that precedent instead
-- of widening content_id to text and rewriting every consumer.
--
-- Table is tiny (single-digit rows at pilot scale), so the volatile default's
-- table rewrite is trivial here. On a large table this would want the
-- expand/backfill/constrain dance instead.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS report_uuid uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS messages_report_uuid_key
  ON public.messages (report_uuid);

-- ORDERING REPAIR (2026-08-05), not a new feature. The get_content_reports
-- rewrite further down this file reads `student_setups.report_uuid`, but that
-- column is added by 20260830030000_get_content_reports_student_setup.sql --
-- which sorts AFTER this file. Prod never noticed: migrations are applied there
-- via MCP under apply-time version stamps, and the student_setups one went in
-- first (prod version 20260802015258, vs 20260804040050 for this file). A
-- filename-order replay -- `supabase db reset`, and therefore the Migration /
-- RLS Safety Guard's "Start local Supabase" step -- runs them the other way and
-- dies with `column ss.report_uuid does not exist (42703)`.
--
-- Adding it here rather than resequencing the files: this is idempotent and a
-- pure no-op anywhere the column already exists (prod, and any DB where the
-- later migration has run), whereas renaming a migration that is already applied
-- in prod would desynchronise the recorded history for no benefit. The later
-- migration keeps its own identical ADD COLUMN IF NOT EXISTS and its unique
-- index; neither file now depends on the other's ordering.
ALTER TABLE public.student_setups
  ADD COLUMN IF NOT EXISTS report_uuid uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.messages.report_uuid IS
  'Stable uuid handle for moderation (content_reports.content_id is uuid; messages.id is bigint). Mirrors student_setups.report_uuid.';

-- ── Widen the content-type CHECKs to admit 'dm_message' ─────────────────────
-- Same drop/recreate shape as 20260816000000_community_phase1 used to admit
-- 'group_message'. Additive: every previously valid value stays valid.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (content_type = ANY (ARRAY[
    'marketplace_listing','roommate_post','building_chat_link','user',
    'seller_rating','student_setup','group_message','dm_message'
  ]));

ALTER TABLE public.moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_content_type_check;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_content_type_check
  CHECK (content_type = ANY (ARRAY[
    'student_review','marketplace_listing','roommate_post','building_chat_link',
    'user','student_setup','group_message','dm_message'
  ]));

-- ── get_content_reports: preview, owner, context and tenant scope for DMs ───
-- PRIVACY: a DM is private, and this exposes exactly ONE message — the reported
-- row — to admins, on the same terms group_message already is. It exposes no
-- thread, no counterparty text, and nothing that was not reported.
-- A photo message's `content` is only the "📷 Photo" fallback, so the preview
-- surfaces the object URL instead; an admin who cannot see the image cannot
-- moderate the report.
CREATE OR REPLACE FUNCTION public.get_content_reports(
  content_type_filter text DEFAULT NULL::text,
  p_university_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  report_id uuid, content_type text, content_id uuid, reporter_id uuid,
  reporter_name text, reason text, category text, escalated_at timestamp with time zone,
  reported_at timestamp with time zone, content_preview_title text,
  content_preview_body text, content_owner_id uuid, content_owner_name text,
  content_context text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
    cr.category,
    cr.escalated_at,
    cr.created_at AS reported_at,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.title FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT
        CASE rsp.post_type
          WHEN 'looking-for-roommates' THEN 'Looking for roommates'
          WHEN 'have-place-need-people' THEN 'Have a place, need people'
          ELSE 'Roommate post'
        END
        FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT COALESCE(bcl.label, 'Chat link') FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT 'Seller rating: ' || sr.stars || ' of 5 stars' FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT 'Message in ' || gc.name FROM group_messages gm JOIN group_conversations gc ON gc.id = gm.group_id WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT
        CASE WHEN m.metadata ->> 'type' = 'image' THEN 'Direct message (photo)' ELSE 'Direct message' END
        FROM messages m WHERE m.report_uuid = cr.content_id)
      WHEN 'student_setup' THEN (SELECT 'Room setup in ' || ss.dorm_name FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT LEFT(gm.content, 200) FROM group_messages gm WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT
        COALESCE(m.metadata ->> 'url', LEFT(COALESCE(m.content, ''), 200))
        FROM messages m WHERE m.report_uuid = cr.content_id)
      WHEN 'student_setup' THEN (SELECT LEFT(COALESCE(ss.caption, ''), 200) FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT gm.sender_id FROM group_messages gm WHERE gm.id = cr.content_id)
      WHEN 'dm_message' THEN (SELECT m.sender_id FROM messages m WHERE m.report_uuid = cr.content_id)
      WHEN 'student_setup' THEN (SELECT ss.user_id FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_owner_id,
    NULL::text AS content_owner_name,
    CASE cr.content_type
      WHEN 'building_chat_link' THEN (
        SELECT mh.residence_hall
        FROM building_chat_links bcl
        JOIN master_housing mh ON mh.id = bcl.building_id
        WHERE bcl.id = cr.content_id
      )
      WHEN 'seller_rating' THEN (
        SELECT 'Rating of ' || COALESCE(sp.full_name, 'a seller')
        FROM seller_ratings sr
        LEFT JOIN profiles sp ON sp.id = sr.seller_id
        WHERE sr.id = cr.content_id
      )
      WHEN 'group_message' THEN (
        SELECT 'Sent by ' || COALESCE(sp.full_name, 'a member')
        FROM group_messages gm
        LEFT JOIN profiles sp ON sp.id = gm.sender_id
        WHERE gm.id = cr.content_id
      )
      WHEN 'dm_message' THEN (
        SELECT 'Sent by ' || COALESCE(sp.full_name, 'a student')
        FROM messages m
        LEFT JOIN profiles sp ON sp.id = m.sender_id
        WHERE m.report_uuid = cr.content_id
      )
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN public.is_superadmin() THEN p_university_id
      ELSE public.current_university_id()
    END AS uid
  ) scope
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
    AND (
      (public.is_superadmin() AND p_university_id IS NULL)
      OR (cr.content_type = 'marketplace_listing' AND EXISTS (
            SELECT 1 FROM public.marketplace_listings ml
            WHERE ml.id = cr.content_id AND ml.university_id = scope.uid))
      OR (cr.content_type = 'roommate_post' AND EXISTS (
            SELECT 1 FROM public.roommate_search_posts rsp
            WHERE rsp.id = cr.content_id AND rsp.university_id = scope.uid))
      OR (cr.content_type = 'building_chat_link' AND EXISTS (
            SELECT 1 FROM public.building_chat_links bcl
            WHERE bcl.id = cr.content_id AND bcl.university_id = scope.uid))
      OR (cr.content_type = 'user' AND EXISTS (
            SELECT 1 FROM public.profiles rp
            WHERE rp.id = cr.content_id AND rp.university_id = scope.uid))
      OR (cr.content_type = 'seller_rating' AND EXISTS (
            SELECT 1 FROM public.seller_ratings sr
            JOIN public.profiles sp ON sp.id = sr.seller_id
            WHERE sr.id = cr.content_id AND sp.university_id = scope.uid))
      OR (cr.content_type = 'group_message' AND EXISTS (
            SELECT 1 FROM public.group_messages gm
            JOIN public.profiles sp ON sp.id = gm.sender_id
            WHERE gm.id = cr.content_id AND sp.university_id = scope.uid))
      -- Tenant scope follows the SENDER's university, exactly as group_message
      -- does, so a Pitt admin never sees a CMU student's reported message.
      OR (cr.content_type = 'dm_message' AND EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.profiles sp ON sp.id = m.sender_id
            WHERE m.report_uuid = cr.content_id AND sp.university_id = scope.uid))
      OR (cr.content_type = 'student_setup' AND EXISTS (
            SELECT 1 FROM public.student_setups ss
            JOIN public.profiles sp ON sp.id = ss.user_id
            WHERE ss.report_uuid = cr.content_id AND sp.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;
