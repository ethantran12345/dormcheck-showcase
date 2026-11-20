-- Security queue Tier 1 (2026-08-02).
-- 1. business_listings: owners could flip is_approved on their own row — the
--    "Students can update their own listing" UPDATE policy has no WITH CHECK,
--    so Postgres reuses the USING clause (ownership only) as the check and the
--    moderation gate is owner-writable. Fix is a BEFORE UPDATE trigger that
--    restores moderation/identity columns for non-admin callers: unlike a
--    WITH CHECK allowlist it survives future column additions and policy
--    rewrites, and it leaves "Admins can update all listings" fully working.
-- 2. business_listings "Owner can view own listings": add explicit tenant
--    scoping. The RESTRICTIVE tenant_isolation policy already ANDs this in for
--    authenticated users; this is defense-in-depth so the permissive qual is
--    safe standing alone (e.g. if tenant_isolation is ever dropped/rewritten).
-- 3. seller_ratings SELECT qual was literally `true`; scope it to the current
--    university. NOT the tenant_isolation inline-EXISTS shape: an inline
--    `EXISTS (SELECT … FROM profiles)` inside a policy runs under profiles'
--    own-row-only RLS, so it is false for every seller except yourself —
--    proven empirically on the security-tier1 branch. Use the SECURITY DEFINER
--    helpers (profile_university / current_university_id) instead. The
--    existing RESTRICTIVE tenant_isolation policy on seller_ratings has the
--    same latent flaw (it would hide all peer ratings once the feature gets
--    use; prod has 0 rows today), so it is rewritten with the helper too.

-- ── 1. Moderation-column guard trigger ───────────────────────────────────────
-- SECURITY DEFINER so the profiles lookup is not subject to profiles RLS.
-- auth.uid() IS NULL = direct SQL / service-role paths (seeds, edge functions):
-- those bypass RLS by design and must not be broken by the trigger.
CREATE OR REPLACE FUNCTION public.protect_business_listing_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RETURN NEW;
  END IF;
  -- Non-admin INSERT: a new listing always starts unapproved. Without this the
  -- UPDATE guard is trivially bypassed — the INSERT policy's WITH CHECK only
  -- asserts ownership, so an owner could create an already-approved listing
  -- (verified against a branch database, 2026-08-02).
  IF TG_OP = 'INSERT' THEN
    NEW.is_approved := false;
    RETURN NEW;
  END IF;
  -- Non-admin UPDATE: moderation state and row identity are frozen. Restoring
  -- OLD (instead of raising) keeps benign owner edits that never touched these
  -- columns working unchanged.
  NEW.is_approved   := OLD.is_approved;
  NEW.user_id       := OLD.user_id;
  NEW.university_id := OLD.university_id;
  NEW.created_at    := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_business_listing_moderation ON public.business_listings;
CREATE TRIGGER protect_business_listing_moderation
  BEFORE INSERT OR UPDATE ON public.business_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_listing_moderation();

-- ── 2. Owner-view policy: explicit tenant scope ──────────────────────────────
DROP POLICY IF EXISTS "Owner can view own listings" ON public.business_listings;
CREATE POLICY "Owner can view own listings"
  ON public.business_listings
  FOR SELECT
  USING (
    auth.uid() = user_id
    AND (university_id = public.current_university_id() OR public.is_superadmin())
  );

-- ── 3. seller_ratings SELECT: tenant scope instead of `true` ─────────────────
-- Idempotent re-declare (matches the prod definition verbatim) so this
-- migration replays cleanly on stacks whose history predates the helper.
CREATE OR REPLACE FUNCTION public.profile_university(p_user uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT university_id FROM public.profiles WHERE id = p_user;
$$;

DROP POLICY IF EXISTS rls_seller_ratings_select ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_select
  ON public.seller_ratings
  FOR SELECT
  TO authenticated
  USING (
    public.profile_university(seller_id) = public.current_university_id()
    OR public.is_superadmin()
  );

-- Rewrite the RESTRICTIVE tenant policy with the definer helper (same scope,
-- minus the invoker-RLS bug that made its inline EXISTS unsatisfiable).
DROP POLICY IF EXISTS tenant_isolation ON public.seller_ratings;
CREATE POLICY tenant_isolation
  ON public.seller_ratings
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    public.profile_university(seller_id) = public.current_university_id()
    OR public.is_superadmin()
  );
