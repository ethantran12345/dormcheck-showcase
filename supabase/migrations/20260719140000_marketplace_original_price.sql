-- Price-drop display (Facebook-Marketplace style: "$0  $̶2̶5̶").
-- We remember the FIRST listed price so the feed/detail can strike through it
-- when the seller later drops the price. `original_price` is stamped once on
-- INSERT and is immutable thereafter - a trigger ignores any client attempt to
-- change it, so a later edit that lowers `price` reveals the drop, and one that
-- raises it simply shows no strikethrough (original stays the initial ask).

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS original_price numeric;

-- Backfill existing rows to their current price (no phantom "drop" on legacy listings).
UPDATE public.marketplace_listings
  SET original_price = price
  WHERE original_price IS NULL;

CREATE OR REPLACE FUNCTION public.marketplace_listings_maintain_original_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- First list price wins; if a client sends its own value, ignore it.
    NEW.original_price := NEW.price;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Immutable once set. COALESCE guards the pre-backfill/legacy edge.
    NEW.original_price := COALESCE(OLD.original_price, OLD.price, NEW.price);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_listings_original_price ON public.marketplace_listings;
CREATE TRIGGER trg_marketplace_listings_original_price
  BEFORE INSERT OR UPDATE ON public.marketplace_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_listings_maintain_original_price();

-- SEC-6: base-table SELECT is column-scoped. Make the new column readable from
-- the feed query (masked contact columns stay off this grant, unchanged).
GRANT SELECT (original_price) ON public.marketplace_listings TO authenticated;
