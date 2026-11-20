-- Realtime load reduction: drop marketplace_listings from the supabase_realtime
-- publication.
--
-- Why: ~95% of DB query time was the Realtime WAL poll (realtime.list_changes),
-- which scans WAL for every published table. marketplace_listings was the most
-- expensive of the 12 published tables: its only client subscription
-- (MarketplaceTab.tsx) was an UNFILTERED table-wide INSERT/UPDATE/DELETE listener
-- whose sole action was queryClient.invalidateQueries(['marketplace_listings']).
-- That is a TanStack-Query refetch dressed up as live push. The seller's own
-- post/edit/delete already invalidates explicitly (instant for them); other
-- sellers' new listings surface on refetch-on-focus instead of live. A browse
-- feed does not need cross-user live push, so this table is pure WAL-poll waste.
--
-- Companion client change (same commit): MarketplaceTab.tsx drops the realtime
-- subscription and enables refetchOnWindowFocus on the listings query.
--
-- checklist_items is intentionally KEPT in the publication: it backs genuine
-- group collaboration (RoommateClaimBoard + shared group checklists), where a
-- roommate must see another's claim/check live. Dropping it would silently
-- break that. See docs/audits/realtime.md.
--
-- Reversible: to restore live push, re-add with
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_listings;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'marketplace_listings'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.marketplace_listings;
  END IF;
END;
$$;
