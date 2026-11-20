-- Retire the derived `profiles.is_admin` column as an RLS predicate (BA-01 + BA-02,
-- docs/audits/backend-audit-2026-09-06.md).
--
-- THE COLLAPSE. `profiles.is_admin` is not a fact anybody sets; sync_is_admin_from_role()
-- derives it as `role <> 'user'` (20260709015840). Every policy below was written when
-- "admin" meant the platform owner, so each one now admits every delegated
-- `university_admin` as if they were a superadmin. Counted live on prod 2026-09-06:
-- 23 policies key on `profiles.is_admin = true` (20 in public, 3 on storage.objects).
--
-- Nine of them have NOTHING bounding a delegated admin to their own school — the two
-- global Amazon catalog tables and the `dorm-photos` bucket have no university_id and no
-- RESTRICTIVE policy — so a Carlow university_admin could delete the Shop Essentials
-- catalog or Pitt's dorm photos. The other fourteen are bounded today only by a separate
-- RESTRICTIVE `tenant_isolation` policy; a delegated admin can still delete or edit any
-- OTHER STUDENT's listing, setup, rating or chat link at their own school, which the
-- 2026-07-09 delegation decision ("admins invite freely, scoped") never granted and the
-- 2026-07-21 decision (moderation and reports stay on DormCheck's superadmin side)
-- explicitly withholds.
--
-- DECISION (Ethan, 2026-09-06): university_admin loses raw is_admin write/delete on other
-- users' content. Implemented as TWO shapes, and the split is deliberate:
--
--   (a) SUPERADMIN-ONLY — 17 policies. Global catalogs (amazon_products,
--       amazon_product_variations), other students' content (marketplace_listings UPDATE/
--       DELETE admin branch, roommate_search_posts DELETE, seller_ratings DELETE,
--       student_setups UPDATE, building_chat_links UPDATE/DELETE admin branch), the
--       building-chat report queue (building_chat_link_reports SELECT/DELETE) and the
--       business_listings admin SELECT/UPDATE. The `is_admin` subselect becomes
--       `public.is_superadmin()`; owner branches are untouched.
--
--   (b) TENANT-SCOPED ADMIN — 6 policies. master_housing UPDATE, dorm_edits INSERT/SELECT
--       and the three dorm-photos storage policies. These are NOT other users' content:
--       they are the school's own dorm catalog, and src/routes/AdminRoutes.tsx routes
--       /admin/dorms and /admin/dorms/:id (DormEditPage + PhotoUpload) under RequireAdmin,
--       not RequireSuperAdmin — a university_admin edits their school's dorms in the
--       console today. Making these superadmin-only would silently break that shipped
--       surface. They become `is_superadmin() OR (current_app_role() = 'university_admin'
--       AND <row belongs to current_university_id()>)`, so the tenant bound now lives in
--       the permissive policy itself instead of only in the RESTRICTIVE sibling
--       (08-02 audit item #16, "works, but fragile"). Photo objects are scoped through
--       their path: PhotoUpload writes `${dormId}/${field}/${file}`, so the first folder
--       segment resolves to master_housing.id.
--
-- NOT TOUCHED: the four university_resources policies use `current_app_role() = ANY
-- (university_admin, superadmin)` — an explicit role model, not the derived column — and
-- that table is already dropped locally by 20260820030000 (still pending in prod). The
-- `is_admin` column, its sync trigger and protect_profile_is_admin() stay; nothing reads
-- the column for authorization any more, which the DO block at the end pins.
--
-- ROLES tightened to `authenticated` where a policy was `TO public`: an admin is always
-- authenticated, and this stops anon from even evaluating an admin predicate.
--
-- Forward-only, expand/contract-free: DROP POLICY IF EXISTS + CREATE POLICY per policy,
-- names preserved so docs/security/rls-*.md and the registry still resolve. Probe:
-- supabase/tests/is_admin_tier_collapse.test.sql (red before this file, green after).
-- is_superadmin(), current_app_role() and current_university_id() are SECURITY DEFINER
-- STABLE and already granted to authenticated (20260709015840, 20260709015944).

BEGIN;

-- ───────────────────────── (a) superadmin-only ─────────────────────────

-- amazon_products (global catalog, no university_id)
DROP POLICY IF EXISTS "Only admins can insert amazon products" ON public.amazon_products;
CREATE POLICY "Only admins can insert amazon products" ON public.amazon_products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "Only admins can update amazon products" ON public.amazon_products;
CREATE POLICY "Only admins can update amazon products" ON public.amazon_products
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "Only admins can delete amazon products" ON public.amazon_products;
CREATE POLICY "Only admins can delete amazon products" ON public.amazon_products
  FOR DELETE TO authenticated
  USING (public.is_superadmin());

-- amazon_product_variations (global catalog, no university_id)
DROP POLICY IF EXISTS "Only admins can insert amazon product variations" ON public.amazon_product_variations;
CREATE POLICY "Only admins can insert amazon product variations" ON public.amazon_product_variations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "Only admins can update amazon product variations" ON public.amazon_product_variations;
CREATE POLICY "Only admins can update amazon product variations" ON public.amazon_product_variations
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "Only admins can delete amazon product variations" ON public.amazon_product_variations;
CREATE POLICY "Only admins can delete amazon product variations" ON public.amazon_product_variations
  FOR DELETE TO authenticated
  USING (public.is_superadmin());

-- building_chat_link_reports (the report queue: superadmin side, 2026-07-21)
DROP POLICY IF EXISTS rls_bclr_select_admin ON public.building_chat_link_reports;
CREATE POLICY rls_bclr_select_admin ON public.building_chat_link_reports
  FOR SELECT TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS rls_bclr_delete_admin ON public.building_chat_link_reports;
CREATE POLICY rls_bclr_delete_admin ON public.building_chat_link_reports
  FOR DELETE TO authenticated
  USING (public.is_superadmin());

-- building_chat_links (owner branch preserved)
DROP POLICY IF EXISTS rls_bcl_update ON public.building_chat_links;
CREATE POLICY rls_bcl_update ON public.building_chat_links
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = submitted_by OR public.is_superadmin())
  WITH CHECK ((SELECT auth.uid()) = submitted_by OR public.is_superadmin());

