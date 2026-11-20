-- Feature: building-chat auto-provision (lazy) + system-owned chats.
-- Expand-only. Gives every VISITED building a canonical building-wide chat so a
-- resident always has a room to join, without front-loading empty rooms into
-- prod (no mass backfill - that stays a deliberate one-shot). Floor rooms stay
-- lazy (created on first joiner via the existing useCreateBuildingChat path).
--
-- Tenant safety is inherited, not re-implemented: user_current_dorm_matches_building
-- already requires m.university_id = p.university_id, and both get_building_chats
-- and the group_conversations SELECT policy gate visibility on that function - so
-- more rows can never leak across universities.
-- PROD APPLY: local Docker adversarial test -> apply_migration to remote -> commit.

-- ---------------------------------------------------------------------------
-- 1. System-owned chats: allow a NULL creator.
--    Existing client code always sets created_by, so this is backward-compatible.
--    The creator-only group_conversations UPDATE policy with created_by = NULL
--    simply means "no one passes it" - intended for system rooms (pins go through
--    the RA RPCs; there is no per-row owner to update name/etc).
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_conversations
  ALTER COLUMN created_by DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. ensure_building_chat(b_id): idempotently return the building-wide chat for
--    a building, creating a system-owned one (created_by = NULL) on first call.
--    Only a resident of that building (same university, per
--    user_current_dorm_matches_building) may trigger creation; a non-resident
--    caller gets the existing room if any, else NULL (never creates).
--    Idempotent + concurrency-safe via the uniq_group_conv_building_wide partial
--    unique index.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_building_chat(b_id bigint)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  -- Existing building-wide chat wins (visibility is gated separately by RLS).
  SELECT id INTO v_id
  FROM public.group_conversations
  WHERE building_id = b_id AND floor IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Only a resident of this building may cause creation.
  IF NOT public.user_current_dorm_matches_building(b_id) THEN
    RETURN NULL;
  END IF;

  SELECT residence_hall INTO v_name
  FROM public.master_housing
  WHERE id = b_id;
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.group_conversations (name, created_by, building_id, floor)
  VALUES (v_name, NULL, b_id, NULL)
  ON CONFLICT (building_id) WHERE (building_id IS NOT NULL AND floor IS NULL)
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost a concurrent insert race; return the winner.
    SELECT id INTO v_id
    FROM public.group_conversations
    WHERE building_id = b_id AND floor IS NULL;
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_building_chat(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_building_chat(bigint) TO authenticated;
