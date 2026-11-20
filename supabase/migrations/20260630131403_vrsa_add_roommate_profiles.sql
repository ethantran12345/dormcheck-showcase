-- Pitt VRSA hardening - public_profiles opt-out, STEP 1 of 2 (EXPAND)
-- Triage: git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06) (P0 #1/#2, Option A). Rollback: docs/audits/pitt-vrsa-rollback.md
--
-- Expand/contract migration (zero-downtime). This is the EXPAND half: it ADDS the
-- discovery view `roommate_profiles` and LEAVES `public_profiles` unchanged (full),
-- so old code (reading rich fields from public_profiles) AND new code (reading
-- roommate_profiles + only identity cols from public_profiles) both work. Ship this
-- + the code together. The sensitive columns are removed from public_profiles only
-- in the CONTRACT step (20260630030000), after prod is verified working.
--
-- roommate_profiles carries the DISCOVERY tier (bio, roommate-match fields, socials,
-- dorm, prefs), filtered `is_public = true OR own` - opt-out students' discovery
-- data is not enumerable. SECURITY DEFINER (the profiles base table is own-row-only
-- RLS); the resulting security_definer_view advisor ERROR is accepted (see triage).

CREATE VIEW public.roommate_profiles AS
  SELECT
    id, full_name, avatar_url, pronouns, major, school, grade_level,
    graduation_year, graduation_semester, bio, tags, profile_photos,
    cleanliness, social_level, study_style, guests, guest_preference,
    sleep, sleep_habit, smoking, temp, temp_preference, conflict_style,
    dealbreakers, instagram_username, snapchat_username, is_public,
    is_roommate_searching, current_dorm, housing_type, neighborhood,
    preferred_areas, created_at
  FROM public.profiles
  WHERE is_public = true OR id = (SELECT auth.uid());

REVOKE ALL ON public.roommate_profiles FROM anon, public;
GRANT SELECT ON public.roommate_profiles TO authenticated;
