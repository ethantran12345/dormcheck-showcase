-- Roommate matching prep - scope the roommate_profiles discovery view to the
-- viewer's university (multi-university groundwork: 20260707000000 added
-- profiles.university_id, backfilled legacy rows to Pitt).
--
-- Expand-style: DROP + CREATE (column list changes; CREATE OR REPLACE can't add
-- columns mid-list). View has no dependent DB objects - only client reads.
-- Grants re-issued after the drop.
--
-- The university filter lives IN the view so every reader (browse, liked list,
-- DM roommate card) inherits it with no client change. IS NOT DISTINCT FROM is
-- NULL-safe: two NULL university_ids still match (pre-backfill safety).
--
-- SECURITY DEFINER as before (profiles base table is own-row-only RLS); the
-- security_definer_view advisor ERROR remains accepted (git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06)).

DROP VIEW public.roommate_profiles;

CREATE VIEW public.roommate_profiles AS
  SELECT
    p.id, p.full_name, p.avatar_url, p.pronouns, p.major, p.school, p.grade_level,
    p.graduation_year, p.graduation_semester, p.bio, p.tags, p.profile_photos,
    p.cleanliness, p.social_level, p.study_style, p.guests, p.guest_preference,
    p.sleep, p.sleep_habit, p.smoking, p.temp, p.temp_preference, p.conflict_style,
    p.dealbreakers, p.instagram_username, p.snapchat_username, p.is_public,
    p.is_roommate_searching, p.current_dorm, p.housing_type, p.neighborhood,
    p.preferred_areas, p.created_at, p.university_id
  FROM public.profiles p
  WHERE (p.is_public = true OR p.id = (SELECT auth.uid()))
    AND (
      p.id = (SELECT auth.uid())
      OR p.university_id IS NOT DISTINCT FROM
         (SELECT pr.university_id FROM public.profiles pr WHERE pr.id = (SELECT auth.uid()))
    );

REVOKE ALL ON public.roommate_profiles FROM anon, public;
GRANT SELECT ON public.roommate_profiles TO authenticated;
