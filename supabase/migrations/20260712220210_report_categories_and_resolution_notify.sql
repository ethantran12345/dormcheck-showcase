-- P0.2 block/report completeness (App Store Guideline 1.2). Expand-only:
--   1. content_reports.category — structured report categories (nullable so
--      existing rows and older clients keep inserting reason-only reports).
--   2. moderation_actions.reporter_id — the resolution flow deletes the
--      content_reports row (ReportsPage clearReportRows), so the reporter must
--      be denormalized here for the feedback notification to find them.
--   3. notifications type CHECK widened with 'report_resolution'.
--   4. get_content_reports RPC returns the new category column.
--   5. AFTER INSERT trigger on moderation_actions notifies the reporter that
--      their report was reviewed (payload stores facts, copy lives client-side
--      in src/lib/notifications.ts; no admin identity exposed).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729040000.

-- ── 1. Structured report category ────────────────────────────────────────────

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS category text
  CONSTRAINT content_reports_category_check CHECK (
    category IS NULL OR category IN (
      'scam_fraud', 'fake_listing', 'harassment',
      'off_platform_payment', 'spam', 'other'
    )
  );

-- ── 2. Reporter denormalized onto the moderation trail ───────────────────────

ALTER TABLE public.moderation_actions
  ADD COLUMN IF NOT EXISTS reporter_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 3. Widen notifications.type ──────────────────────────────────────────────

-- Prod applied this migration AFTER the notifications table existed (apply-time
-- version ordering); the repo's file-timestamp chain creates the table later in
-- 20260713000000. Skip when the table is absent so a from-scratch local apply
-- (CI RLS guard, supabase start) works; 20260713020000 re-widens the CHECK to
-- include 'report_resolution' on the fresh chain.
DO $$
DECLARE c text;
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RETURN;
  END IF;

  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;

  EXECUTE $ddl$
    ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'roommate_invite_accepted', 'building_new_residents',
      'admin_announcement', 'report_resolution'
    ))
  $ddl$;
END $$;

-- ── 4. get_content_reports returns category ──────────────────────────────────
-- DROP-then-CREATE (return-table change); body copied from 20260728000000 with
-- only cr.category added. Same silo-clamp semantics.
-- The body references is_superadmin()/current_university_id(), which the
-- file-timestamp chain creates later (20260723020000); prod applied in a
-- different (apply-time) order. Skip SQL-body validation so a from-scratch
-- local apply works; 20260728000000 recreates this function as the final shape.
set check_function_bodies = off;

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
  -- Effective silo scope: superadmin uses the (optional) param; everyone else
  -- is clamped to their own university regardless of what they pass.
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
      -- Unscoped only for superadmin with no silo selected (legacy calls).
      (public.is_superadmin() AND p_university_id IS NULL)
      -- Per content type, resolve the report's university and match the scope.
      OR (cr.content_type = 'marketplace_listing' AND EXISTS (
            SELECT 1 FROM public.marketplace_listings ml
            WHERE ml.id = cr.content_id AND ml.university_id = scope.uid))
      OR (cr.content_type = 'roommate_post' AND EXISTS (
            SELECT 1 FROM public.roommate_search_posts rsp
            WHERE rsp.id = cr.content_id AND rsp.university_id = scope.uid))
      OR (cr.content_type = 'building_chat_link' AND EXISTS (
            SELECT 1 FROM public.building_chat_links bcl
            WHERE bcl.id = cr.content_id AND bcl.university_id = scope.uid))
      -- User reports: content_id is the reported profile; scope via their school.
      OR (cr.content_type = 'user' AND EXISTS (
            SELECT 1 FROM public.profiles rp
            WHERE rp.id = cr.content_id AND rp.university_id = scope.uid))
      -- Seller ratings: scope via the rated seller's school.
      OR (cr.content_type = 'seller_rating' AND EXISTS (
            SELECT 1 FROM public.seller_ratings sr
            JOIN public.profiles sp ON sp.id = sr.seller_id
            WHERE sr.id = cr.content_id AND sp.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;

revoke execute on function public.get_content_reports(text, uuid) from public, anon;
grant execute on function public.get_content_reports(text, uuid) to authenticated;

-- ── 5. Reporter-feedback notification on resolution ──────────────────────────
-- Fires per moderation_actions row; ReportsPage inserts exactly one per
-- resolved report card, so only that card's reporter is notified (other
-- reporters of the same content are cleared silently — acceptable v1).
-- Exception-safe: a notification failure must never block the moderation write.

CREATE OR REPLACE FUNCTION public.notify_report_resolved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.action IN ('dismiss_report', 'delete_content')
     AND NEW.reporter_id IS NOT NULL THEN
    BEGIN
      PERFORM public._create_notification(
        NEW.reporter_id,
        'report_resolution',
        jsonb_build_object(
          'action', NEW.action,
          'content_type', NEW.content_type,
          'report_id', NEW.report_id
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_report_resolved failed for moderation_action %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_report_resolved() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_report_resolved ON public.moderation_actions;
CREATE TRIGGER trg_notify_report_resolved
  AFTER INSERT ON public.moderation_actions
  FOR EACH ROW EXECUTE FUNCTION public.notify_report_resolved();
