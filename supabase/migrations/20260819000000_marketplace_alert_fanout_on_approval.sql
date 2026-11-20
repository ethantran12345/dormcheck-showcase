-- Fix: pre-moderation broke marketplace saved-search alerts. New listings now
-- INSERT as 'pending_review' (the AFTER INSERT fan-out correctly skips) and are
-- later flipped to 'available' by an UPDATE, which had no alert trigger -> zero
-- alerts ever fired. This adds an AFTER UPDATE fan-out on the FIRST transition
-- into 'available' out of the moderation pipeline, keeping the AFTER INSERT path
-- for any flow that still inserts directly as available. Expand-only.
--
-- Applied to prod via MCP apply_migration (name: marketplace_alert_fanout_on_approval).

CREATE OR REPLACE FUNCTION public.notify_marketplace_alert_matches()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Gate 1: only a publicly available, non-sublease listing alerts.
  IF NEW.status <> 'available' OR NEW.is_sublease THEN
    RETURN NEW;
  END IF;

  -- Gate 2 (UPDATE only): fire EXACTLY ONCE, on the first transition into
  -- 'available' out of the pre-publish moderation pipeline:
  --   * pending_review -> available            (auto-approved)
  --   * under_review(held|rejected) -> available (admin approved an auto-HELD
  --     listing from the Auto-held queue -> first time it is available)
  -- Do NOT fire for a relist (sold -> available) or an admin un-hiding a
  -- REPORT-hidden listing (under_review with NULL moderation_decision = it was
  -- already available and already alerted), so an existing listing is never
  -- re-notified. moderation_decision in ('held','rejected') can only be set by
  -- the auto-moderator, which uniquely identifies an auto-held listing.
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
         OLD.status = 'pending_review'
      OR (OLD.status = 'under_review'
          AND OLD.moderation_decision IN ('held', 'rejected'))
    ) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- INSERT with status='available' still fans out: the legacy direct-publish
  -- path, so flows that skip pre-moderation do not regress.

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
    AND a.university_id IS NOT DISTINCT FROM NEW.university_id
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
  ORDER BY a.user_id, a.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An alert fan-out failure must never block a listing post/approval.
  RAISE WARNING 'notify_marketplace_alert_matches failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

-- New: fan out when a listing FIRST becomes available via an UPDATE (the
-- pre-moderation approval path). The WHEN clause limits firing to real
-- transitions into 'available'; the function body applies the once-only gate.
DROP TRIGGER IF EXISTS trg_notify_marketplace_alert_matches_on_update ON public.marketplace_listings;
CREATE TRIGGER trg_notify_marketplace_alert_matches_on_update
  AFTER UPDATE OF status ON public.marketplace_listings
  FOR EACH ROW
  WHEN (NEW.status = 'available' AND OLD.status IS DISTINCT FROM 'available')
  EXECUTE FUNCTION public.notify_marketplace_alert_matches();

-- The existing AFTER INSERT trigger (trg_notify_marketplace_alert_matches) is
-- unchanged and still covers any direct insert-as-available flow.
