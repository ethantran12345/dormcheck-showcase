-- P1-2 (security review 2026-08-01): get_content_reports had no arm for
-- content_type 'student_setup', so setup reports satisfied no OR branch and
-- never reached the queue. Worse, the re-grep showed the gap starts earlier:
-- content_reports.content_id is uuid while student_setups.id is bigint, and the
-- client reports String(setup.id) — the INSERT itself fails with 22P02, so a
-- setup report was never even recorded. Fix: give student_setups a stable uuid
-- identity for reporting, teach the client to send it, and add the arms here.
-- Expand-only: nothing existing changes shape.

ALTER TABLE public.student_setups
  ADD COLUMN IF NOT EXISTS report_uuid uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_setups_report_uuid
  ON public.student_setups (report_uuid);

-- Function body below is the full 20260816000000_community_phase1 definition
-- plus the four 'student_setup' arms (preview title/body, owner, tenant scope).
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
      WHEN 'group_message' THEN (SELECT 'Message in ' || gc.name FROM group_messages gm JOIN group_conversations gc ON gc.id = gm.group_id WHERE gm.id = cr.content_id)
      WHEN 'student_setup' THEN (SELECT 'Room setup in ' || ss.dorm_name FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT LEFT(gm.content, 200) FROM group_messages gm WHERE gm.id = cr.content_id)
      WHEN 'student_setup' THEN (SELECT LEFT(COALESCE(ss.caption, ''), 200) FROM student_setups ss WHERE ss.report_uuid = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT gm.sender_id FROM group_messages gm WHERE gm.id = cr.content_id)
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
      OR (cr.content_type = 'student_setup' AND EXISTS (
            SELECT 1 FROM public.student_setups ss
            JOIN public.profiles sp ON sp.id = ss.user_id
            WHERE ss.report_uuid = cr.content_id AND sp.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;

revoke execute on function public.get_content_reports(text, uuid) from public, anon;
grant execute on function public.get_content_reports(text, uuid) to authenticated;
