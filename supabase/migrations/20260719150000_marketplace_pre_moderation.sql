-- Pre-publish auto-moderation gate for the Student Market.
--
-- New listings are INSERTed as 'pending_review' (hidden from the feed - the feed
-- only shows available|pending). The `moderate-listing` edge function runs a
-- HYBRID pipeline (free OpenAI omni-moderation on text+images -> free heuristic
-- scam scan -> cheap Claude Haiku only on the flagged minority) and, via
-- service_role, either APPROVES the clean majority to 'available' within ~1-2s,
-- HOLDS a risky one at 'under_review', or flags a clear violation as 'rejected'
-- (also 'under_review', kept for admin confirmation - never hard-deleted here).
-- Result: bad listings never reach buyers, and the admin queue is mostly empty.
--
-- STAGED: apply to prod via MCP apply_migration; deploy `moderate-listing` and
-- set ANTHROPIC_API_KEY *before* shipping the client that inserts pending_review,
-- else new listings would stick hidden. Expand-only (no destructive change).

-- 1. Expand the status CHECK with the pre-scan hold state.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status = ANY (ARRAY[
    'available'::text, 'pending'::text, 'sold'::text,
    'under_review'::text, 'expired'::text, 'pending_review'::text
  ]));

-- 2. Verdict columns (owner sees "In review"/reason; admin triages held ones).
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS moderation_decision text
    CHECK (moderation_decision IS NULL
           OR moderation_decision = ANY (ARRAY['approved'::text, 'held'::text, 'rejected'::text])),
  ADD COLUMN IF NOT EXISTS moderation_reason text,
  ADD COLUMN IF NOT EXISTS moderation_categories text[],
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz;

-- SEC-6: base-table SELECT is column-scoped - grant the new columns explicitly.
GRANT SELECT (moderation_decision, moderation_reason, moderation_categories, moderated_at)
  ON public.marketplace_listings TO authenticated;

-- 3. Harden the status guard: an owner (non-admin, non-service_role) must not
--    self-transition OUT of the pre-scan hold, exactly as they can't leave
--    'under_review'. Otherwise a crafted client could insert 'pending_review'
--    then UPDATE -> 'available', skipping the scan entirely.
CREATE OR REPLACE FUNCTION public.guard_listing_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('under_review', 'pending_review')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND is_admin = true
     ) THEN
    RAISE EXCEPTION 'This listing is under review and its status cannot be changed.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Admin surface for the Reports Queue "Auto-held" tab: the small set of
--    listings the auto-moderator could not clear. SECURITY DEFINER; admin-only;
--    university-clamped for non-superadmins (superadmin may filter by param).
CREATE OR REPLACE FUNCTION public.admin_list_held_listings(p_university_id uuid DEFAULT NULL)
RETURNS TABLE (
  listing_id uuid,
  title text,
  price numeric,
  image_urls text[],
  owner_id uuid,
  owner_name text,
  moderation_decision text,
  moderation_reason text,
  moderation_categories text[],
  moderated_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_is_admin boolean;
  v_university uuid;
BEGIN
  SELECT p.role, p.is_admin, p.university_id
    INTO v_role, v_is_admin, v_university
    FROM public.profiles p
   WHERE p.id = auth.uid();

  IF NOT (v_role IN ('superadmin', 'university_admin') OR v_is_admin) THEN
    RAISE EXCEPTION 'Forbidden' USING errcode = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT ml.id, ml.title, ml.price, ml.image_urls, ml.user_id,
         pr.full_name, ml.moderation_decision, ml.moderation_reason,
         ml.moderation_categories, ml.moderated_at, ml.created_at
    FROM public.marketplace_listings ml
    LEFT JOIN public.profiles pr ON pr.id = ml.user_id
   WHERE ml.status = 'under_review'
     AND ml.moderation_decision = ANY (ARRAY['held'::text, 'rejected'::text])
     AND (
       (v_role = 'superadmin' AND (p_university_id IS NULL OR ml.university_id = p_university_id))
       OR (v_role IS DISTINCT FROM 'superadmin' AND ml.university_id = v_university)
     )
   ORDER BY ml.moderated_at DESC NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_held_listings(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_held_listings(uuid) TO authenticated;
