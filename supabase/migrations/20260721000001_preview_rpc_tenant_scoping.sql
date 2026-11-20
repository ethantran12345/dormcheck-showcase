-- Tenant-scope the public preview RPCs. Adds an optional p_university_id param:
-- NULL keeps today's unfiltered behavior (backward compatible with shipped iOS
-- bundles that call the RPC with no args); callers pass a university to silo the teaser.
-- The zero-arg originals MUST be dropped first — a defaulted 1-arg overload alongside
-- the 0-arg version makes no-arg rpc() calls ambiguous in PostgREST.
-- Rollback: docs/audits/tenant-isolation-rollback.md §2.

DROP FUNCTION IF EXISTS public.get_marketplace_preview();
DROP FUNCTION IF EXISTS public.get_setups_preview();

CREATE OR REPLACE FUNCTION public.get_marketplace_preview(p_university_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count',
    (
      SELECT count(*)::bigint
      FROM public.marketplace_listings ml
      WHERE ml.status = 'available'
        AND (p_university_id IS NULL OR ml.university_id = p_university_id)
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
            AND (p_university_id IS NULL OR ml.university_id = p_university_id)
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
$function$;

COMMENT ON FUNCTION public.get_marketplace_preview(uuid) IS
'Public teaser: count + up to 6 recent available marketplace_listings (non-contact columns only). p_university_id NULL = unfiltered (legacy clients); pass a university UUID to tenant-scope. SECURITY DEFINER so anon can read.';

CREATE OR REPLACE FUNCTION public.get_setups_preview(p_university_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_count',
    (
      SELECT count(*)::bigint FROM public.student_setups ss
      WHERE NOT ss.is_hidden
        AND (p_university_id IS NULL OR ss.university_id = p_university_id)
    ),
    'photo_urls',
    coalesce(
      (
        SELECT jsonb_agg(sub.image_url ORDER BY sub.created_at DESC)
        FROM (
          SELECT sp.image_url, sp.created_at
          FROM public.setup_photos sp
          JOIN public.student_setups ss ON ss.id = sp.setup_id
          WHERE NOT ss.is_hidden
            AND (p_university_id IS NULL OR ss.university_id = p_university_id)
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
$function$;

COMMENT ON FUNCTION public.get_setups_preview(uuid) IS
'Public teaser: count + up to 6 recent setup photos. p_university_id NULL = unfiltered (legacy clients); pass a university UUID to tenant-scope. SECURITY DEFINER so anon can read.';

GRANT EXECUTE ON FUNCTION public.get_marketplace_preview(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_setups_preview(uuid) TO anon, authenticated;
