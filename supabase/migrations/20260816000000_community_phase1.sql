-- Feature: Community Phase 1 - floor rooms, auto-join on housing confirm,
-- welcome seed, leave opt-out memory, group-message moderation.
-- Expand-only. Tenant safety is inherited, not reimplemented:
-- user_current_dorm_matches_building gates every creation/join path here, same
-- as ensure_building_chat / get_building_chats.
-- PROD APPLY: local Docker adversarial test -> apply_migration to remote -> commit.

-- ---------------------------------------------------------------------------
-- 1. System welcome messages need a system sender: allow NULL sender_id.
--    Existing client code always sets sender_id; NULL renders as "DormCheck".
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_messages
  ALTER COLUMN sender_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Leave memory: a user who leaves a community room is never silently
--    re-added by a later housing confirm. Row exists = "do not auto-join me".
--    Class C (user-owned): every row is scoped to auth.uid().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_room_optouts (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.group_conversations(id) ON DELETE CASCADE,
  left_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, group_id)
);
ALTER TABLE public.community_room_optouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_community_room_optouts_select ON public.community_room_optouts
  FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY rls_community_room_optouts_insert ON public.community_room_optouts
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY rls_community_room_optouts_delete ON public.community_room_optouts
  FOR DELETE USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.community_room_optouts FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.community_room_optouts TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Welcome seed helper (internal; no grants). Seeds exactly one system
