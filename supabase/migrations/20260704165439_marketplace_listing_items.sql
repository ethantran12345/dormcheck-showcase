-- Multi-item photo listings: one listing photo (set), many tagged sellable items.
-- Product decision (2026-07-04): a seller can tag multiple items on a setup photo
-- (borrowing the student-setups "shop this room" pattern), each with its own name
-- and price, and mark items sold INDIVIDUALLY. The parent marketplace_listings row
-- stays the feed card: its price is maintained client-side as the minimum available
-- item price ("From $X") and its status flips to 'sold' only when every item is
-- sold (client/hook logic in src/hooks/useMyListings.ts - no status trigger here,
-- so guard_listing_status_change ordering stays simple).
--
-- x/y are 0-1 normalized coordinates on the photo at photo_index (nullable: an
-- item may be listed without a tag position). No contact columns live on this
-- table, so the SEC-6 contact-masking model on the parent is unaffected and a
-- PostgREST embed from marketplace_listings is safe.
--
-- Idempotent where practical (IF EXISTS / OR REPLACE) so it runs cleanly on the
-- local Docker stack and prod.

-- a. Table
CREATE TABLE IF NOT EXISTS public.marketplace_listing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  price numeric NOT NULL CHECK (price >= 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')),
  x numeric CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  y numeric CHECK (y IS NULL OR (y >= 0 AND y <= 1)),
  photo_index integer NOT NULL DEFAULT 0 CHECK (photo_index >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  -- A tag position is both coordinates or neither.
  CONSTRAINT marketplace_listing_items_xy_pair CHECK ((x IS NULL) = (y IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listing_items_listing
  ON public.marketplace_listing_items (listing_id);

ALTER TABLE public.marketplace_listing_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketplace_listing_items FROM public, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listing_items TO authenticated;
GRANT ALL ON public.marketplace_listing_items TO service_role;

-- b. RLS policies. SELECT rides on parent visibility: the EXISTS subquery runs
--    as the caller, so parent RLS applies and items of listings the caller can't
--    see stay hidden. Writes are listing-owner only.
DROP POLICY IF EXISTS rls_marketplace_listing_items_select ON public.marketplace_listing_items;
CREATE POLICY rls_marketplace_listing_items_select ON public.marketplace_listing_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id
    )
  );

DROP POLICY IF EXISTS rls_marketplace_listing_items_insert ON public.marketplace_listing_items;
CREATE POLICY rls_marketplace_listing_items_insert ON public.marketplace_listing_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS rls_marketplace_listing_items_update ON public.marketplace_listing_items;
CREATE POLICY rls_marketplace_listing_items_update ON public.marketplace_listing_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS rls_marketplace_listing_items_delete ON public.marketplace_listing_items;
CREATE POLICY rls_marketplace_listing_items_delete ON public.marketplace_listing_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.user_id = (SELECT auth.uid())
    )
  );

-- c. Prohibited-content guard on item names (DB backstop; the client check in
--    src/lib/prohibitedContent.ts is only the friendly first pass).
--    Keep the prohibited pattern here in sync with src/lib/prohibitedContent.ts
--    and public.reject_prohibited_listing().
CREATE OR REPLACE FUNCTION public.reject_prohibited_listing_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(NEW.name, '') ~*
     '\m(guns?|firearms?|pistols?|handguns?|rifles?|shotguns?|ammo|ammunition|silencers?|cocaine|heroin|meth|methamphetamine|fentanyl|lsd|mdma|ecstasy|ketamine|shrooms|psilocybin|adderall|xanax|percocet|oxycodone|oxycontin|escorts?|nudes|onlyfans)\M'
  THEN
    RAISE EXCEPTION 'This item mentions a prohibited item or content and cannot be posted.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_prohibited_listing_item ON public.marketplace_listing_items;
CREATE TRIGGER trg_reject_prohibited_listing_item
  BEFORE INSERT OR UPDATE OF name ON public.marketplace_listing_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_prohibited_listing_item();

-- d. Cap items per listing (keep in sync with MAX_LISTING_ITEMS in
--    src/lib/listingItems.ts).
CREATE OR REPLACE FUNCTION public.check_max_listing_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  item_count int;
  max_items constant int := 20;
BEGIN
  SELECT count(*) INTO item_count
  FROM public.marketplace_listing_items
  WHERE listing_id = NEW.listing_id;

  IF item_count >= max_items THEN
    RAISE EXCEPTION 'A listing can have at most % items.', max_items
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_max_listing_items ON public.marketplace_listing_items;
CREATE TRIGGER trg_check_max_listing_items
  BEFORE INSERT ON public.marketplace_listing_items
  FOR EACH ROW EXECUTE FUNCTION public.check_max_listing_items();
