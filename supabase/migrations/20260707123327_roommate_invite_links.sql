-- Roommate confirmation by shared link (move-in front door, handoff 1b).
-- Expand-only. Adds a rotatable invite_code to collaboration groups plus
-- SECURITY DEFINER RPCs so a student can text a link and the roommate can
-- preview + join without a pre-existing pending member row. Distinct from the
-- group id so links are revocable (rotate) without destroying the group.
-- University-scoped and block-aware, mirroring 20260711000000's gating style.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260711000000.

ALTER TABLE public.ranking_collaborations
  ADD COLUMN invite_code uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX ranking_collaborations_invite_code_key
  ON public.ranking_collaborations (invite_code);

-- Minimal pre-join preview for anyone with the link (same-university only).
CREATE FUNCTION public.get_group_invite_preview(p_code uuid)
RETURNS TABLE (
  group_id uuid,
  group_name text,
  group_type text,
  dorm_name text,
  owner_name text,
  member_count integer,
  caller_status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    c.group_name,
    c.group_type,
    c.dorm_name,
    op.full_name,
    (SELECT count(*)::integer FROM public.ranking_group_members m
      WHERE m.group_id = c.id AND m.status = 'accepted'),
    (SELECT m2.status FROM public.ranking_group_members m2
      WHERE m2.group_id = c.id AND m2.user_id = auth.uid()
      LIMIT 1)
  FROM public.ranking_collaborations c
  LEFT JOIN public.profiles op ON op.id = c.owner_id
  WHERE c.invite_code = p_code
    AND auth.uid() IS NOT NULL
    AND c.university_id IS NOT DISTINCT FROM
        (SELECT pr.university_id FROM public.profiles pr WHERE pr.id = auth.uid());
$$;

-- Join a group via its invite link. Upgrades an existing pending row
-- (old search-and-email flow) to accepted; otherwise inserts a new
-- accepted collaborator row. Errors: invalid_code / wrong_university / blocked.
CREATE FUNCTION public.join_group_via_invite(p_code uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_group public.ranking_collaborations%ROWTYPE;
  v_caller_university uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_group
  FROM public.ranking_collaborations
  WHERE invite_code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_code';
  END IF;

  SELECT university_id INTO v_caller_university
  FROM public.profiles WHERE id = v_uid;
  IF v_group.university_id IS DISTINCT FROM v_caller_university THEN
    RAISE EXCEPTION 'wrong_university';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v_uid AND b.blocked_id = v_group.owner_id)
       OR (b.blocker_id = v_group.owner_id AND b.blocked_id = v_uid)
  ) THEN
    RAISE EXCEPTION 'blocked';
  END IF;

  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (v_group.id, v_uid, 'accepted', 'collaborator')
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET status = 'accepted'
  WHERE public.ranking_group_members.role <> 'owner';

  RETURN v_group.id;
END;
$$;

-- Owner-only rotation: invalidates every previously shared link.
CREATE FUNCTION public.rotate_group_invite_code(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new uuid := gen_random_uuid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.ranking_collaborations
  SET invite_code = v_new
  WHERE id = p_group_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_group_invite_preview(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.join_group_via_invite(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rotate_group_invite_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_invite_preview(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_group_via_invite(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rotate_group_invite_code(uuid) TO authenticated, service_role;
