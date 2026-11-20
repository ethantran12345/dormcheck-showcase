-- Pitt VRSA hardening - DB attack-surface lockdown
-- Triage: git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06)  (items #3 helper, #6, #7, #8, Step-3 protect_profile_is_admin)
--
-- STAGED: apply to LOCAL Supabase first; do NOT apply to prod without Ethan's OK.
-- None of this changes Phase-1 behavior:
--   * is_pitt_user() is additive and not yet wired into any policy.
--   * business_listings is anon-locked but its UI tab is compile-time hidden.
--   * get_subleases_preview is an orphan (subleases removed 2026-06-25).
--   * the marketplace DELETE consolidation preserves the own-or-admin delete path.
--   * protect_profile_is_admin is a trigger fn; revoking client EXECUTE is harmless.

-- ---------------------------------------------------------------------------
-- #3 (defense-in-depth) - server-side @pitt.edu primitive usable in RLS.
-- Reads the email claim from the request JWT. NOT wired into any policy yet;
-- the auth.users validate_pitt_email() trigger remains the primary gate. This
-- gives RLS a reusable WITH CHECK/USING predicate for future write-table gating.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_pitt_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(lower(auth.jwt() ->> 'email') LIKE '%@pitt.edu', false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_pitt_user() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_pitt_user() TO authenticated;

-- ---------------------------------------------------------------------------
-- #6 - business_listings still anon-readable while other UGC is locked.
-- The "Anyone can view approved listings" policy + anon table grants let logged-
-- out clients read approved business listings via REST. The UI tab is compile-
-- time hidden (SHOW_STUDENT_BUSINESSES=false). Lock reads to authenticated.
-- The stray anon DML grants are neutralized by RLS (auth.uid() is null) but are
-- revoked too to keep the surface clean.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.business_listings FROM anon;

-- ---------------------------------------------------------------------------
-- #7 - get_subleases_preview is an orphaned anon-executable RPC (subleases were
-- removed 2026-06-25; no client caller remains). Drop it. Clears 2 advisor WARNs.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_subleases_preview(text);

-- ---------------------------------------------------------------------------
-- Step-3 triage - protect_profile_is_admin() is a TRIGGER function exposed as an
-- executable RPC (advisor WARN 0029). Like auto_hide_reported_listing() in Pass
-- 4, it should not be client-callable. Revoke EXECUTE; the trigger still fires.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.protect_profile_is_admin() FROM anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- #8 - duplicate marketplace_listings DELETE policies. PG ORs permissive
-- policies, so today the effective rule is (owner OR admin) via the legacy
-- policy plus a redundant owner-only policy. Consolidate into a single,
-- clearly-named policy that PRESERVES the admin moderation delete path
-- (ReportsPage delete depends on it).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can delete own marketplace listings" ON public.marketplace_listings;
DROP POLICY IF EXISTS rls_marketplace_listings_delete ON public.marketplace_listings;

CREATE POLICY rls_marketplace_listings_delete
  ON public.marketplace_listings
  FOR DELETE
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );
