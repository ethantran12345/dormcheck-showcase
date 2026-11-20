-- Security queue group 2 phase D: lock marketplace/reviews/setups base tables to authenticated SELECT.
-- Preview RPCs (SECURITY DEFINER, owner postgres) continue reading as definer after this change.
-- Client logged-out paths were repointed in phases C and C.2.

-- ---------------------------------------------------------------------------
-- marketplace_listings
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_marketplace_listings_select" ON public.marketplace_listings;

CREATE POLICY "rls_marketplace_listings_select"
ON public.marketplace_listings
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.marketplace_listings FROM anon;

-- ---------------------------------------------------------------------------
-- student_reviews
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_student_reviews_select" ON public.student_reviews;

CREATE POLICY "rls_student_reviews_select"
ON public.student_reviews
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.student_reviews FROM anon;

-- ---------------------------------------------------------------------------
-- student_setups
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_student_setups_select" ON public.student_setups;

CREATE POLICY "rls_student_setups_select"
ON public.student_setups
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.student_setups FROM anon;

-- ---------------------------------------------------------------------------
-- setup_photos
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_setup_photos_select" ON public.setup_photos;

CREATE POLICY "rls_setup_photos_select"
ON public.setup_photos
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.setup_photos FROM anon;

-- ---------------------------------------------------------------------------
-- setup_products
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_setup_products_select" ON public.setup_products;

CREATE POLICY "rls_setup_products_select"
ON public.setup_products
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.setup_products FROM anon;

-- ---------------------------------------------------------------------------
-- setup_comments
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_setup_comments_select" ON public.setup_comments;

CREATE POLICY "rls_setup_comments_select"
ON public.setup_comments
FOR SELECT
TO authenticated
USING (true);

REVOKE ALL ON TABLE public.setup_comments FROM anon;

-- ---------------------------------------------------------------------------
-- setup_likes (residual anon grant; SELECT policy already authenticated-only)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.setup_likes FROM anon;