DROP POLICY IF EXISTS rls_bcl_delete ON public.building_chat_links;
CREATE POLICY rls_bcl_delete ON public.building_chat_links
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = submitted_by OR public.is_superadmin());

-- business_listings admin branch (owner policies are separate and untouched)
DROP POLICY IF EXISTS "Admins can view all listings" ON public.business_listings;
CREATE POLICY "Admins can view all listings" ON public.business_listings
  FOR SELECT TO authenticated
  USING (public.is_superadmin());

DROP POLICY IF EXISTS "Admins can update all listings" ON public.business_listings;
CREATE POLICY "Admins can update all listings" ON public.business_listings
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- marketplace_listings (owner branch + sublease gate preserved verbatim)
DROP POLICY IF EXISTS rls_marketplace_listings_update ON public.marketplace_listings;
CREATE POLICY rls_marketplace_listings_update ON public.marketplace_listings
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_superadmin())
  WITH CHECK (
    ((SELECT auth.uid()) = user_id
      AND (COALESCE(is_sublease, false) = false OR public.can_post_sublease((SELECT auth.uid()))))
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS rls_marketplace_listings_delete ON public.marketplace_listings;
CREATE POLICY rls_marketplace_listings_delete ON public.marketplace_listings
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_superadmin());

-- roommate_search_posts (owner branch preserved)
DROP POLICY IF EXISTS rls_roommate_search_posts_delete ON public.roommate_search_posts;
CREATE POLICY rls_roommate_search_posts_delete ON public.roommate_search_posts
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id OR public.is_superadmin());

-- seller_ratings (rater branch preserved)
DROP POLICY IF EXISTS rls_seller_ratings_delete ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_delete ON public.seller_ratings
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = rater_id OR public.is_superadmin());

-- student_setups admin branch (owner policy is separate and untouched)
DROP POLICY IF EXISTS rls_student_setups_update_admin ON public.student_setups;
CREATE POLICY rls_student_setups_update_admin ON public.student_setups
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ───────────────────────── (b) tenant-scoped admin ─────────────────────────

-- master_housing: the school's own dorm catalog, edited from /admin/dorms.
DROP POLICY IF EXISTS admins_update_master_housing ON public.master_housing;
CREATE POLICY admins_update_master_housing ON public.master_housing
  FOR UPDATE TO authenticated
  USING (
    public.is_superadmin()
    OR (public.current_app_role() = 'university_admin'::public.app_role
        AND university_id = public.current_university_id())
  )
  WITH CHECK (
    public.is_superadmin()
    OR (public.current_app_role() = 'university_admin'::public.app_role
        AND university_id = public.current_university_id())
  );

-- dorm_edits: the audit trail of those edits, scoped through the dorm row.
DROP POLICY IF EXISTS admins_insert_dorm_edits ON public.dorm_edits;
CREATE POLICY admins_insert_dorm_edits ON public.dorm_edits
  FOR INSERT TO authenticated
  WITH CHECK (
    edited_by = (SELECT auth.uid())
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = dorm_edits.dorm_id
                        AND m.university_id = public.current_university_id()))
    )
  );

DROP POLICY IF EXISTS admins_read_dorm_edits ON public.dorm_edits;
CREATE POLICY admins_read_dorm_edits ON public.dorm_edits
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR (public.current_app_role() = 'university_admin'::public.app_role
        AND EXISTS (SELECT 1 FROM public.master_housing m
                    WHERE m.id = dorm_edits.dorm_id
                      AND m.university_id = public.current_university_id()))
  );

-- dorm-photos bucket: objects live at `<master_housing.id>/<field>/<file>`
-- (src/components/admin/PhotoUpload.tsx), so the first path segment is the dorm.
--
-- FOUND WHILE PROBING: the bucket never had a SELECT policy on storage.objects. Postgres
-- consults SELECT policies for any UPDATE/DELETE whose WHERE reads the row, so the admin
-- update/delete policies below have matched ZERO rows for every caller since the baseline —
-- PhotoUpload.tryDeleteOldFile() has been failing silently (it only console.warns) and every
-- replaced dorm photo is still in the bucket. The public bucket serves files by URL without
-- this policy; it exists so the row itself is visible to the admin who may change it.
DROP POLICY IF EXISTS admins_read_dorm_photos ON storage.objects;
CREATE POLICY admins_read_dorm_photos ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dorm-photos'
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND (storage.foldername(name))[1] ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = ((storage.foldername(name))[1])::bigint
                        AND m.university_id = public.current_university_id()))
    )
  );

DROP POLICY IF EXISTS admins_upload_dorm_photos ON storage.objects;
CREATE POLICY admins_upload_dorm_photos ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dorm-photos'
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND (storage.foldername(name))[1] ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = ((storage.foldername(name))[1])::bigint
                        AND m.university_id = public.current_university_id()))
    )
  );

DROP POLICY IF EXISTS admins_update_dorm_photos ON storage.objects;
CREATE POLICY admins_update_dorm_photos ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dorm-photos'
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND (storage.foldername(name))[1] ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = ((storage.foldername(name))[1])::bigint
                        AND m.university_id = public.current_university_id()))
    )
  )
  WITH CHECK (
    bucket_id = 'dorm-photos'
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND (storage.foldername(name))[1] ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = ((storage.foldername(name))[1])::bigint
                        AND m.university_id = public.current_university_id()))
    )
  );

DROP POLICY IF EXISTS admins_delete_dorm_photos ON storage.objects;
CREATE POLICY admins_delete_dorm_photos ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dorm-photos'
    AND (
      public.is_superadmin()
      OR (public.current_app_role() = 'university_admin'::public.app_role
          AND (storage.foldername(name))[1] ~ '^[0-9]+$'
          AND EXISTS (SELECT 1 FROM public.master_housing m
                      WHERE m.id = ((storage.foldername(name))[1])::bigint
                        AND m.university_id = public.current_university_id()))
    )
  );

-- ───────────────────────── self-check ─────────────────────────
-- Fail the transaction if any policy in public or storage still reads the derived column,
-- or if a rewrite above silently dropped a policy (a DROP that succeeded and a CREATE
-- that did not would otherwise leave a table with FEWER guards than before).
DO $$
DECLARE
  v_is_admin_refs integer;
  v_present integer;
BEGIN
  SELECT count(*) INTO v_is_admin_refs
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_admin = true';
  IF v_is_admin_refs <> 0 THEN
    RAISE EXCEPTION '20261005000000: % policies still key on profiles.is_admin', v_is_admin_refs;
  END IF;

  SELECT count(*) INTO v_present
  FROM pg_policies
  WHERE (schemaname, tablename, policyname) IN (
    ('public', 'amazon_products', 'Only admins can insert amazon products'),
    ('public', 'amazon_products', 'Only admins can update amazon products'),
    ('public', 'amazon_products', 'Only admins can delete amazon products'),
    ('public', 'amazon_product_variations', 'Only admins can insert amazon product variations'),
    ('public', 'amazon_product_variations', 'Only admins can update amazon product variations'),
    ('public', 'amazon_product_variations', 'Only admins can delete amazon product variations'),
    ('public', 'building_chat_link_reports', 'rls_bclr_select_admin'),
    ('public', 'building_chat_link_reports', 'rls_bclr_delete_admin'),
    ('public', 'building_chat_links', 'rls_bcl_update'),
    ('public', 'building_chat_links', 'rls_bcl_delete'),
    ('public', 'business_listings', 'Admins can view all listings'),
    ('public', 'business_listings', 'Admins can update all listings'),
    ('public', 'marketplace_listings', 'rls_marketplace_listings_update'),
    ('public', 'marketplace_listings', 'rls_marketplace_listings_delete'),
    ('public', 'roommate_search_posts', 'rls_roommate_search_posts_delete'),
    ('public', 'seller_ratings', 'rls_seller_ratings_delete'),
    ('public', 'student_setups', 'rls_student_setups_update_admin'),
    ('public', 'master_housing', 'admins_update_master_housing'),
    ('public', 'dorm_edits', 'admins_insert_dorm_edits'),
    ('public', 'dorm_edits', 'admins_read_dorm_edits'),
    ('storage', 'objects', 'admins_read_dorm_photos'),
    ('storage', 'objects', 'admins_upload_dorm_photos'),
    ('storage', 'objects', 'admins_update_dorm_photos'),
    ('storage', 'objects', 'admins_delete_dorm_photos'));
  IF v_present <> 24 THEN
    RAISE EXCEPTION '20261005000000: expected 23 rewritten + 1 new policies present, found %', v_present;
  END IF;
END $$;

COMMIT;
