-- Moderation on EDIT (handoff-uploads-marketplace-verification-2026-10-11, Phase B).
--
-- The insert path is gated server-side: force_insert_pre_moderation()
-- (20260830000000) lands every end-user INSERT as 'pending_review', and
-- moderate-listing screens the title, category, description and every photo
-- before the listing can surface. The UPDATE path was not: an owner could post a
-- clean listing, wait for approval, then PATCH a new photo or new text onto the
-- live row (the edit form does exactly this; so does a direct PostgREST call).
-- protect_listing_moderation_state() kept the 'approved' verdict, the status
-- stayed 'available', and claim_marketplace_listing_moderation() only claims
-- 'pending_review' rows, so nothing ever re-screened it. Verified on the local
-- stack 2026-10-11: after the edit the row read available/approved with the
-- unscreened photo in image_urls, and the client never invoked moderate-listing.
--
-- This migration makes the DB the boundary for edits, as 20260830000000 did for
-- inserts. Additive only (one new function + trigger, one function body
-- re-created with a dedupe clause); no data is rewritten.
--
-- 1. rescreen_listing_on_edit(): when an end user (not service_role, not an
--    admin, not a postgres/seed context: the same exemption shape as
--    force_insert_pre_moderation and protect_listing_moderation_state) changes a
--    SCREENED field (title, description, category, image_urls: exactly what
--    moderate-listing sends to the screen), then by the listing's status:
--      available | open   -> back to 'pending_review', verdict cleared, so the
--                            feed hides it and moderate-listing can claim it.
--                            The approve path maps back to available|open, so
--                            nothing about the lifecycle is lost.
--      pending_review     -> moderation_started_at cleared: a worker that already
--                            claimed the OLD content loses its compare-and-set
--                            (moderate-listing writes WHERE moderation_started_at
--                            = its claim), so a verdict for the old text/photos
--                            can never be stamped onto the new ones.
--      under_review       -> unchanged: already hidden and in the human queue,
--                            which reviews the row as it is when they act.
--      anything else      -> refused (pending | sold | expired | claimed |
--                            completed). moderate-listing's approve maps only to
--                            available|open, so re-screening one of these would
--                            silently un-sell it; relisting first (a status-only
--                            write, allowed) and then editing is the safe order.
--    Text is compared after btrim/NULLIF so an edit that re-saves '' over NULL
--    (or the same words) does not knock a listing back into review.
--
--    Trigger name sorts AFTER protect_listing_moderation_state (BEFORE triggers
--    fire alphabetically), so its restore-from-OLD of the moderation_* columns
--    runs first and the clear here is the value that lands.
--
-- 2. notify_marketplace_alert_matches(): re-approval after an edit is a second
--    pending_review -> available transition, and the fan-out had no per-listing
--    dedupe, so every matching alert subscriber was notified again on every edit
--    (measured locally: 1 notification on approval, 2 after one re-approval).
--    Re-created VERBATIM from 20260901000005 plus one NOT EXISTS clause: a
--    recipient already notified about this listing is not notified again.

CREATE OR REPLACE FUNCTION public.rescreen_listing_on_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR EXISTS (
       SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND is_admin = true
     ) THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(NEW.title), '')       IS NOT DISTINCT FROM NULLIF(btrim(OLD.title), '')
     AND NULLIF(btrim(NEW.description), '') IS NOT DISTINCT FROM NULLIF(btrim(OLD.description), '')
     AND NULLIF(btrim(NEW.category), '')    IS NOT DISTINCT FROM NULLIF(btrim(OLD.category), '')
     AND coalesce(NEW.image_urls, '{}')    IS NOT DISTINCT FROM coalesce(OLD.image_urls, '{}') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('available', 'open') THEN
    NEW.status                := 'pending_review';
    NEW.moderation_decision   := NULL;
    NEW.moderation_reason     := NULL;
    NEW.moderation_categories := NULL;
    NEW.moderated_at          := NULL;
    NEW.moderation_started_at := NULL;
  ELSIF OLD.status = 'pending_review' THEN
    NEW.moderation_started_at := NULL;
  ELSIF OLD.status = 'under_review' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Relist this listing before changing its photos, title, description or category.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rescreen_listing_on_edit() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rescreen_listing_on_edit ON public.marketplace_listings;
CREATE TRIGGER trg_rescreen_listing_on_edit
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.rescreen_listing_on_edit();

COMMENT ON FUNCTION public.rescreen_listing_on_edit() IS
  'An end-user edit to a screened field (title/description/category/image_urls) sends a live listing back to pending_review for moderate-listing; refuses it on lifecycle states approve cannot restore. 20261011000000.';

CREATE OR REPLACE FUNCTION public.notify_marketplace_alert_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'available' OR NEW.is_sublease THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
         OLD.status = 'pending_review'
      OR (OLD.status = 'under_review'
          AND OLD.moderation_decision IN ('held', 'rejected'))
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A listing with no university fans out to nobody.
  IF NEW.university_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, type, payload, university_id)
  SELECT DISTINCT ON (a.user_id)
    a.user_id,
    'marketplace_alert',
    jsonb_build_object(
      'listing_id', NEW.id,
      'title',      NEW.title,
      'price',      NEW.price,
      'category',   NEW.category,
      'image_url',  CASE WHEN coalesce(array_length(NEW.image_urls, 1), 0) >= 1
                         THEN NEW.image_urls[1] END,
      'alert_id',   a.id,
      'alert_name', a.name
    ),
    a.university_id
  FROM public.marketplace_alerts a
  WHERE a.enabled
    AND a.user_id <> NEW.user_id
    -- Plain equality: NULL on either side now yields NULL (not a match),
    -- instead of IS NOT DISTINCT FROM's NULL = NULL cross-tenant match.
    AND a.university_id = NEW.university_id
    AND (cardinality(a.categories) = 0 OR NEW.category = ANY (a.categories))
    AND (a.min_price IS NULL OR NEW.price >= a.min_price)
    AND (a.max_price IS NULL OR NEW.price <= a.max_price)
    AND (
      a.keywords IS NULL OR btrim(a.keywords) = ''
      OR NOT EXISTS (
        SELECT 1
        FROM regexp_split_to_table(lower(btrim(a.keywords)), '\s+') AS w
        WHERE position(w IN lower(coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''))) = 0
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = a.user_id AND b.blocked_id = NEW.user_id)
         OR (b.blocker_id = NEW.user_id AND b.blocked_id = a.user_id)
    )
    -- 20261011000000: one alert per recipient per listing. A re-approval after
    -- an edit (rescreen_listing_on_edit) must not notify the same people again.
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = a.user_id
        AND n.type = 'marketplace_alert'
        AND n.payload->>'listing_id' = NEW.id::text
    )
  ORDER BY a.user_id, a.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_marketplace_alert_matches failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
