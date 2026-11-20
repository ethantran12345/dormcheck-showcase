-- Security Pass 2a hardening.
-- Pure database hardening only. No profiles SELECT policy changes and no
-- public_profiles view changes are included here; those are deferred to Pass 2c.

-- ---------------------------------------------------------------------------
-- 1. Protect profiles.is_admin from self-escalation.
-- Adds a BEFORE UPDATE trigger that blocks is_admin changes unless the caller
-- is acting as postgres/service_role, or is an existing admin promoting a
-- different user. Self-modification (including admin self-demotion) is always
-- blocked; bootstrap and demotion happen via service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_is_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
    -- Bypass for direct DB connections (postgres/supabase_admin) and the
    -- service_role JWT path. session_user is the original session role and
    -- is unaffected by SECURITY DEFINER, unlike current_user.
    IF session_user IN ('postgres', 'supabase_admin')
       OR auth.role() = 'service_role' THEN
      RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Not authorized to modify is_admin';
    END IF;

    IF auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'Cannot modify your own is_admin status';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.is_admin = true
    ) THEN
      RAISE EXCEPTION 'Only existing admins may modify is_admin';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_is_admin ON public.profiles;
CREATE TRIGGER tr_protect_is_admin
BEFORE UPDATE OF is_admin ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_is_admin();

-- ---------------------------------------------------------------------------
-- 2. Drop the unsafe create_ranking_group(text, uuid, uuid[]) overload.
-- This overload allowed callers to impersonate an arbitrary owner_id.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_ranking_group(text, uuid, uuid[]);

-- ---------------------------------------------------------------------------
-- 3. Trigger-only SECURITY DEFINER functions should not be callable as RPCs.
-- Revoke EXECUTE from PUBLIC (default grant in Postgres), anon, and
-- authenticated. No explicit GRANT follows: triggers fire as the table owner
-- regardless of EXECUTE grants, so revoking does not break trigger behavior.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.eject_from_unmatched_building_chats() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_checklist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.roommate_search_interests_bump_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.roommate_search_posts_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_personal_to_group() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_group_rankings_on_member_accept() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_building_chat_links_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_business_listings_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_conversation_timestamp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_pitt_email() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Intentional SECURITY DEFINER RPCs must not be callable by anon or
-- PUBLIC. Revoke from PUBLIC + anon + authenticated (to clear default grants),
-- then GRANT EXECUTE back to authenticated only.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.am_i_in_group_with_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.am_i_in_group_with_user(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.check_group_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_group_access(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.clear_group_checklist(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_group_checklist(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_ranking_group(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ranking_group(text, uuid[]) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.decrement_product_hearts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_product_hearts(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_building_chat_links(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_building_chat_links(bigint, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_building_chats(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_building_chats(bigint) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_content_reports(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_content_reports(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_dorm_review_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dorm_review_stats() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_group_checklist(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_checklist(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_groups_i_own() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_groups_i_own() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_accepted_group_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_accepted_group_ids() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_all_group_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_all_group_ids() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_product_hearts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_product_hearts(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_chat_group_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_group_member(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reset_checklist_custom(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_checklist_custom(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reset_checklist_defaults(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_checklist_defaults(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_current_dorm_matches_building(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_current_dorm_matches_building(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Harden clear_group_checklist.
-- Semantic fix: the old implementation deleted every checklist row owned by
-- the group's members, including personal lists. Group resets should affect
-- only the shared checklist rows for target_group_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_group_checklist(target_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    EXISTS (
      SELECT 1
      FROM public.ranking_group_members rgm
      WHERE rgm.group_id = target_group_id
        AND rgm.user_id = v_uid
        AND rgm.status = 'accepted'
    )
    OR EXISTS (
      SELECT 1
      FROM public.ranking_collaborations rc
      WHERE rc.id = target_group_id
        AND rc.owner_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to clear this group checklist';
  END IF;

  DELETE FROM public.checklist_items
  WHERE group_id = target_group_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Add authentication guards to product heart counters.
-- These remain authenticated RPCs for now, but anonymous callers are blocked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_product_hearts(product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.amazon_products
  SET hearts = hearts + 1
  WHERE id = product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_product_hearts(product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.amazon_products
  SET hearts = GREATEST(hearts - 1, 0)
  WHERE id = product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. sync_group_rankings_from_members has no client call path in src/,
-- supabase/functions/, or api/. Treat it as trigger-only in practice and
-- revoke EXECUTE from PUBLIC, anon, and authenticated. No explicit GRANT - 
-- this fires only via the AFTER INSERT/UPDATE trigger on
-- ranking_group_members.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sync_group_rankings_from_members(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Replace permissive INSERT/UPDATE policies on group_dorm_rankings with
-- membership-gated checks against ranking_group_members.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can insert group rankings" ON public.group_dorm_rankings;
CREATE POLICY "Members can insert group rankings"
ON public.group_dorm_rankings
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ranking_group_members rgm
    WHERE rgm.group_id = group_dorm_rankings.group_id
      AND rgm.user_id = auth.uid()
      AND rgm.status = 'accepted'
  )
);

DROP POLICY IF EXISTS "Members can update group rankings" ON public.group_dorm_rankings;
CREATE POLICY "Members can update group rankings"
ON public.group_dorm_rankings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.ranking_group_members rgm
    WHERE rgm.group_id = group_dorm_rankings.group_id
      AND rgm.user_id = auth.uid()
      AND rgm.status = 'accepted'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.ranking_group_members rgm
    WHERE rgm.group_id = group_dorm_rankings.group_id
      AND rgm.user_id = auth.uid()
      AND rgm.status = 'accepted'
  )
);

-- ---------------------------------------------------------------------------
-- 9. Remaining mutable search_path cleanup for SECURITY DEFINER functions
-- flagged by the Supabase linter and kept alive in Pass 2a.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_personal_to_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- If a user updates their personal rank, update the group rank if it exists.
  UPDATE public.group_dorm_rankings
  SET rank_order = NEW.rank_order
  WHERE dorm_id = NEW.dorm_id
    AND group_id IN (
      SELECT group_id
      FROM public.ranking_group_members
      WHERE user_id = NEW.user_id
        AND status = 'accepted'
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_pitt_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND NEW.email !~* '^[A-Za-z0-9._%+-]+@pitt\.edu$' THEN
    RAISE EXCEPTION 'Registration is restricted to University of Pittsburgh (@pitt.edu) email addresses only.';
  END IF;

  RETURN NEW;
END;
$$;
