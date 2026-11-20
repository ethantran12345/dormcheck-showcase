-- P1.11 listing freshness / auto-expiry. Expand-only.
-- Stale listings quietly rot the marketplace's "everything here is real"
-- promise. Model: last_confirmed_at tracks the seller's latest signal of
-- life; a daily cron nudges at 21 days ("still available?") and expires at
-- 35 days (status 'expired' - the feed already filters to 'available', so
-- expired rows vanish for buyers; the seller relists in one tap, which
-- re-confirms).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260713010000.

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS freshness_nudged_at timestamptz;

-- Existing rows: seed from created_at so nothing expires on day one en masse.
UPDATE public.marketplace_listings SET last_confirmed_at = created_at
WHERE last_confirmed_at > created_at;

-- Widen the status CHECK with 'expired'.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status = ANY (ARRAY['available'::text, 'sold'::text, 'under_review'::text, 'expired'::text]));

-- Any transition back to 'available' (relist, restore) is a confirmation.
CREATE OR REPLACE FUNCTION public.touch_listing_confirmed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'available' AND OLD.status IS DISTINCT FROM 'available' THEN
    NEW.last_confirmed_at := now();
    NEW.freshness_nudged_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_listing_confirmed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_touch_listing_confirmed ON public.marketplace_listings;
CREATE TRIGGER trg_touch_listing_confirmed
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.touch_listing_confirmed();

-- Grant the new columns into the buyer-readable list (SEC-6 model).
GRANT SELECT (last_confirmed_at) ON public.marketplace_listings TO authenticated;

-- In-app "still available?" notification type.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'roommate_invite_accepted', 'building_new_residents',
    'admin_announcement', 'report_resolution', 'listing_freshness'
  ));
