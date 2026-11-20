-- Multi-university step 3: tenant isolation (the load-bearing migration).
-- Pattern: RESTRICTIVE policies that AND with the existing permissive policies, so ownership,
-- moderation, and SEC-6 column-grant behavior is untouched. Anon (public-role) policies are
-- deliberately left alone: logged-out browsing of the public housing catalog / approved business
-- listings keeps working; per-tenant anon scoping is a flip-time product decision, not a leak of
-- private data. current_university_id() and is_superadmin() already exist (SECURITY DEFINER).
-- Rollback: DROP POLICY tenant_isolation ON <each table>; DROP POLICY tenant_confined ON
-- conversations/group_members/ranking_group_members; restore prior view + function definitions
-- (captured in git history of this file's predecessors / pg_get_viewdef before apply).

-- === 3.A Root tables (11): rows visible/writable only within the caller's university ===
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'building_chat_links','buildings','business_listings','course_sections',
    'dorm_questions','explore_picks','marketplace_listings','master_housing',
    'ranking_collaborations','roommate_search_posts','student_setups'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON public.%I;
       CREATE POLICY tenant_isolation ON public.%I
         AS RESTRICTIVE FOR ALL TO authenticated
         USING (university_id = public.current_university_id() OR public.is_superadmin())
         WITH CHECK (university_id = public.current_university_id() OR public.is_superadmin());',
      t, t
    );
  END LOOP;
END $$;

-- === 3.B Directly-listable children (SELECT qual was `true`): inherit the parent's tenant
--     filter via an EXISTS whose subquery is itself subject to the parent's RLS. Children whose
--     existing policies already walk the parent FK (marketplace_listing_items, dorm_edits,
--     building_chat_link_reports, roommate_search_interests, group_dorm_rankings) inherit
--     isolation automatically and get no new policy. ===
DROP POLICY IF EXISTS tenant_isolation ON public.dorm_answers;
CREATE POLICY tenant_isolation ON public.dorm_answers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dorm_questions q WHERE q.id = dorm_answers.question_id));

DROP POLICY IF EXISTS tenant_isolation ON public.dorm_question_upvotes;
CREATE POLICY tenant_isolation ON public.dorm_question_upvotes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.dorm_questions q WHERE q.id = dorm_question_upvotes.question_id));

DROP POLICY IF EXISTS tenant_isolation ON public.dorm_future_residents;
CREATE POLICY tenant_isolation ON public.dorm_future_residents
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.master_housing m WHERE m.id = dorm_future_residents.dorm_id));

DROP POLICY IF EXISTS tenant_isolation ON public.setup_photos;
CREATE POLICY tenant_isolation ON public.setup_photos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_setups s WHERE s.id = setup_photos.setup_id));

DROP POLICY IF EXISTS tenant_isolation ON public.setup_products;
CREATE POLICY tenant_isolation ON public.setup_products
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_setups s WHERE s.id = setup_products.setup_id));

DROP POLICY IF EXISTS tenant_isolation ON public.setup_comments;
CREATE POLICY tenant_isolation ON public.setup_comments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_setups s WHERE s.id = setup_comments.setup_id));

DROP POLICY IF EXISTS tenant_isolation ON public.setup_likes;
CREATE POLICY tenant_isolation ON public.setup_likes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.student_setups s WHERE s.id = setup_likes.setup_id));

-- seller_ratings has no university column; scope by the rated seller's university.
DROP POLICY IF EXISTS tenant_isolation ON public.seller_ratings;
CREATE POLICY tenant_isolation ON public.seller_ratings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles sp
      WHERE sp.id = seller_ratings.seller_id
        AND sp.university_id = public.current_university_id()
    )
    OR public.is_superadmin()
  );

-- === 3.D Social graph: CONFINED at creation (no cross-university DMs / group joins).
--     Reads stay participant-gated by the existing policies; since single-tenant history means
--     no cross-tenant pairs exist, creation-time confinement is sufficient and keeps the hot
--     message read path free of extra subqueries. ===
DROP POLICY IF EXISTS tenant_confined ON public.conversations;
CREATE POLICY tenant_confined ON public.conversations
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT p1.university_id FROM public.profiles p1 WHERE p1.id = participant_1)
    = (SELECT p2.university_id FROM public.profiles p2 WHERE p2.id = participant_2)
  );

