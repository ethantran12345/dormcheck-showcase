-- The private quarantine bucket and its preservation clock (BA-07,
-- docs/audits/backend-audit-2026-09-06.md; vault "CSAM Compliance Scope 2026-08-06").
--
-- THE RULE. 18 U.S.C. § 2258A(h), as amended by the REPORT Act (signed 2024-05-07),
-- treats a CyberTipline report as a request to preserve the reported content for
-- ONE YEAR (it was 90 days before the Act; the vault's legal page was corrected on
-- 2026-08-06). Until this migration there was nowhere for flagged content to GO:
-- moderate-image's reject path wrote an audit row and the caller deleted the object
-- it had just uploaded. Turning detection on in that state would have destroyed the
-- very material a report obliges DormCheck to keep — "detection without a
-- preservation path converts a compliance gap into a violation".
--
-- WHAT THIS CREATES
--   · storage bucket `images-quarantine`: PRIVATE, and deliberately given NO policy on
--     storage.objects. Under RLS that is a denial for anon and authenticated in both
--     directions; only the service role (moderate-image, and a human with the
--     dashboard) can read or write it. The self-check below pins "no policy names
--     this bucket" so a later policy cannot quietly open it.
--   · moderation_actions.quarantine_path — where the object went (newline-joined when
--     one screen rejected several).
--   · moderation_actions.preserve_until — the moment before which the object must not
--     be purged. Set by moderate-image to now + PRESERVE_DAYS (366, so a leap day only
--     lengthens the hold). A path without a clock is refused by CHECK: a quarantined
--     object with no retention date is exactly the state the statute forbids.
--
-- WHAT THIS DOES NOT DO (deliberately, per the vault sequencing): hash matching,
-- NCMEC reporting, and a purge job. Nothing purges this bucket today; when a purge
-- job exists it must honour preserve_until and is a separate decision.
--
-- Account deletion skips this bucket: supabase/functions/_shared/storageBuckets.ts
-- declares it PRESERVED and delete-user-account derives its purge list from that.
-- moderation_actions rows already survive the uploader's deletion (admin_id and
-- reporter_id are ON DELETE SET NULL; content_id is a bare uuid).
--
-- Forward-only, expand-only. Probe: supabase/tests/images_quarantine_bucket.test.sql.
-- Deploy gate: scripts/edge-deploy-gate.mjs refuses `moderate-image` until this
-- bucket and the deletion carve-out both exist in the target project.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('images-quarantine', 'images-quarantine', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false;

ALTER TABLE public.moderation_actions
  ADD COLUMN IF NOT EXISTS quarantine_path text,
  ADD COLUMN IF NOT EXISTS preserve_until timestamptz;

COMMENT ON COLUMN public.moderation_actions.quarantine_path IS
  'Storage path(s) inside the private images-quarantine bucket where automated moderation moved a rejected image (newline-joined). NULL = nothing was quarantined for this action.';
COMMENT ON COLUMN public.moderation_actions.preserve_until IS
  '18 U.S.C. § 2258A(h) as amended by the REPORT Act: a quarantined object must not be purged before this moment (one year from the reject). NULL only when quarantine_path is NULL.';

-- First creation, so there is nothing to swap: add it only when absent (never DROP then
-- ADD as two bare statements — .claude/rules/supabase-backend.md).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.moderation_actions'::regclass
      AND conname = 'moderation_actions_quarantine_needs_clock'
  ) THEN
    ALTER TABLE public.moderation_actions
      ADD CONSTRAINT moderation_actions_quarantine_needs_clock
      CHECK (quarantine_path IS NULL OR preserve_until IS NOT NULL);
  END IF;
END $$;

-- Finding what is still under the clock is the one query a future purge job or an
-- auditor needs; index it so that question never becomes a table scan.
CREATE INDEX IF NOT EXISTS idx_moderation_actions_preserve_until
  ON public.moderation_actions (preserve_until)
  WHERE quarantine_path IS NOT NULL;

-- ───────────────────────── self-check ─────────────────────────
DO $$
DECLARE
  v_public boolean;
  v_policies integer;
  v_check text;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'images-quarantine';
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION '20261008000000: images-quarantine is missing or public';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'images-quarantine';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '20261008000000: % policy(ies) reference images-quarantine; it must stay service-role only', v_policies;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check
  FROM pg_constraint
  WHERE conrelid = 'public.moderation_actions'::regclass
    AND conname = 'moderation_actions_quarantine_needs_clock';
  IF v_check IS NULL THEN
    RAISE EXCEPTION '20261008000000: the quarantine clock CHECK is missing';
  END IF;
END $$;

COMMIT;
