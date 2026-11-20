-- Security Pass 4 (audit 2026-06-29). Closes three items from the security audit:
--
-- A. Public storage buckets allowed anon/authenticated to LIST every object
--    (broad SELECT policy on storage.objects), enabling enumeration/scraping of
--    all uploaded files. Public object access goes through the bucket's public
--    URL (getPublicUrl) and does NOT require a SELECT policy on storage.objects,
--    so dropping these "view" policies removes listing without breaking image
--    fetches. Verified: no client code calls storage.from(...).list(); the
--    delete-user-account edge function lists via the service role (bypasses RLS).
--    Advisor: 0025_public_bucket_allows_listing.
--
-- B. academic-planners → private. It holds quasi-personal planner docs in a
--    public bucket and is referenced nowhere in the client (no getPublicUrl,
--    no upload, no bucket constant). A future planner feature should read it via
--    createSignedUrl(). If you (re)introduce a public planner flow, revert this
--    line and add a scoped, owner-only read policy instead.
--
-- C. auto_hide_reported_listing() is a SECURITY DEFINER *trigger* function but
--    was EXECUTE-able by anon/authenticated via /rest/v1/rpc. Trigger functions
--    must not be directly callable. Advisor: 0028/0029.

-- A. Drop broad listing SELECT policies on the public buckets.
--    Names taken verbatim from the Supabase security advisor (some were created
--    in the dashboard, hence IF EXISTS by exact name).
DROP POLICY IF EXISTS "Public can view academic planners" ON storage.objects;
DROP POLICY IF EXISTS "Avatar View Policy" ON storage.objects;
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public can view business banners" ON storage.objects;
DROP POLICY IF EXISTS "Public can view business logos" ON storage.objects;
DROP POLICY IF EXISTS "public_read_dorm_photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view marketplace images" ON storage.objects;
DROP POLICY IF EXISTS "Public can view roommate post photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view setup photos" ON storage.objects;

-- B. academic-planners → private (no public client read path exists).
UPDATE storage.buckets SET public = false WHERE id = 'academic-planners';

-- C. Trigger function must not be RPC-callable.
REVOKE EXECUTE ON FUNCTION public.auto_hide_reported_listing() FROM anon, authenticated, public;
