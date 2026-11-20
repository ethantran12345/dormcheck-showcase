-- P1.8(a+b) admin console usefulness. Expand-only.
--   1. Report escalation ("Escalate to DormCheck", UI Interaction Spec): a
--      university_admin hands a report to superadmin triage instead of
--      deciding. content_reports gains escalated_at/escalated_by; escalated
--      rows leave the university_admin queue and appear for superadmins.
--   2. moderation_actions action CHECK widened with 'escalate_report'.
--   3. get_content_reports() returns escalated_at (DROP-then-CREATE again).
--   4. admin_email_log - server-side dedup for the weekly digest + 48h
--      unactioned-report nudge crons ("never more than one per day total").
--      Service-role only; no client access.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712140000.

-- ── 1. Escalation columns + admin UPDATE path ────────────────────────────────

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Admins had SELECT/DELETE only; escalation needs UPDATE.
DROP POLICY IF EXISTS rls_content_reports_update_admin ON public.content_reports;
CREATE POLICY rls_content_reports_update_admin ON public.content_reports
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- ── 2. moderation_actions CHECK ──────────────────────────────────────────────

ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_action_check;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_action_check
  CHECK (action IN ('dismiss_report', 'delete_content', 'restore_listing', 'escalate_report'));

-- ── 3. get_content_reports returns escalated_at ──────────────────────────────
-- Body copied from 20260712100000 with cr.escalated_at added.

drop function if exists public.get_content_reports(text, uuid);

create or replace function public.get_content_reports(
  content_type_filter text default null,
  p_university_id uuid default null
)
returns table(
  report_id uuid,
  content_type text,
  content_id uuid,
  reporter_id uuid,
  reporter_name text,
  reason text,
  category text,
  escalated_at timestamptz,
  reported_at timestamptz,
  content_preview_title text,
  content_preview_body text,
  content_owner_id uuid,
  content_owner_name text,
  content_context text
)
language sql
stable security definer
set search_path to 'public'
as $function$
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
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
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
    )
  ORDER BY cr.created_at DESC;
$function$;

revoke execute on function public.get_content_reports(text, uuid) from public, anon;
grant execute on function public.get_content_reports(text, uuid) to authenticated;

-- ── 4. Admin email dedup log (server-side only) ──────────────────────────────

CREATE TABLE public.admin_email_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weekly_digest', 'report_nudge')),
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_email_log_admin_kind_idx ON public.admin_email_log (admin_id, kind, sent_at DESC);

ALTER TABLE public.admin_email_log ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role crons read/write this.
REVOKE ALL ON TABLE public.admin_email_log FROM anon, authenticated;
