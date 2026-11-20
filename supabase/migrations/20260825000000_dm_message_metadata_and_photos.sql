-- DM attachments: a metadata payload on `messages` + a bucket for chat photos.
--
-- WHY A COLUMN, NOT A TEXT MARKER: `group_messages.metadata` already exists
-- (20260818000000_group_messages_metadata) and carries checklist/instagram
-- cards. DMs had no equivalent, so the listing share had to smuggle its id
-- inside the message text as `[Dormcheck:listing:<id>]`. That trick cannot
-- carry a photo (or, later, an audio clip), so this mirrors the group shape
-- exactly rather than inventing a second convention.
--
-- ADDITIVE AND NULLABLE: every existing row stays valid, `content` remains the
-- human-readable fallback (old clients, `conversations.last_message` previews),
-- and no policy changes because the column inherits the row's RLS. Expand only
-- - nothing is dropped or rewritten.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.messages.metadata IS
  'Optional structured attachment for a DM (image, shared card). NULL = plain text. `content` always holds a readable fallback. Mirrors group_messages.metadata.';

-- ── Bucket: dm-photos ───────────────────────────────────────────────────────
-- PUBLIC READ, matching every other image bucket in this project
-- (20260820020000_storage_buckets_baseline). This is a deliberate, stated
-- tradeoff, NOT an oversight: a private bucket would need a signed URL per
-- render, and the app has no signing path today. Object names are
-- `<uid>/<random>.<ext>`, so a URL is unguessable, but it IS reachable by
-- anyone holding it. Revisit together with private avatars if that changes.
-- 10 MB cap and image-only MIME list mirror the other display buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('dm-photos', 'dm-photos', true, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

-- Writes are confined to the caller's OWN folder: the first path segment must
-- be their uid, which is what stops one student writing into another's prefix.
DROP POLICY IF EXISTS "Users can upload own dm photos" ON storage.objects;
CREATE POLICY "Users can upload own dm photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dm-photos' AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own dm photos" ON storage.objects;
CREATE POLICY "Users can update own dm photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dm-photos' AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'dm-photos' AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- Delete is own-folder too, so a sender can retract a photo they uploaded.
DROP POLICY IF EXISTS "Users can delete own dm photos" ON storage.objects;
CREATE POLICY "Users can delete own dm photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dm-photos' AND (auth.uid())::text = (storage.foldername(name))[1]
  );
