-- Deep-review remediation, 2026-08-01.
--
-- 1. Claim marketplace moderation atomically before billable external calls.
-- 2. Collapse the weekly digest's per-admin count/ID-list queries into one
--    service-role-only aggregate, backed by the access patterns it uses.

-- ── Atomic marketplace moderation claim ────────────────────────────────────

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS moderation_started_at timestamptz;

-- A service-role Edge Function is the sole caller. The stale-before argument
-- makes a crashed worker recoverable while its claim timestamp fences a late
-- worker's final write in the function itself.
CREATE OR REPLACE FUNCTION public.claim_marketplace_listing_moderation(
  p_listing_id uuid,
  p_user_id uuid,
  p_stale_before timestamptz
)
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  category text,
  price numeric,
  image_urls text[],
  moderation_started_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.marketplace_listings AS ml
     SET moderation_started_at = now()
   WHERE ml.id = p_listing_id
     AND ml.user_id = p_user_id
     AND ml.status = 'pending_review'
     AND (ml.moderation_started_at IS NULL OR ml.moderation_started_at < p_stale_before)
  RETURNING
    ml.id,
    ml.title,
    ml.description,
    ml.category,
    ml.price,
    ml.image_urls,
    ml.moderation_started_at;
$$;

REVOKE ALL ON FUNCTION public.claim_marketplace_listing_moderation(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketplace_listing_moderation(uuid, uuid, timestamptz)
  TO service_role;

-- ── Weekly-digest aggregate + index support ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_profiles_university_created_at
  ON public.profiles (university_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_university_created_at
  ON public.marketplace_listings (university_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_open_reporter
  ON public.content_reports (reporter_id)
  WHERE escalated_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_weekly_digest_metrics(
  p_university_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  university_name text,
  new_signups bigint,
  new_listings bigint,
  open_reports bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.name,
    (SELECT count(*)
       FROM public.profiles p
      WHERE p.university_id = p_university_id
        AND p.created_at >= p_since),
    (SELECT count(*)
       FROM public.marketplace_listings ml
      WHERE ml.university_id = p_university_id
        AND ml.created_at >= p_since),
    (SELECT count(*)
       FROM public.content_reports cr
       JOIN public.profiles reporter ON reporter.id = cr.reporter_id
      WHERE reporter.university_id = p_university_id
        AND cr.escalated_at IS NULL)
  FROM public.universities u
  WHERE u.id = p_university_id;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_digest_metrics(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_digest_metrics(uuid, timestamptz)
  TO service_role;
