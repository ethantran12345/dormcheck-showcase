-- Security queue group 2 phase C.2: capped sublease preview RPC for logged-out teasers.
-- Additive only. Base table policies unchanged until phase D.

CREATE OR REPLACE FUNCTION public.get_subleases_preview(p_building_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_building text;
BEGIN
  v_building := nullif(trim(p_building_name), '');

  SELECT jsonb_build_object(
    'total_count',
    (
      SELECT count(*)::bigint
      FROM public.marketplace_listings ml
      WHERE ml.status = 'available'
        AND ml.is_sublease IS TRUE
        AND (v_building IS NULL OR ml.building_name = v_building)
    ),
    'subleases',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', sub.id,
            'title', sub.title,
            'price', sub.price,
            'sublease_start', sub.sublease_start,
            'sublease_end', sub.sublease_end,
            'building_name', sub.building_name,
            'neighborhood', sub.neighborhood,
            'image_url', sub.image_url
          )
          ORDER BY sub.created_at DESC
        )
        FROM (
          SELECT
            ml.id,
            ml.title,
            ml.price,
            ml.sublease_start,
            ml.sublease_end,
            ml.building_name,
            NULL::text AS neighborhood,
            coalesce(ml.image_url, ml.image_urls[1]) AS image_url,
            ml.created_at
          FROM public.marketplace_listings ml
          WHERE ml.status = 'available'
            AND ml.is_sublease IS TRUE
            AND (v_building IS NULL OR ml.building_name = v_building)
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

COMMENT ON FUNCTION public.get_subleases_preview(text) IS
'Public teaser: total count of active subleases plus up to 6 most recent rows
(id, title, price, sublease_start, sublease_end, building_name, neighborhood, image_url only).
Optional p_building_name filters by building_name. No user_id, contact, description, or coordinates.';

REVOKE EXECUTE ON FUNCTION public.get_subleases_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_subleases_preview(text) TO anon, authenticated;