DROP POLICY IF EXISTS tenant_confined ON public.group_members;
CREATE POLICY tenant_confined ON public.group_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT jp.university_id FROM public.profiles jp WHERE jp.id = group_members.user_id)
    = (SELECT cp.university_id
       FROM public.group_conversations gc
       JOIN public.profiles cp ON cp.id = gc.created_by
       WHERE gc.id = group_members.group_id)
  );

DROP POLICY IF EXISTS tenant_confined ON public.ranking_group_members;
CREATE POLICY tenant_confined ON public.ranking_group_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT mp.university_id FROM public.profiles mp WHERE mp.id = ranking_group_members.user_id)
    = (SELECT rc.university_id FROM public.ranking_collaborations rc
       WHERE rc.id = ranking_group_members.group_id)
  );

-- === Helper fix: building membership matched by residence-hall NAME only (SECURITY DEFINER,
--     bypasses RLS) — a CMU hall sharing a name with a Pitt hall would cross tenants. ===
CREATE OR REPLACE FUNCTION public.user_current_dorm_matches_building(b_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.master_housing m ON m.id = b_id
    WHERE p.id = auth.uid()
      AND p.housing_type = 'on-campus'
      AND m.university_id = p.university_id
      AND lower(btrim(regexp_replace(coalesce(p.current_dorm, ''), '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(m.residence_hall, ''), '\s+', ' ', 'g')))
  );
$function$;

-- === Views (definer-style, so they bypass base-table RLS and need explicit filters).
--     roommate_profiles already self-scopes (20260709000000) — untouched. ===

-- public_profiles: identity source; scope to same-university OR self OR superadmin.
-- Supersedes the 2026-06-30 "unfiltered identity" call — safe under the confined social graph.
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
SELECT id, full_name, avatar_url, pronouns, major, school, grade_level, graduation_year,
       graduation_semester, bio, tags, profile_photos, cleanliness, social_level, study_style,
       guests, guest_preference, sleep, sleep_habit, smoking, temp, temp_preference,
       conflict_style, dealbreakers, instagram_username, snapchat_username, is_public,
       is_roommate_searching, current_dorm, housing_type, neighborhood, preferred_areas, created_at
FROM public.profiles p
WHERE p.id = (SELECT auth.uid())
   OR p.university_id IS NOT DISTINCT FROM
      (SELECT pr.university_id FROM public.profiles pr WHERE pr.id = (SELECT auth.uid()))
   OR public.is_superadmin();

-- marketplace_listings_contact: definer over marketplace_listings; mirror the root filter.
DROP VIEW IF EXISTS public.marketplace_listings_contact;
CREATE VIEW public.marketplace_listings_contact AS
SELECT id,
       CASE WHEN show_phone OR user_id = auth.uid() THEN phone_number ELSE NULL::text END AS phone_number,
       CASE WHEN show_instagram OR user_id = auth.uid() THEN instagram_handle ELSE NULL::text END AS instagram_handle,
       CASE WHEN show_snapchat OR user_id = auth.uid() THEN snapchat_handle ELSE NULL::text END AS snapchat_handle
FROM public.marketplace_listings
WHERE university_id = public.current_university_id()
   OR user_id = auth.uid()
   OR public.is_superadmin();

-- seller_rating_stats: aggregate scoped by the seller's university.
DROP VIEW IF EXISTS public.seller_rating_stats;
CREATE VIEW public.seller_rating_stats AS
SELECT seller_id, round(avg(stars), 1) AS avg_stars, count(*)::integer AS rating_count
FROM public.seller_ratings sr
WHERE EXISTS (
  SELECT 1 FROM public.profiles sp
  WHERE sp.id = sr.seller_id
    AND (sp.university_id = public.current_university_id() OR public.is_superadmin())
)
GROUP BY seller_id;

GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.marketplace_listings_contact TO authenticated;
GRANT SELECT ON public.seller_rating_stats TO authenticated;
