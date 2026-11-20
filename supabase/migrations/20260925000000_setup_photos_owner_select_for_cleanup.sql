-- Supabase Storage resolves objects through SELECT before DELETE. The broad
-- public setup-photo SELECT policy was correctly removed in Security Pass 4,
-- but leaving no replacement made authenticated cleanup return `200 []` and
-- orphan a refused upload. Restore visibility only inside the caller's own
-- UUID prefix; public image delivery continues through the public object URL.

DROP POLICY IF EXISTS "Users can view their own setup photo objects" ON storage.objects;

CREATE POLICY "Users can view their own setup photo objects"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'setup-photos'
  AND (SELECT auth.uid())::text = (storage.foldername(name))[1]
);

