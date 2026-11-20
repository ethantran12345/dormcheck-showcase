-- STAGED: apply to LOCAL Supabase first; apply to prod via MCP apply_migration
-- when the admin-console branch ships (expand-only, no data change).
--
-- Admin console moderation - let admins UPDATE marketplace listings.
--
-- rls_marketplace_listings_update was owner-only (auth.uid() = user_id), so
-- BOTH admin moderation status writes in ReportsPage were silent zero-row
-- no-ops (PostgREST reports success when RLS filters out every row):
--   * Approve/dismiss restoring an auto-hidden listing to 'available'
--     (pre-existing bug: dismissed listings stayed under_review forever)
--   * Hide soft-hiding a listing to 'under_review' (Reports Queue inbox)
--
-- Consolidate to a single own-or-admin UPDATE policy, mirroring the
-- rls_marketplace_listings_delete consolidation in
-- 20260630000000_vrsa_db_surface_hardening.sql. Owner self-unhide is still
-- blocked by the guard_listing_status_change() trigger
-- (20260624010000_security_pass_3_hardening.sql), which exempts admins.

-- The local baseline's status CHECK still reads ('available','sold'), so even
-- the auto_hide_reported_listing() trigger cannot set 'under_review' on a
-- local stack (23514). Prod may already carry the expanded check (squashed
-- baseline divergence) - drop+recreate is idempotent either way.
ALTER TABLE public.marketplace_listings
  DROP CONSTRAINT IF EXISTS marketplace_listings_status_check;
ALTER TABLE public.marketplace_listings
  ADD CONSTRAINT marketplace_listings_status_check
  CHECK (status = ANY (ARRAY['available'::text, 'sold'::text, 'under_review'::text]));

DROP POLICY IF EXISTS rls_marketplace_listings_update ON public.marketplace_listings;

CREATE POLICY rls_marketplace_listings_update
  ON public.marketplace_listings
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );
