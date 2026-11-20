-- Server-side cleanup of held and orphaned images (A2, 2026-10-12; decision in
-- docs/DECISIONS.md "storage cleanup"). Three gaps, one migration:
--
--   1. moderate-image HOLDS left their object in a public bucket. Only the client
--      deleted it, and a timed-out or crashed client never did. The function now
--      deletes a held object itself and records it, so the action CHECK gains
--      'auto_hold_image'. A hold whose categories include sexual/minors is never
--      deleted: it is quarantined like a reject (20261008000000), because possible
--      child-safety evidence must not be destroyed.
--   2. Held and rejected MARKETPLACE photos stayed at public URLs for as long as the
--      listing sat in the queue. They now move into `images-held`: PRIVATE, no
--      policy on storage.objects (service role only, exactly like
--      images-quarantine). Admins see them through short-lived signed URLs minted by
--      the held-listing-images function; approve moves them back to the same path.
--   3. Orphans (replaced avatars, removed dorm photos, abandoned uploads, a listing
--      whose insert failed) were never deleted by anything.
--      `storage_unreferenced_objects()` lists objects in ONE of the eight public
--      upload buckets that no row references; the daily sweeper
--      (api/cron/storage-sweep.ts) and account deletion (dorm-photos) call it.
--
-- PRESERVATION IS A HARD REFUSAL, NOT A FILTER. The function raises on
-- images-quarantine and images-held by name BEFORE its allowlist check, so a later
-- edit that widens the allowlist still cannot reach either bucket. The TypeScript
-- callers refuse the same two names independently (api/_lib/storageSweep.ts).
--
-- "REFERENCED" IS DELIBERATELY OVER-INCLUSIVE. An object is kept if its name, with
-- every character outside [A-Za-z0-9] removed, appears anywhere in the same
-- normalisation of a corpus built from every column that stores a storage URL or
-- URL-bearing JSON (percent-escapes are dropped first, so `a b.jpg` matches
-- `a%20b.jpg`). A column missing from this list means a photo that should have been
-- swept is kept; a false match also keeps. Neither direction deletes something
-- live. An EMPTY corpus raises rather than declaring every object unreferenced.
--
-- Forward-only, expand-only: one CHECK widened (exact set, add-validate-drop-rename),
-- one bucket, one function. Probe: supabase/tests/storage_cleanup.test.sql.

BEGIN;

-- ── 1. moderation_actions.action + 'auto_hold_image' ─────────────────────────
-- EXACT authorized set (20260630131348, 20260712220421, 20260916000000, + this).
-- Guarded by supabase/tests/moderation_action_check_drift.test.sql.
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_action_check_new;
ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_action_check_new
  CHECK (action = ANY (ARRAY[
    'dismiss_report'::text,
    'delete_content'::text,
    'restore_listing'::text,
    'escalate_report'::text,
    'auto_reject_image'::text,
    'auto_hold_image'::text
  ])) NOT VALID;
ALTER TABLE public.moderation_actions
  VALIDATE CONSTRAINT moderation_actions_action_check_new;
ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_action_check;
ALTER TABLE public.moderation_actions
  RENAME CONSTRAINT moderation_actions_action_check_new
    TO moderation_actions_action_check;