--    message into a just-created room and mirrors it to last_message.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_community_welcome(p_group_id uuid, p_room_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_welcome text;
BEGIN
  v_welcome := 'Welcome to the ' || p_room_name || ' room! Say hi to your neighbors - '
    || 'this space is for everyone living here.';
  INSERT INTO public.group_messages (group_id, sender_id, content)
  VALUES (p_group_id, NULL, v_welcome);
  UPDATE public.group_conversations
     SET last_message = v_welcome, updated_at = now()
   WHERE id = p_group_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.seed_community_welcome(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ensure_floor_chat(b_id, p_floor): mirror of ensure_building_chat for a
--    floor room. Floor is normalized server-side exactly like the client's
--    normalizeFloor (collapse whitespace, trim, lowercase). Only a resident of
--    that building may trigger creation; idempotent + concurrency-safe via
--    uniq_group_conv_building_floor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_floor_chat(b_id bigint, p_floor text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_hall text;
  v_floor text;
  v_name text;
BEGIN
  v_floor := lower(btrim(regexp_replace(coalesce(p_floor, ''), '\s+', ' ', 'g')));
  IF v_floor = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.group_conversations
  WHERE building_id = b_id AND floor = v_floor;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Only a resident of this building may cause creation.
  IF NOT public.user_current_dorm_matches_building(b_id) THEN
    RETURN NULL;
  END IF;

  SELECT residence_hall INTO v_hall
  FROM public.master_housing
  WHERE id = b_id;
  IF v_hall IS NULL THEN
    RETURN NULL;
  END IF;
  v_name := v_hall || ' · Floor ' || v_floor;

  INSERT INTO public.group_conversations (name, created_by, building_id, floor)
  VALUES (v_name, NULL, b_id, v_floor)
  ON CONFLICT (building_id, floor) WHERE (building_id IS NOT NULL AND floor IS NOT NULL)
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Lost a concurrent insert race; return the winner.
    SELECT id INTO v_id
    FROM public.group_conversations
    WHERE building_id = b_id AND floor = v_floor;
  ELSE
    PERFORM public.seed_community_welcome(v_id, v_name);
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_floor_chat(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_floor_chat(bigint, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. ensure_building_chat: unchanged contract, now seeds the welcome message
--    when it is the creator (win path only - existing rooms untouched).
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
  SELECT id INTO v_id
  FROM public.group_conversations
  WHERE building_id = b_id AND floor IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

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
    SELECT id INTO v_id
    FROM public.group_conversations
    WHERE building_id = b_id AND floor IS NULL;
  ELSE
    PERFORM public.seed_community_welcome(v_id, v_name);
  END IF;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_building_chat(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_building_chat(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. join_my_building_rooms(): ensure + join the caller's building room and
--    floor room, derived entirely server-side from the caller's own profile
--    (no building argument -> cannot be pointed at someone else's building).
--    Skips any room the caller previously left (community_room_optouts).
--    Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_my_building_rooms()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_building_id bigint;
  v_floor text;
  v_building_group uuid;
  v_floor_group uuid;
  v_joined_building boolean := false;
  v_joined_floor boolean := false;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve the caller's own building (same normalization as
  -- user_current_dorm_matches_building).
  SELECT m.id, p.current_floor INTO v_building_id, v_floor
  FROM public.profiles p
  JOIN public.master_housing m
    ON lower(btrim(regexp_replace(coalesce(p.current_dorm, ''), '\s+', ' ', 'g')))
     = lower(btrim(regexp_replace(coalesce(m.residence_hall, ''), '\s+', ' ', 'g')))
  WHERE p.id = v_uid
    AND p.housing_type = 'on-campus'
    AND coalesce(p.current_dorm, '') <> ''
  LIMIT 1;

  IF v_building_id IS NULL THEN
    RETURN jsonb_build_object('building_group_id', NULL, 'floor_group_id', NULL);
  END IF;

  v_building_group := public.ensure_building_chat(v_building_id);
  IF v_building_group IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.community_room_optouts
    WHERE user_id = v_uid AND group_id = v_building_group
  ) THEN
    INSERT INTO public.group_members (group_id, user_id)
    VALUES (v_building_group, v_uid)
    ON CONFLICT DO NOTHING;
    v_joined_building := true;
  END IF;

  IF v_floor IS NOT NULL AND btrim(v_floor) <> '' THEN
    v_floor_group := public.ensure_floor_chat(v_building_id, v_floor);
    IF v_floor_group IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.community_room_optouts
      WHERE user_id = v_uid AND group_id = v_floor_group
    ) THEN
      INSERT INTO public.group_members (group_id, user_id)
      VALUES (v_floor_group, v_uid)
      ON CONFLICT DO NOTHING;
      v_joined_floor := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'building_group_id', v_building_group,
    'floor_group_id', v_floor_group,
    'joined_building', v_joined_building,
    'joined_floor', v_joined_floor
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.join_my_building_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_my_building_rooms() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Moderation: group messages become reportable, and an RA of the room or an
--    admin can delete a message. Hard delete (no soft-delete column exists);
--    pinned_message_id clears via its ON DELETE SET NULL FK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS chk_content_type;
ALTER TABLE public.content_reports ADD CONSTRAINT chk_content_type
  CHECK (content_type = ANY (ARRAY[
    'marketplace_listing'::text,
    'roommate_post'::text,
    'building_chat_link'::text,
    'user'::text,
    'seller_rating'::text,
    'student_setup'::text,
    'group_message'::text
  ]));

ALTER TABLE public.moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_content_type_check;
ALTER TABLE public.moderation_actions ADD CONSTRAINT moderation_actions_content_type_check
  CHECK (content_type IN (
    'student_review', 'marketplace_listing', 'roommate_post',
    'building_chat_link', 'user', 'student_setup', 'group_message'
  ));

-- get_content_reports: add group_message preview/owner/context + tenant scope.
-- Body copied from 20260712220421 with the group_message branches added.
create or replace function public.get_content_reports(
  content_type_filter text default null,
  p_university_id uuid default null
)
returns table(
  report_id uuid,
  content_type text,
  content_id uuid,
  reporter_id uuid,
  reporter_name text,
  reason text,
  category text,
  escalated_at timestamptz,
  reported_at timestamptz,
  content_preview_title text,
  content_preview_body text,
  content_owner_id uuid,
  content_owner_name text,
  content_context text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
    cr.category,
    cr.escalated_at,
    cr.created_at AS reported_at,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.title FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT
        CASE rsp.post_type
          WHEN 'looking-for-roommates' THEN 'Looking for roommates'
          WHEN 'have-place-need-people' THEN 'Have a place, need people'
          ELSE 'Roommate post'
        END
        FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT COALESCE(bcl.label, 'Chat link') FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT 'Seller rating: ' || sr.stars || ' of 5 stars' FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT 'Message in ' || gc.name FROM group_messages gm JOIN group_conversations gc ON gc.id = gm.group_id WHERE gm.id = cr.content_id)
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT LEFT(gm.content, 200) FROM group_messages gm WHERE gm.id = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
      WHEN 'seller_rating' THEN (SELECT sr.rater_id FROM seller_ratings sr WHERE sr.id = cr.content_id)
      WHEN 'group_message' THEN (SELECT gm.sender_id FROM group_messages gm WHERE gm.id = cr.content_id)
    END AS content_owner_id,
    NULL::text AS content_owner_name,
    CASE cr.content_type
      WHEN 'building_chat_link' THEN (
        SELECT mh.residence_hall
        FROM building_chat_links bcl
        JOIN master_housing mh ON mh.id = bcl.building_id
        WHERE bcl.id = cr.content_id
      )
      WHEN 'seller_rating' THEN (
        SELECT 'Rating of ' || COALESCE(sp.full_name, 'a seller')
        FROM seller_ratings sr
        LEFT JOIN profiles sp ON sp.id = sr.seller_id
        WHERE sr.id = cr.content_id
      )
      WHEN 'group_message' THEN (
        SELECT 'Sent by ' || COALESCE(sp.full_name, 'a member')
        FROM group_messages gm
        LEFT JOIN profiles sp ON sp.id = gm.sender_id
        WHERE gm.id = cr.content_id
      )
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN public.is_superadmin() THEN p_university_id
      ELSE public.current_university_id()
    END AS uid
  ) scope
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
    AND (
      (public.is_superadmin() AND p_university_id IS NULL)
      OR (cr.content_type = 'marketplace_listing' AND EXISTS (
            SELECT 1 FROM public.marketplace_listings ml
            WHERE ml.id = cr.content_id AND ml.university_id = scope.uid))
      OR (cr.content_type = 'roommate_post' AND EXISTS (
            SELECT 1 FROM public.roommate_search_posts rsp
            WHERE rsp.id = cr.content_id AND rsp.university_id = scope.uid))
      OR (cr.content_type = 'building_chat_link' AND EXISTS (
            SELECT 1 FROM public.building_chat_links bcl
            WHERE bcl.id = cr.content_id AND bcl.university_id = scope.uid))
      OR (cr.content_type = 'user' AND EXISTS (
            SELECT 1 FROM public.profiles rp
            WHERE rp.id = cr.content_id AND rp.university_id = scope.uid))
      OR (cr.content_type = 'seller_rating' AND EXISTS (
            SELECT 1 FROM public.seller_ratings sr
            JOIN public.profiles sp ON sp.id = sr.seller_id
            WHERE sr.id = cr.content_id AND sp.university_id = scope.uid))
      OR (cr.content_type = 'group_message' AND EXISTS (
            SELECT 1 FROM public.group_messages gm
            JOIN public.profiles sp ON sp.id = gm.sender_id
            WHERE gm.id = cr.content_id AND sp.university_id = scope.uid))
    )
  ORDER BY cr.created_at DESC;
$function$;

revoke execute on function public.get_content_reports(text, uuid) from public, anon;
grant execute on function public.get_content_reports(text, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.delete_group_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
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

  IF NOT (v_is_admin OR public.is_group_ra(v_group_id)) THEN
    RAISE EXCEPTION 'Not authorized: must be an RA of this room or an admin';
  END IF;

  DELETE FROM public.group_messages WHERE id = p_message_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_group_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_group_message(uuid) TO authenticated;
