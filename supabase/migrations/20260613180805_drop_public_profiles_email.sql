-- Phase 6: remove email from public_profiles. Cross-user email reads now go through
-- search_users RPC (own profiles table path for notifications). phone_number stays.

DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT
  id,
  full_name,
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

COMMENT ON VIEW public.public_profiles IS
  'Intentional owner-rights (non-security_invoker) view. Reads with postgres '
  'privileges to expose a column-restricted subset of profiles for cross-user '
  'features (roommate cards, DMs, search). Full profiles remain own-row SELECT '
  'only via RLS on public.profiles; do not recreate with security_invoker.';
