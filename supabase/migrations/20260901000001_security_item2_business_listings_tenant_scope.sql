-- Item 2: tenant-scope approved business listings.
--
-- "Anyone can view approved listings" was TO public with no tenant predicate.
-- Authenticated users were already fenced by the RESTRICTIVE tenant_isolation
-- policy (TO authenticated), but anonymous requests bypass that policy entirely
-- and could read every school's approved listings. No public marketing surface
-- consumes this table (verified 2026-08-02: all consumers are authed app
-- surfaces), so approved listings become same-university, authenticated-only.
-- The tenant predicate is ANDed here directly (defense in depth, same rationale
-- as the Tier 1 "Owner can view own listings" rewrite) rather than relying on
-- tenant_isolation alone.

DROP POLICY IF EXISTS "Anyone can view approved listings" ON public.business_listings;
CREATE POLICY "Approved listings visible within university"
  ON public.business_listings
  FOR SELECT
  TO authenticated
  USING (
    is_approved = true
    AND is_active = true
    AND (
      university_id = public.current_university_id()
      OR public.is_superadmin()
    )
  );
