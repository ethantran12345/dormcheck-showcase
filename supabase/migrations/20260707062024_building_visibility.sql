-- Building visibility: opt-in resident directory for the Your Dorm hub (Phase A).
-- Expand-only. Passive population from profiles.current_dorm; explicit opt-in
-- (show_in_building, default false) so non-opted-in users are never enumerable.
-- Mirrors get_building_chats gating (only residents of a building can list its
-- residents) and the roommate_profiles privacy tiering (identity columns only,
-- own row always visible, university-scoped).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260710000000.

ALTER TABLE public.profiles
  ADD COLUMN show_in_building boolean NOT NULL DEFAULT false,
  ADD COLUMN move_in_date date;

-- Own-row profiles RLS already covers reads/writes of both columns.

CREATE FUNCTION public.get_building_residents(b_id bigint)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  current_floor text,
  move_in_date date,
  is_self boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.full_name, p.avatar_url, p.current_floor, p.move_in_date,
    (p.id = auth.uid()) AS is_self
  FROM public.profiles p
  JOIN public.master_housing m ON m.id = b_id
  WHERE user_current_dorm_matches_building(b_id)
    AND p.housing_type = 'on-campus'
    AND lower(btrim(regexp_replace(coalesce(p.current_dorm, ''), '\s+', ' ', 'g')))
      = lower(btrim(regexp_replace(coalesce(m.residence_hall, ''), '\s+', ' ', 'g')))
    AND (p.show_in_building = true OR p.id = auth.uid())
    AND (
      p.id = auth.uid()
      OR p.university_id IS NOT DISTINCT FROM
         (SELECT pr.university_id FROM public.profiles pr WHERE pr.id = auth.uid())
    )
  ORDER BY p.current_floor NULLS LAST, p.full_name;
$$;

REVOKE EXECUTE ON FUNCTION public.get_building_residents(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_building_residents(bigint) TO authenticated, service_role;
