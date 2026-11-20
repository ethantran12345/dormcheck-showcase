-- Teardown: remove the Dorm Rating star-ratings & reviews feature entirely.
-- Product decision (2026-07-01): reviews and star ratings are gone; DormDetail keeps
-- only Overview + Student Setups. Ships AFTER the code stops reading/writing reviews
-- (expand/contract: code-first, then this destructive DB drop), mirroring
-- 20260613260000_teardown_dining_and_legacy_orphans.sql.
--
-- Idempotent (IF EXISTS) so it runs cleanly on the local Docker stack and prod.
--
-- Order matters: a SQL function's body is re-planned on each call, so
-- get_content_reports() must stop referencing student_reviews BEFORE the table drops,
-- or every admin reports query would error at runtime once the table is gone.

-- a. Recreate get_content_reports() without the 'student_review' branches.
--    Body is otherwise identical to the baseline definition (unchanged since
--    20260101000000; 20260612063456 noted "RPC get_content_reports is unchanged").
--    CREATE OR REPLACE preserves existing owner and grants.
CREATE OR REPLACE FUNCTION public.get_content_reports(content_type_filter text DEFAULT NULL::text)
RETURNS TABLE(
  report_id uuid,
  content_type text,
  content_id uuid,
  reporter_id uuid,
  reporter_name text,
  reason text,
  reported_at timestamp with time zone,
  content_preview_title text,
  content_preview_body text,
  content_owner_id uuid,
  content_owner_name text,
  content_context text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
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
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
    END AS content_owner_id,
    NULL::text AS content_owner_name,
    CASE cr.content_type
      WHEN 'building_chat_link' THEN (
        SELECT mh.residence_hall
        FROM building_chat_links bcl
        JOIN master_housing mh ON mh.id = bcl.building_id
        WHERE bcl.id = cr.content_id
      )
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
  ORDER BY cr.created_at DESC;
$$;

-- b. Clean up any orphaned review reports, then retire 'student_review' from the
--    content_reports content-type CHECK (delete must precede the tighter constraint).
--    NOTE: moderation_actions keeps 'student_review' in its CHECK on purpose - it is an
--    append-only audit log and may hold historical review-moderation rows.
DELETE FROM public.content_reports WHERE content_type = 'student_review';

ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (
    content_type = ANY (
      ARRAY[
        'marketplace_listing'::text,
        'roommate_post'::text,
        'building_chat_link'::text,
        'user'::text
      ]
    )
  );

-- c. Drop student_reviews RLS policies (CASCADE on the table drop would remove these,
--    but explicit drops match repo style and stay idempotent).
DROP POLICY IF EXISTS "rls_student_reviews_select" ON public.student_reviews;
DROP POLICY IF EXISTS "rls_student_reviews_insert" ON public.student_reviews;
DROP POLICY IF EXISTS "rls_student_reviews_update" ON public.student_reviews;
DROP POLICY IF EXISTS "rls_student_reviews_delete" ON public.student_reviews;

-- d. Drop the review RPCs. get_dorm_review_stats() was already dropped in prod by
--    20260613260000; the IF EXISTS drop is a safe no-op there and locally.
DROP FUNCTION IF EXISTS public.get_reviews_summary();
DROP FUNCTION IF EXISTS public.get_dorm_review_stats();

-- e. Drop the table. CASCADE removes indexes (idx_reviews_dorm_id,
--    idx_student_reviews_user_fkey), the rating CHECK constraints, the
--    student_reviews_user_id_fkey (ON DELETE SET NULL to profiles), and grants.
DROP TABLE IF EXISTS public.student_reviews CASCADE;