-- ── 2. images-held: private, service role only ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('images-held', 'images-held', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── 3. unreferenced objects in one public upload bucket ──────────────────────
CREATE OR REPLACE FUNCTION public.storage_unreferenced_objects(
  p_bucket text,
  p_created_before timestamptz,
  p_owner uuid DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (name text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_corpus text;
BEGIN
  -- Refused by name first, so widening the allowlist below can never reach them.
  IF p_bucket IN ('images-quarantine', 'images-held') THEN
    RAISE EXCEPTION 'storage_unreferenced_objects: % is a preserved bucket and is never swept', p_bucket
      USING errcode = 'insufficient_privilege';
  END IF;
  IF p_bucket IS NULL OR p_bucket NOT IN (
    'avatars', 'business-banners', 'business-logos', 'dm-photos',
    'dorm-photos', 'marketplace-images', 'roommate-post-photos', 'setup-photos'
  ) THEN
    RAISE EXCEPTION 'storage_unreferenced_objects: % is not a sweepable public upload bucket', p_bucket
      USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_created_before IS NULL OR p_created_before > now() THEN
    RAISE EXCEPTION 'storage_unreferenced_objects: p_created_before must be a past moment';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'storage_unreferenced_objects: p_limit must be 1..500';
  END IF;

  SELECT regexp_replace(
           regexp_replace(string_agg(t, ' '), '%[0-9A-Fa-f]{2}', '', 'g'),
           '[^A-Za-z0-9]', '', 'g')
    INTO v_corpus
    FROM (
      SELECT p.avatar_url AS t FROM public.profiles p
      UNION ALL SELECT array_to_string(p.profile_photos, ' ') FROM public.profiles p
      UNION ALL SELECT pp.avatar_url FROM public.profiles_public pp
      UNION ALL SELECT pr.avatar_url FROM public.profiles_roommate pr
      UNION ALL SELECT array_to_string(pr.profile_photos, ' ') FROM public.profiles_roommate pr
      UNION ALL SELECT sp.image_url FROM public.setup_photos sp
      UNION ALL SELECT ss.image_url FROM public.student_setups ss
      UNION ALL SELECT bl.banner_image_url FROM public.business_listings bl
      UNION ALL SELECT bl.logo_url FROM public.business_listings bl
      UNION ALL SELECT ml.image_url FROM public.marketplace_listings ml
      UNION ALL SELECT array_to_string(ml.image_urls, ' ') FROM public.marketplace_listings ml
      UNION ALL SELECT array_to_string(rp.photos, ' ') FROM public.roommate_search_posts rp
      UNION ALL SELECT m.metadata::text FROM public.messages m WHERE m.metadata IS NOT NULL
      UNION ALL SELECT gm.metadata::text FROM public.group_messages gm WHERE gm.metadata IS NOT NULL
      UNION ALL SELECT mh.image_url FROM public.master_housing mh
      UNION ALL SELECT mh.floorplan FROM public.master_housing mh
      UNION ALL SELECT de.old_value::text FROM public.dorm_edits de
      UNION ALL SELECT de.new_value::text FROM public.dorm_edits de
      UNION ALL SELECT ci.image_url FROM public.checklist_items ci
      UNION ALL SELECT ci.link_image FROM public.checklist_items ci
      UNION ALL SELECT ac.image_url FROM public.ad_creatives ac
      UNION ALL SELECT ep.variant_image_url FROM public.explore_picks ep
    ) refs
   WHERE t IS NOT NULL AND t <> '';

  -- An empty corpus would make every object look unreferenced. A real deployment
  -- always has at least one stored URL; refuse rather than list the bucket.
  IF v_corpus IS NULL OR v_corpus = '' THEN
    RAISE EXCEPTION 'storage_unreferenced_objects: reference corpus is empty; refusing to list anything';
  END IF;

  RETURN QUERY
  SELECT o.name, o.created_at
    FROM storage.objects o
   WHERE o.bucket_id = p_bucket
     AND o.created_at < p_created_before
     AND (p_owner IS NULL OR o.owner = p_owner OR o.owner_id = p_owner::text)
     AND regexp_replace(o.name, '[^A-Za-z0-9]', '', 'g') <> ''
     AND strpos(v_corpus, regexp_replace(o.name, '[^A-Za-z0-9]', '', 'g')) = 0
   ORDER BY o.created_at
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.storage_unreferenced_objects(text, timestamptz, uuid, integer) IS
  'Objects in one of the eight public upload buckets that no stored URL references, older than p_created_before (optionally owned by p_owner), at most 500. Raises on images-quarantine and images-held. Service role only; callers: api/cron/storage-sweep.ts, delete-user-account.';

REVOKE ALL ON FUNCTION public.storage_unreferenced_objects(text, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_unreferenced_objects(text, timestamptz, uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storage_unreferenced_objects(text, timestamptz, uuid, integer) TO service_role;

-- ───────────────────────── self-check ─────────────────────────
DO $$
DECLARE
  v_public boolean;
  v_policies integer;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'images-held';
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION '20261013000000: images-held is missing or public';
  END IF;

  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
    AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'images-(held|quarantine)';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '20261013000000: % policy(ies) reference images-held or images-quarantine; both stay service-role only', v_policies;
  END IF;

  IF has_function_privilege('authenticated',
       'public.storage_unreferenced_objects(text, timestamptz, uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.storage_unreferenced_objects(text, timestamptz, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261013000000: storage_unreferenced_objects is callable by a client role';
  END IF;
END $$;

COMMIT;
