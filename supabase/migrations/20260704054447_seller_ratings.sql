-- Seller ratings: 1-5 stars + optional comment, one rating per (rater, seller) pair.
-- Product decision (2026-07-04): marketplace trust surface modeled on Facebook
-- Marketplace seller ratings, gated on real interaction - only a user with an
-- ACCEPTED DM conversation with the seller may rate them (a pending request only
-- carries the initiator's single seeded message, which is not an interaction).
-- Aggregates are computed by the seller_rating_stats view (campus-scale read is
-- cheap; no denormalized profile columns, so the VRSA-slimmed public_profiles
-- view is untouched). Blocked pairs cannot submit NEW ratings; existing ratings
-- persist, matching how blocks hide-but-keep history elsewhere.
--
-- Idempotent where practical (IF EXISTS / OR REPLACE) so it runs cleanly on the
-- local Docker stack and prod.

-- a. Table
CREATE TABLE IF NOT EXISTS public.seller_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Context only (which listing prompted the rating); not part of uniqueness.
  listing_id uuid REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 750),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT seller_ratings_one_per_pair UNIQUE (rater_id, seller_id),
  CONSTRAINT seller_ratings_no_self CHECK (rater_id <> seller_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_ratings_seller ON public.seller_ratings (seller_id);

ALTER TABLE public.seller_ratings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_ratings FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seller_ratings TO authenticated;
GRANT ALL ON public.seller_ratings TO service_role;

-- b. updated_at touch trigger (per-table trigger fn, repo idiom)
CREATE OR REPLACE FUNCTION public.seller_ratings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seller_ratings_set_updated_at() FROM public, anon, authenticated;

CREATE OR REPLACE TRIGGER tr_seller_ratings_updated_at
  BEFORE UPDATE ON public.seller_ratings
  FOR EACH ROW EXECUTE FUNCTION public.seller_ratings_set_updated_at();

-- c. Interaction gate helper. SECURITY DEFINER because conversations RLS is
--    participant-only, so a plain subquery inside a seller_ratings policy would
--    see no rows. Leaks only a boolean about conversation existence to a caller
--    who already knows both uuids. Accepted threads only (see header).
CREATE OR REPLACE FUNCTION public.has_accepted_conversation_between(u1 uuid, u2 uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.status = 'accepted'
      AND ((c.participant_1 = u1 AND c.participant_2 = u2)
        OR (c.participant_1 = u2 AND c.participant_2 = u1))
  );
$$;
REVOKE ALL ON FUNCTION public.has_accepted_conversation_between(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.has_accepted_conversation_between(uuid, uuid) TO authenticated;

-- d. RLS policies
DROP POLICY IF EXISTS rls_seller_ratings_select ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_select ON public.seller_ratings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS rls_seller_ratings_insert ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_insert ON public.seller_ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = rater_id
    AND public.has_accepted_conversation_between(rater_id, seller_id)
    AND NOT public.is_blocked_between(rater_id, seller_id)
  );

DROP POLICY IF EXISTS rls_seller_ratings_update ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_update ON public.seller_ratings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = rater_id)
  WITH CHECK ((SELECT auth.uid()) = rater_id);

DROP POLICY IF EXISTS rls_seller_ratings_delete ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_delete ON public.seller_ratings
  FOR DELETE TO authenticated
  USING (
    (SELECT auth.uid()) = rater_id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true)
  );

-- e. Aggregate stats view (security_invoker: rows readable because seller_ratings
--    SELECT is authenticated-wide).
CREATE OR REPLACE VIEW public.seller_rating_stats
WITH (security_invoker = true) AS
  SELECT
    seller_id,
    ROUND(AVG(stars)::numeric, 1) AS avg_stars,
    COUNT(*)::integer AS rating_count
  FROM public.seller_ratings
  GROUP BY seller_id;

REVOKE ALL ON public.seller_rating_stats FROM public, anon;
GRANT SELECT ON public.seller_rating_stats TO authenticated, service_role;

-- f. Make ratings reportable: add 'seller_rating' to the content_reports CHECK.
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (
    content_type = ANY (
      ARRAY[
        'marketplace_listing'::text,
        'roommate_post'::text,
        'building_chat_link'::text,
        'user'::text,
        'seller_rating'::text
      ]
    )
  );

-- g. Extend get_content_reports() with a seller_rating arm so reported ratings
--    surface in /admin/reports. Body otherwise identical to
--    20260701000000_teardown_student_reviews.sql; CREATE OR REPLACE preserves
--    owner and grants.
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
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
  ORDER BY cr.created_at DESC;
$$;
