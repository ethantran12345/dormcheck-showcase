-- Security Pass 2c hardening.
-- 1. Lock profiles SELECT to own row; cross-user reads go through the
--    column-restricted public_profiles view (owner-rights enforcement boundary).
-- 2. Remove anon access to profiles and dorm_future_residents.
-- 3. Gate checklist_items INSERT and clone_personal_to_group on group membership.
-- 4. Revoke client EXECUTE on drop_all_policies_for_table.
-- 5. Add auth guard to get_setup_comment_likes.
-- 6. Enforce {auth.uid()}/ folder prefix on storage INSERT policies for
--    business-banners, business-logos, marketplace-images, roommate-post-photos.

-- ---------------------------------------------------------------------------
-- 1. profiles: own-row SELECT only. Drops the two USING (true) policies
-- ("Public profiles are viewable by everyone" applied to all roles including
-- anon; "rls_profiles_select" applied to authenticated).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "rls_profiles_select" ON public.profiles;

CREATE POLICY "rls_profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

-- Baseline granted ALL on profiles to anon. Remove it entirely; anon has no
-- legitimate path to profiles (auth is @pitt.edu gated).
REVOKE ALL ON TABLE public.profiles FROM anon;

-- ---------------------------------------------------------------------------
-- 2. public_profiles: recreate WITHOUT security_invoker so the view reads with
-- owner (postgres) rights and acts as the column-restriction boundary.
-- Exposes only fields needed by cross-user features (roommate matching cards,
-- DM/group member names+avatars, user search, contact reveal). Excludes:
-- email_notifications, is_admin, has_completed_onboarding, venmo_username,
-- zelle_info, home_layout, current_floor, current_room.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT
  id,
  full_name,
  email,
  avatar_url,
  pronouns,
  major,
  school,
  grade_level,
  graduation_year,
  graduation_semester,
  bio,
  tags,
  profile_photos,
  cleanliness,
  social_level,
  study_style,
  guests,
  guest_preference,
  sleep,
  sleep_habit,
  smoking,
  temp,
  temp_preference,
  conflict_style,
  dealbreakers,
  instagram_username,
  snapchat_username,
  phone_number,
  is_public,
  is_roommate_searching,
  current_dorm,
  housing_type,
  neighborhood,
  preferred_areas,
  created_at
FROM public.profiles;

ALTER VIEW public.public_profiles OWNER TO postgres;

REVOKE ALL ON public.public_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_profiles TO service_role;

-- ---------------------------------------------------------------------------
-- 3. dorm_future_residents: feature shows future residents to signed-in users,
-- but anon enumeration of (user_id, dorm_id, year) has no product purpose.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "dorm_future_residents_select_anon" ON public.dorm_future_residents;
REVOKE ALL ON TABLE public.dorm_future_residents FROM anon;

-- ---------------------------------------------------------------------------
-- 4. checklist_items INSERT: rows targeting a group require accepted
-- membership in that group (previously only user_id = auth.uid()).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "rls_checklist_items_insert" ON public.checklist_items;
CREATE POLICY "rls_checklist_items_insert"
ON public.checklist_items
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = user_id
  AND (
    group_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.ranking_group_members rgm
      WHERE rgm.group_id = checklist_items.group_id
        AND rgm.user_id = (SELECT auth.uid())
        AND rgm.status = 'accepted'
    )
  )
);

-- ---------------------------------------------------------------------------
-- 5. clone_personal_to_group: require auth + accepted membership in the
-- target group before cloning. Also clear anon EXECUTE from baseline.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_personal_to_group(target_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ranking_group_members rgm
    WHERE rgm.group_id = target_group_id
      AND rgm.user_id = auth.uid()
      AND rgm.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Not authorized to clone into this group';
  END IF;

  INSERT INTO public.checklist_items (user_id, category, item, is_checked, is_custom, group_id)
  SELECT
    auth.uid(),
    category,
    item,
    FALSE,
    is_custom,
    target_group_id
  FROM public.checklist_items
  WHERE user_id = auth.uid()
    AND group_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.checklist_items WHERE group_id = target_group_id
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.clone_personal_to_group(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clone_personal_to_group(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. drop_all_policies_for_table: DDL utility, never client-callable.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.drop_all_policies_for_table(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. get_setup_comment_likes: SECURITY DEFINER requires an explicit
-- auth.uid() check in the body.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_setup_comment_likes(p_setup_id bigint, p_author_id uuid)
RETURNS TABLE (comment_id bigint, like_count bigint, liked_by_me boolean, liked_by_author boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    cl.comment_id,
    count(*) AS like_count,
    bool_or(cl.user_id = auth.uid()) AS liked_by_me,
    bool_or(p_author_id IS NOT NULL AND cl.user_id = p_author_id) AS liked_by_author
  FROM public.setup_comment_likes cl
  JOIN public.setup_comments c ON c.id = cl.comment_id
  WHERE c.setup_id = p_setup_id
  GROUP BY cl.comment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_setup_comment_likes(bigint, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_setup_comment_likes(bigint, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Storage INSERT policies: enforce per-user folder prefix. All client
-- upload paths already use `${user.id}/...` for these buckets.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can upload business banners" ON storage.objects;
CREATE POLICY "Authenticated users can upload business banners"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-banners'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Authenticated users can upload business logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload business logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-logos'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Authenticated users can upload marketplace images" ON storage.objects;
CREATE POLICY "Authenticated users can upload marketplace images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Authenticated users can upload roommate post photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload roommate post photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'roommate-post-photos'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);
