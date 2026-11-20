-- Security queue group 2 phase B: limited public preview RPCs (option 3).
-- Additive only. Base table policies unchanged until phase D.
-- SECURITY DEFINER + fixed search_path so these keep working after tables lock to authenticated.

-- ---------------------------------------------------------------------------
-- get_marketplace_preview()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_marketplace_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count',
    (
      SELECT count(*)::bigint
      FROM public.marketplace_listings ml
      WHERE ml.status = 'available'
    ),
    'listings',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', sub.id,
            'title', sub.title,
            'price', sub.price,
            'category', sub.category,
            'image_url', sub.image_url
          )
          ORDER BY sub.created_at DESC
        )
        FROM (
          SELECT
            ml.id,
            ml.title,
            ml.price,
            ml.category,
            coalesce(ml.image_url, ml.image_urls[1]) AS image_url,
            ml.created_at
          FROM public.marketplace_listings ml
          WHERE ml.status = 'available'
          ORDER BY ml.created_at DESC
          LIMIT 6
        ) sub
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_marketplace_preview() IS
'Public teaser: total count of available marketplace_listings plus up to 6 most recent
active listings (id, title, price, category, cover image_url only). No parameters.';

REVOKE EXECUTE ON FUNCTION public.get_marketplace_preview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_marketplace_preview() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_reviews_summary()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reviews_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count',
    (SELECT count(*)::bigint FROM public.student_reviews sr),
    'average_rating',
    (SELECT round(avg(sr.rating), 2) FROM public.student_reviews sr WHERE sr.rating IS NOT NULL),
    'by_dorm',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'dorm_id', agg.dorm_id,
            'review_count', agg.review_count,
            'average_rating', agg.average_rating
          )
          ORDER BY agg.dorm_id
        )
        FROM (
          SELECT
            sr.dorm_id,
            count(*)::bigint AS review_count,
            round(avg(sr.rating), 2) AS average_rating
          FROM public.student_reviews sr
          WHERE sr.rating IS NOT NULL
          GROUP BY sr.dorm_id
        ) agg
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_reviews_summary() IS
'Public teaser: overall student_reviews count and average rating, plus per-dorm aggregates
(dorm_id, review_count, average_rating). No review text or reviewer fields. No parameters.';

REVOKE EXECUTE ON FUNCTION public.get_reviews_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_reviews_summary() TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_setups_preview()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_setups_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count',
    (SELECT count(*)::bigint FROM public.student_setups ss),
    'photo_urls',
    coalesce(
      (
        SELECT jsonb_agg(sub.image_url ORDER BY sub.created_at DESC)
        FROM (
          SELECT sp.image_url, sp.created_at
          FROM public.setup_photos sp
          ORDER BY sp.created_at DESC
          LIMIT 6
        ) sub
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_setups_preview() IS
'Public teaser: total count of student_setups plus up to 6 most recent setup_photos
image_url values. No user_id or setup metadata. No parameters.';

REVOKE EXECUTE ON FUNCTION public.get_setups_preview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_setups_preview() TO anon, authenticated;
