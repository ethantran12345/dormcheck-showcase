-- Tier 2 approved fixes (server side):
--
-- a. delete_group_message(): a university_admin could delete messages in ANY
--    school's group chat — the admin check was global is_admin with no tenant
--    match. Now the acting admin's university must equal the group's university
--    (derived from the group's building, falling back to the creator's
--    university for non-building groups). Superadmin is exempt. RA path is
--    unchanged (RAs are members of the group by construction).
--
-- c. estimate_ad_reach(): drop the p_dorms parameter. It let an advertiser
--    narrow the k-anonymity floor along a dimension the UI never exposes
--    (the client always passed null). Removing the parameter removes the
--    slicing surface entirely.

-- Group → university, SECURITY DEFINER so the lookup is not gated by the
-- invoker's RLS on master_housing/group_conversations/profiles.
-- group_conversations.building_id is a bigint FK to master_housing(id), NOT
-- public.buildings (uuid) — prod rejected the buildings join with
-- `uuid = bigint` (2026-08-02).
CREATE OR REPLACE FUNCTION public.group_university(p_group_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(mh.university_id, public.profile_university(g.created_by))
  FROM public.group_conversations g
  LEFT JOIN public.master_housing mh ON mh.id = g.building_id
  WHERE g.id = p_group_id;
$$;

CREATE OR REPLACE FUNCTION public.delete_group_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_group_id uuid;
  v_is_admin boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT group_id INTO v_group_id
  FROM public.group_messages
  WHERE id = p_message_id;
  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  SELECT coalesce(p.is_admin, false) INTO v_is_admin
  FROM public.profiles p WHERE p.id = v_uid;

  -- Admins moderate only their own university's groups; superadmin is global.
  IF NOT (
    public.is_superadmin()
    OR (v_is_admin AND public.group_university(v_group_id) = public.profile_university(v_uid))
    OR public.is_group_ra(v_group_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized: must be an RA of this room or an admin of its university';
  END IF;

  DELETE FROM public.group_messages WHERE id = p_message_id;
END;
$$;

-- Parameter removal changes the signature, so drop the old function first.
DROP FUNCTION IF EXISTS public.estimate_ad_reach(uuid, integer[], text[]);

CREATE FUNCTION public.estimate_ad_reach(p_university uuid, p_class_years integer[] DEFAULT NULL::integer[])
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  k constant integer := 50;
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO n
  FROM public.profiles p
  WHERE p.university_id = p_university
    AND (p_class_years IS NULL OR cardinality(p_class_years) = 0
         OR p.graduation_year = ANY(p_class_years));
  IF n < k THEN
    RETURN NULL;
  END IF;
  RETURN n;
END;
$$;
