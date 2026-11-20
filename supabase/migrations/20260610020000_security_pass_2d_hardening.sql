-- Security Pass 2d hardening (follow-up to 2c prod audit leftovers).
-- A. Dedupe storage INSERT policies: one uid-prefix policy per bucket.
-- B. Drop orphaned dorm-setups storage policies (bucket removed).
-- C. Revoke client EXECUTE on protect_profile_is_admin trigger function.
-- D. Pin search_path on trigger/DDL utility functions.
-- E. Document public_profiles owner-rights design for future audits.
-- F. Drop unused collaboration_details view (joins profiles directly; app uses ranking_collaborations).

-- ---------------------------------------------------------------------------
-- A. Storage INSERT: drop weak/duplicate policies on four upload buckets.
-- Postgres ORs permissive policies; any leftover weak INSERT re-opens uploads.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload listing images" ON storage.objects;

DROP POLICY IF EXISTS "Avatar Upload Policy" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;

-- Canonical enforcing policies (from Pass 2c) - recreate idempotently for avatars
-- only; business-banners/logos/marketplace-images already have exactly one.
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- ---------------------------------------------------------------------------
-- B. Orphaned dorm-setups bucket policies (bucket no longer exists).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated Upload" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- ---------------------------------------------------------------------------
-- C. protect_profile_is_admin: trigger-only; not client-callable.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.protect_profile_is_admin() FROM anon, public;

-- ---------------------------------------------------------------------------
-- D. search_path hardening on functions flagged by security advisor.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.update_device_tokens_updated_at() SET search_path = '';
-- Body uses pg_catalog.pg_policies + format()/EXECUTE only; pin path to avoid empty-path footgun.
ALTER FUNCTION public.drop_all_policies_for_table(text, text) SET search_path = pg_catalog, public;

-- ---------------------------------------------------------------------------
-- E. public_profiles: intentional owner-rights column-restriction boundary.
-- ---------------------------------------------------------------------------
COMMENT ON VIEW public.public_profiles IS
  'Intentional owner-rights (non-security_invoker) view. Reads with postgres '
  'privileges to expose a column-restricted subset of profiles for cross-user '
  'features (roommate cards, DMs, search). Full profiles remain own-row SELECT '
  'only via RLS on public.profiles; do not recreate with security_invoker.';

-- ---------------------------------------------------------------------------
-- F. collaboration_details: unused dead code (app queries ranking_collaborations
-- directly). View was security_invoker, so it respected the Pass 2c profiles RLS
-- (returned null collaborator data, never leaked it). Dropped to reduce surface.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.collaboration_details;
