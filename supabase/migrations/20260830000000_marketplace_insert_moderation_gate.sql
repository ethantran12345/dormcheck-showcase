-- P0-1 (security review 2026-08-01): the pre-moderation hold was client
-- convention only. rls_marketplace_listings_insert checks auth.uid() = user_id
-- and nothing else, and guard_listing_status_change() fires only on UPDATE out
-- of under_review/pending_review — so a direct PostgREST INSERT with
-- status='available' went live without the omni-moderation scan ever running.
--
-- This trigger makes the DB the boundary: any INSERT not made by service_role
-- or an admin lands in 'pending_review' with every moderation_* column nulled,
-- and an attempt to self-assign a moderation_decision is rejected outright.
-- The normal client flow already inserts status='pending_review'
-- (src/hooks/useMyListings.ts) and the moderate-listing edge function flips it
-- via service_role, so both legit paths are unaffected.

CREATE OR REPLACE FUNCTION public.force_insert_pre_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only end-user requests are gated. service_role (moderate-listing edge fn),
  -- postgres (seeds/tests, where auth.role() is NULL) and admins keep full
  -- control — the same exemption shape as guard_listing_status_change.
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND is_admin = true
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.moderation_decision IS NOT NULL THEN
    RAISE EXCEPTION 'moderation_decision cannot be set at insert.'
      USING errcode = 'check_violation';
  END IF;

  -- Force the pre-scan hold regardless of what the caller claimed.
  NEW.status := 'pending_review';
  NEW.moderation_reason := NULL;
  NEW.moderation_categories := NULL;
  NEW.moderated_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.force_insert_pre_moderation() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_force_insert_pre_moderation ON public.marketplace_listings;
CREATE TRIGGER trg_force_insert_pre_moderation
  BEFORE INSERT ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.force_insert_pre_moderation();
