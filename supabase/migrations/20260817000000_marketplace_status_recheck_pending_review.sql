-- Re-assert the marketplace_listings.status CHECK with the full value set,
-- INCLUDING 'pending_review'.
--
-- Ordering fix: 20260719150000_marketplace_pre_moderation added 'pending_review'
-- to the status CHECK, but 20260731030000_marketplace_status_pending (a later
-- timestamp, so it applies AFTER) drops and re-adds the constraint to allow
-- 'pending' and, in doing so, silently drops 'pending_review' again. Applied in
-- filename order (fresh `supabase start` / `db reset` / CI), the net result is a
-- CHECK without 'pending_review', which makes the pre-publish create path's
-- `INSERT ... status='pending_review'` fail with a check_violation.
--
-- This migration is dated after both, so it always runs last and lands the union
-- of every state. Expand-only (a strict superset of both prior CHECKs), so it is
-- safe to apply to prod after the pre_moderation migration.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status = ANY (ARRAY[
    'available'::text, 'pending'::text, 'sold'::text,
    'under_review'::text, 'expired'::text, 'pending_review'::text
  ]));
