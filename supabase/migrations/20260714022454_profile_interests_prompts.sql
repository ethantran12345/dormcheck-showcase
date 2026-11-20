-- Profile & Onboarding lean spec, Phase 2: optional profile enrichment.
--
-- Adds two OPTIONAL, user-facing personality/lifestyle dimensions to profiles:
--   * interests text[]  - canonical interest slugs from a capped taxonomy
--                         (src/lib/interestOptions.ts). A SEPARATE dimension
--                         from profiles.tags (habit chips) and the internal
--                         `onboarding_interest:`-prefixed signal tags - never
--                         collide with either namespace.
--   * prompts   jsonb   - array of { "prompt": text, "answer": text }, max 3,
--                         display-only (no per-prompt querying), so a column
--                         beats a child table (no new RLS surface).
--
-- These are lifestyle color only, NOT matching-algorithm inputs and NOT
-- protected-class data (see the 2026-07-14 lifestyle-only-matching decision).
--
-- Expand-only + reversible: both columns are nullable with no default; existing
-- rows are unaffected. Own-row writes ride the existing profiles UPDATE RLS
-- (rls_profiles_update) - no new policy needed.
--
-- Rollback:
--   DROP VIEW public.roommate_profiles;  -- then recreate from 20260709000000
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS prompts, DROP COLUMN IF EXISTS interests;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interests text[],
  ADD COLUMN IF NOT EXISTS prompts jsonb;

COMMENT ON COLUMN public.profiles.interests IS
  'Optional user-facing interest slugs (Phase 2 profile enrichment). Separate dimension from tags / the onboarding_interest: namespace. Not a matching input.';
COMMENT ON COLUMN public.profiles.prompts IS
  'Optional array of {prompt, answer} objects (max 3), display-only profile prompts. Not a matching input.';

-- Expose both on the roommate discovery view so the roommate card / detail modal
-- can render them (they are roommate-visible personality color, gated by the
-- view's existing is_public + same-university WHERE clause). public_profiles
-- stays identity-only (slimmed in 20260630030000); these do NOT belong there.
--
-- DROP + CREATE (not CREATE OR REPLACE - column list grows mid-view). This
-- reproduces 20260709000000_roommate_profiles_university.sql verbatim plus the
-- two new trailing columns, and re-issues the same grants. No dependent DB
-- objects (client reads only). SECURITY DEFINER / security_definer_view advisor
-- ERROR remains accepted (git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06)).

DROP VIEW public.roommate_profiles;

CREATE VIEW public.roommate_profiles AS
  SELECT
    p.id, p.full_name, p.avatar_url, p.pronouns, p.major, p.school, p.grade_level,
    p.graduation_year, p.graduation_semester, p.bio, p.tags, p.profile_photos,
    p.cleanliness, p.social_level, p.study_style, p.guests, p.guest_preference,
    p.sleep, p.sleep_habit, p.smoking, p.temp, p.temp_preference, p.conflict_style,
    p.dealbreakers, p.instagram_username, p.snapchat_username, p.is_public,
    p.is_roommate_searching, p.current_dorm, p.housing_type, p.neighborhood,
    p.preferred_areas, p.created_at, p.university_id,
    p.interests, p.prompts
  FROM public.profiles p
  WHERE (p.is_public = true OR p.id = (SELECT auth.uid()))
    AND (
      p.id = (SELECT auth.uid())
      OR p.university_id IS NOT DISTINCT FROM
         (SELECT pr.university_id FROM public.profiles pr WHERE pr.id = (SELECT auth.uid()))
    );

REVOKE ALL ON public.roommate_profiles FROM anon, public;
GRANT SELECT ON public.roommate_profiles TO authenticated;
