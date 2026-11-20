-- P0.7 verified listings. Expand-only.
-- A lister proves their listing is real (lease/utility document upload or an
-- address attestation); an admin approves; buyers see a "Verified" badge.
--   1. listing_verifications (class B child of marketplace_listings) - one
--      pending/approved/rejected row per listing, owner-submitted,
--      admin-reviewed.
--   2. marketplace_listings.verified_at - the buyer-visible flag, set/cleared
--      only by a SECURITY DEFINER trigger on verification review (buyers never
--      read the private verification row).
--   3. Private storage bucket listing-verifications for evidence documents
--      (owner-uploaded under their uid prefix; owner + admins can read via
--      signed URLs; never public).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712120000.

-- ── 1. Verification requests ─────────────────────────────────────────────────

CREATE TABLE public.listing_verifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('document', 'address')),
  -- storage path in listing-verifications (document method)
  evidence_path text,
  -- attested address string (address method)
  address_confirmation text CHECK (address_confirmation IS NULL OR char_length(address_confirmation) <= 300),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id),
  CHECK (
    (method = 'document' AND evidence_path IS NOT NULL)
    OR (method = 'address' AND address_confirmation IS NOT NULL)
  )
);

CREATE INDEX listing_verifications_status_idx ON public.listing_verifications (status, created_at DESC);

ALTER TABLE public.listing_verifications ENABLE ROW LEVEL SECURITY;

-- Owner: submit for their own listing, read their own request. Re-submission
-- after rejection = DELETE own rejected row + INSERT (UNIQUE keeps one live row).
CREATE POLICY lv_insert_own ON public.listing_verifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY lv_select_own ON public.listing_verifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY lv_delete_own_rejected ON public.listing_verifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND status = 'rejected');

-- Admins: read every request, review (status/reviewed_by/reviewed_at/note).
CREATE POLICY lv_select_admin ON public.listing_verifications
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );
CREATE POLICY lv_update_admin ON public.listing_verifications
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

-- Class B tenant isolation: scoped through the parent listing's school.
DROP POLICY IF EXISTS tenant_isolation ON public.listing_verifications;
CREATE POLICY tenant_isolation ON public.listing_verifications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_listings l WHERE l.id = listing_verifications.listing_id));

REVOKE ALL ON TABLE public.listing_verifications FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.listing_verifications TO authenticated;

-- ── 2. Buyer-visible verified flag ───────────────────────────────────────────

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Only the review trigger writes it (SECURITY DEFINER; the column has no
-- direct client write path - the listings UPDATE policies predate it and the
-- protect trigger below rejects client-side changes).
CREATE OR REPLACE FUNCTION public.sync_listing_verified_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Transaction-local flag lets the protect trigger distinguish this write
  -- from a client-driven listing update (SECURITY DEFINER changes
  -- current_user, not session_user, so a session_user check can't).
  PERFORM set_config('dormcheck.allow_verified_at', '1', true);
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    UPDATE public.marketplace_listings SET verified_at = now() WHERE id = NEW.listing_id;
  ELSIF NEW.status <> 'approved' AND OLD.status = 'approved' THEN
    UPDATE public.marketplace_listings SET verified_at = NULL WHERE id = NEW.listing_id;
  END IF;
  PERFORM set_config('dormcheck.allow_verified_at', '', true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_listing_verified_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_listing_verified_flag ON public.listing_verifications;
CREATE TRIGGER trg_sync_listing_verified_flag
  AFTER UPDATE OF status ON public.listing_verifications
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_verified_flag();

-- Clear the badge if a verification request is deleted (owner re-submission
-- path or cascade) while approved.
CREATE OR REPLACE FUNCTION public.clear_listing_verified_flag()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    PERFORM set_config('dormcheck.allow_verified_at', '1', true);
    UPDATE public.marketplace_listings SET verified_at = NULL WHERE id = OLD.listing_id;
    PERFORM set_config('dormcheck.allow_verified_at', '', true);
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_listing_verified_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_listing_verified_flag ON public.listing_verifications;
CREATE TRIGGER trg_clear_listing_verified_flag
  AFTER DELETE ON public.listing_verifications
  FOR EACH ROW EXECUTE FUNCTION public.clear_listing_verified_flag();

-- Guard: sellers cannot self-verify by updating their listing row. The review
-- triggers above set a transaction-local flag before their write; direct
-- psql/service_role sessions also pass (session_user postgres / role
-- service_role). Everything else is rejected.
CREATE OR REPLACE FUNCTION public.protect_listing_verified_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
     AND COALESCE(current_setting('dormcheck.allow_verified_at', true), '') <> '1'
     AND session_user <> 'postgres'
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'verified_at is managed by the verification review flow';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_listing_verified_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_listing_verified_at ON public.marketplace_listings;
CREATE TRIGGER trg_protect_listing_verified_at
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.protect_listing_verified_at();

-- Column grant: verified_at joins the buyer-readable column list (SEC-6 model:
-- explicit column grants, contact columns stay revoked).
GRANT SELECT (verified_at) ON public.marketplace_listings TO authenticated;

-- ── 3. Private evidence bucket ───────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-verifications', 'listing-verifications', false)
ON CONFLICT (id) DO NOTHING;

-- Owner uploads under their own uid prefix; owner + admins read (signed URLs).
DROP POLICY IF EXISTS lv_storage_insert_own ON storage.objects;
CREATE POLICY lv_storage_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'listing-verifications'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );
DROP POLICY IF EXISTS lv_storage_select_own_or_admin ON storage.objects;
CREATE POLICY lv_storage_select_own_or_admin ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'listing-verifications'
    AND (
      (storage.foldername(name))[1] = (SELECT auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
      )
    )
  );
