-- Scope the three cross-school admin policies on listing_verifications to SUPERADMIN.
--
-- THE HAZARD, measured on the local stack before this migration: a Pitt
-- `university_admin` reads AND approves a CMU student's attested address and lease
-- documents, and a CMU admin does the same to Pitt students. The marketplace group
-- 'pittsburgh' has exactly two members, so every direction of it is live.
--
-- NOBODY DECIDED THIS — it was inherited. 20260918000000 widened marketplace_listings
-- for the shared marketplace, and listing_verifications delegates its outsider denial to
-- that parent (`tenant_isolation` scopes through the listing's school). So a decision
-- about LISTINGS silently became a decision about LEASE DOCUMENTS. That delegation is the
-- LV-1 class counted in 20260923010000's audit and pinned there as current behaviour;
-- this is the fix it was pinned for.
--
-- WHY SUPERADMIN AND NOT SCOPED-TO-OWN-UNIVERSITY (Ethan, 2026-08-16): e80b03f4
-- (2026-07-21) retired the Verifications UI for EVERYONE — it deleted
-- ListingVerificationsPage.tsx, the /admin/verifications route, the nav entry and the
-- student-side VerifyListingDialog, on the stated grounds that "moderation lives entirely
-- on DormCheck's superadmin side." The only surviving client reference is the buyer-side
-- VerifiedListingBadge, which reads listings and not verifications. So the database has
-- been granting read+approve on lease documents for a product surface that does not
-- exist. Scoping to own-university would preserve a capability with nothing behind it.
-- This change therefore has ZERO product impact.
--
-- WHY NOT JOIN BACK TO marketplace_listings to add a tenant predicate: joining to the
-- parent is the exact delegation being fixed. A second delegated predicate would inherit
-- the next widening of the parent the same way this one did.
--
-- `is_superadmin()` is defined at 20260709015840:31, SECURITY DEFINER STABLE, revoked
-- from public+anon and granted to authenticated at :48-49. No new grant is needed here.
-- Wrapped in a scalar subquery so it is an InitPlan evaluated once per statement rather
-- than per row, matching how the rest of this repo writes helper calls in RLS.
--
-- OWNER BRANCHES ARE UNTOUCHED. A student still reads their own verification row and
-- their own objects; only the admin branch changes. Expand-only: three DROP/CREATE pairs,
-- no table, column, grant, or data change.

-- 1. Admin READ of the verification row (name, attested address, evidence_path).
DROP POLICY IF EXISTS lv_select_admin ON public.listing_verifications;
CREATE POLICY lv_select_admin ON public.listing_verifications
  FOR SELECT TO authenticated
  USING ((SELECT public.is_superadmin()));

-- 2. Admin REVIEW (status/reviewed_by/reviewed_at/note).
--
-- This also closes the only SECURITY DEFINER path out of the table:
-- trg_sync_listing_verified_flag is AFTER UPDATE OF status, so it cannot run unless an
-- UPDATE has already passed this policy. Scoping the UPDATE scopes the trigger with it —
-- there is no separate entry point to the definer function.
DROP POLICY IF EXISTS lv_update_admin ON public.listing_verifications;
CREATE POLICY lv_update_admin ON public.listing_verifications
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_superadmin()));

-- 3. The actual lease PDFs. NOT OPTIONAL, and the widest of the three: this gated the
-- private `listing-verifications` bucket on bare is_admin with NO tenant predicate at
-- all, and it is the ONLY SELECT policy on that bucket. Fixing the two table policies
-- alone would have left security-by-obscurity over the documents themselves, and the
-- obscurity is thin — (storage.foldername(name))[1] IS the student's UUID, which is not
-- a secret. An admin needs a user id and a filename, not evidence_path.
DROP POLICY IF EXISTS lv_storage_select_own_or_admin ON storage.objects;
CREATE POLICY lv_storage_select_own_or_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'listing-verifications'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR (SELECT public.is_superadmin())
    )
  );
