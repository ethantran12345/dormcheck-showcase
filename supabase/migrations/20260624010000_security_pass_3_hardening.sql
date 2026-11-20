-- Security Pass 3 hardening.
-- Follow-up to the audit after Pass 2a/2c/2d. Closes a marketplace moderation
-- bypass and tidies a handful of defense-in-depth gaps. No behavior change for
-- legitimate users.

-- ---------------------------------------------------------------------------
-- 1. Stop a listing owner from self-reverting a moderation hide.
--
-- auto_hide_reported_listing() flips a reported listing to 'under_review',
-- and the feed only shows status = 'available'. But the owner's UPDATE policy
-- (rls_marketplace_listings_update) only checks auth.uid() = user_id and does
-- NOT constrain `status`, so the seller could simply
--   update({ status: 'available' })
-- on their own under-review listing and put it straight back in the feed.
--
-- This BEFORE UPDATE trigger blocks a non-admin, non-service_role caller from
-- moving a row OUT of 'under_review'. It intentionally does NOT block the
-- transition INTO 'under_review': auto_hide runs SECURITY DEFINER but
-- auth.uid()/auth.role() still resolve to the reporting user (a regular
-- authenticated caller), so guarding the inbound transition would break the
-- moderation system itself. Legitimate owner transitions (available <-> sold)
-- are unaffected. service_role (edge functions) and admins (the dismiss/restore
-- path in ReportsPage) are exempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_listing_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'under_review'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.role() <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND is_admin = true
     ) THEN
    RAISE EXCEPTION 'This listing is under review and its status cannot be changed.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger-only function: not callable as an RPC.
REVOKE EXECUTE ON FUNCTION public.guard_listing_status_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_listing_status ON public.marketplace_listings;
CREATE TRIGGER trg_guard_listing_status
  BEFORE UPDATE OF status ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing_status_change();

-- ---------------------------------------------------------------------------
-- 2. Pin search_path on reject_prohibited_listing().
-- Every other function in the schema sets search_path = public; this trigger
-- (the prohibited-content guard) was the lone exception. Recreated verbatim
-- with the pin added. Keep the pattern in sync with src/lib/prohibitedContent.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_prohibited_listing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  if (coalesce(new.title, '') || ' ' || coalesce(new.description, '')) ~*
     '\m(guns?|firearms?|pistols?|handguns?|rifles?|shotguns?|ammo|ammunition|silencers?|cocaine|heroin|meth|methamphetamine|fentanyl|lsd|mdma|ecstasy|ketamine|shrooms|psilocybin|adderall|xanax|percocet|oxycodone|oxycontin|escorts?|nudes|onlyfans)\M'
  then
    raise exception 'This listing mentions a prohibited item or content and cannot be posted.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Add WITH CHECK to UPDATE policies that only had USING.
-- Without WITH CHECK, the post-update row is not re-validated, so a user could
-- mutate a row they own into a shape that no longer satisfies the predicate
-- (e.g. reassign conversation_id / group ownership). Mirror USING into
-- WITH CHECK for defense-in-depth. Owner stays the owner; no behavior change.
-- ---------------------------------------------------------------------------

-- messages: sender + participant of the conversation.
DROP POLICY IF EXISTS "rls_messages_update" ON public.messages;
CREATE POLICY "rls_messages_update" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    (sender_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_1 = (SELECT auth.uid()) OR c.participant_2 = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    (sender_id = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND (c.participant_1 = (SELECT auth.uid()) OR c.participant_2 = (SELECT auth.uid()))
    )
  );

-- ranking_collaborations: members of the group, or the owner.
DROP POLICY IF EXISTS "Members can update group status" ON public.ranking_collaborations;
CREATE POLICY "Members can update group status" ON public.ranking_collaborations
  FOR UPDATE
  USING (
    (id IN (SELECT public.get_my_all_group_ids())) OR (owner_id = auth.uid())
  )
  WITH CHECK (
    (id IN (SELECT public.get_my_all_group_ids())) OR (owner_id = auth.uid())
  );

-- storage: business banner / logo updates stay in the caller's own folder.
DROP POLICY IF EXISTS "Users can update own business banners" ON storage.objects;
CREATE POLICY "Users can update own business banners" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-banners' AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'business-banners' AND (auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own business logos" ON storage.objects;
CREATE POLICY "Users can update own business logos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-logos' AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'business-logos' AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- 4. Constrain storage uploads to images (+ PDF for academic planners) and a
-- size cap, enforced by the storage layer itself. Folder scoping already
-- prevents cross-user writes; this stops a user from stashing arbitrary file
-- types in their own folder of a public-read bucket. UPDATE (not policy) so it
-- is a no-op for any bucket that doesn't exist in a given environment.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
    ],
    file_size_limit = 10485760  -- 10 MB
WHERE id IN (
  'avatars',
  'setup-photos',
  'business-banners',
  'business-logos',
  'marketplace-images',
  'roommate-post-photos',
  'dorm-photos'
);

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
      'application/pdf'
    ],
    file_size_limit = 15728640  -- 15 MB
WHERE id = 'academic-planners';
