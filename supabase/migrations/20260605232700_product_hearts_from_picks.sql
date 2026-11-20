-- Hearts become a derived count of explore_picks, not a mutable counter.

-- Index for the count lookups (PK leads with user_id, not useful for name counts)
CREATE INDEX IF NOT EXISTS idx_explore_picks_product_name
  ON public.explore_picks (product_name);

-- 1. Reconcile existing inflated counts to the true distinct-saver count
UPDATE public.amazon_products p
SET hearts = COALESCE((
  SELECT count(*) FROM public.explore_picks ep
  WHERE ep.product_name = p.name
), 0);

-- 2. Recompute hearts for the affected product whenever a pick is added/removed
CREATE OR REPLACE FUNCTION public.sync_product_hearts_from_picks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected_name text;
BEGIN
  affected_name := COALESCE(NEW.product_name, OLD.product_name);
  UPDATE public.amazon_products
  SET hearts = (
    SELECT count(*) FROM public.explore_picks
    WHERE product_name = affected_name
  )
  WHERE name = affected_name;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_product_hearts_from_picks()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_product_hearts ON public.explore_picks;
CREATE TRIGGER trg_sync_product_hearts
AFTER INSERT OR DELETE ON public.explore_picks
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_hearts_from_picks();

-- 3. Neutralize the manual counters. Signatures kept so deployed clients calling
--    them succeed (no error, no rollback) instead of double-counting the trigger.
CREATE OR REPLACE FUNCTION public.increment_product_hearts(product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- no-op: hearts are maintained by trg_sync_product_hearts on explore_picks
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_product_hearts(product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- no-op: hearts are maintained by trg_sync_product_hearts on explore_picks
  RETURN;
END;
$$;
