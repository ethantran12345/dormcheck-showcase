-- Feature: RA as a per-group member who can pin (NOT a new app role).
-- Expand-only. RA is a per-`group_members` attribute; a group carries at most
-- one pinned message. Enforcement is SECURITY DEFINER RPCs (mirrors
-- clear_group_checklist), deliberately NOT a column-scoped UPDATE policy
-- (Postgres has no column-level UPDATE RLS) and NOT the existing creator-only
-- UPDATE policy (system-seeded building chats have created_by = NULL, so no one
-- satisfies it - the RPC is the sole gate).
--
-- No new app_role enum value, no self-serve RA flow: RA is seeded by the
-- operator (superadmin) only. RA of group X has zero elevated rights in group Y.
-- PROD APPLY: local Docker adversarial test -> apply_migration to remote -> commit.

-- ---------------------------------------------------------------------------
-- 1. Schema (expand-only, additive nullable/defaulted columns)
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'ra'));

ALTER TABLE public.group_conversations
  ADD COLUMN IF NOT EXISTS pinned_message_id uuid
    REFERENCES public.group_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. Per-group RA membership helper (mirrors is_chat_group_member).
--    SECURITY DEFINER so it can read group_members regardless of the caller's
--    row-level visibility; auth.uid() still resolves to the real caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_group_ra(p_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id
      AND user_id = auth.uid()
      AND role = 'ra'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_group_ra(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_group_ra(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pin / unpin. Only an RA of THAT group may set/clear its pin, and the
--    pinned message must belong to that same group.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_group_pin(p_group_id uuid, p_message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_group_ra(p_group_id) THEN
    RAISE EXCEPTION 'Not authorized: must be an RA of this group';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_messages
    WHERE id = p_message_id AND group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'Message does not belong to this group';
  END IF;

  UPDATE public.group_conversations
     SET pinned_message_id = p_message_id,
         pinned_at = now(),
         pinned_by = v_uid
   WHERE id = p_group_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_group_pin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_pin(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_group_pin(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.is_group_ra(p_group_id) THEN
    RAISE EXCEPTION 'Not authorized: must be an RA of this group';
  END IF;

  UPDATE public.group_conversations
     SET pinned_message_id = NULL,
         pinned_at = NULL,
         pinned_by = NULL
   WHERE id = p_group_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_group_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_group_pin(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Operator seeding: superadmin-only. Promote/demote an EXISTING member of a
--    group to/from RA. Rejects a target who is not already a member. Writes an
--    append-only admin_audit_log row for the grant/revoke.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_group_member_ra(
  p_group_id uuid,
  p_user_id uuid,
  p_is_ra boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows int;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Not authorized: superadmin only';
  END IF;

  UPDATE public.group_members
     SET role = CASE WHEN p_is_ra THEN 'ra' ELSE 'member' END
   WHERE group_id = p_group_id
     AND user_id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Target user is not a member of this group';
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
  VALUES (
    auth.uid(),
    CASE WHEN p_is_ra THEN 'grant_ra' ELSE 'revoke_ra' END,
    'group_member',
    p_user_id,
    (SELECT university_id FROM public.profiles WHERE id = p_user_id)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_group_member_ra(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_member_ra(uuid, uuid, boolean) TO authenticated;
