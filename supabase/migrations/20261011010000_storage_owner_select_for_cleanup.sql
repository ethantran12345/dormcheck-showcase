-- Owner-only SELECT on the remaining uid-prefixed public buckets, so a client
-- can delete its own refused or replaced upload (handoff-uploads-marketplace-
-- verification-2026-10-11, Phase A finding; storage-buckets.md gap 12).
--
-- Supabase Storage resolves an object through SELECT before it DELETEs it.
-- Security Pass 4 (20260629000000) correctly dropped the broad public SELECT
-- (listing) policies, and 20260925000000 restored an own-folder SELECT for
-- setup-photos only. Every other uid-prefixed public bucket kept its owner
-- DELETE policy but no SELECT, so `storage.remove()` returned `ok, 0 removed`
-- and the object stayed at its public URL. Measured on the seeded local stack
-- 2026-10-11 as the student: avatars, dm-photos, marketplace-images,
-- roommate-post-photos, business-logos all `0 removed` + public GET 200;
-- setup-photos `1 removed` + 400. Browser-verified consequence: an avatar the
-- screen held, rejected or could not reach, and a DM photo it held, stayed in
-- the public bucket while the app (correctly) refused to use it.
--
-- Same shape as 20260925000000: visibility only inside the caller's own UUID
-- prefix (the prefix every one of these buckets' INSERT and DELETE policies
-- already require), TO authenticated only. Public image delivery is unchanged
-- (public-bucket object URLs never consult RLS); cross-user listing stays
-- closed, which was the point of Pass 4.

DROP POLICY IF EXISTS "Owners can view their own avatars objects" ON storage.objects;
CREATE POLICY "Owners can view their own avatars objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can view their own dm-photos objects" ON storage.objects;
CREATE POLICY "Owners can view their own dm-photos objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'dm-photos'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can view their own marketplace-images objects" ON storage.objects;
CREATE POLICY "Owners can view their own marketplace-images objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can view their own roommate-post-photos objects" ON storage.objects;
CREATE POLICY "Owners can view their own roommate-post-photos objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'roommate-post-photos'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can view their own business-logos objects" ON storage.objects;
CREATE POLICY "Owners can view their own business-logos objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-logos'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Owners can view their own business-banners objects" ON storage.objects;
CREATE POLICY "Owners can view their own business-banners objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'business-banners'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);
