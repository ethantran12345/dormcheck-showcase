-- In-app "you've been invited" notification for roommate/collaboration groups.
-- The recipient of a pending ranking_group_members invite previously got only a
-- best-effort email; their notifications bell stayed empty. Add a type + an
-- AFTER INSERT trigger mirroring notify_group_invite_accepted (block-aware,
-- failure-isolated so a nudge can never block the invite insert). The client
-- renders it via toAppNotification('roommate_invited'), deep-linking to
-- /checklist where ReceivedInvitations surfaces Accept/Decline.
-- Expand-only. Applied to PROD via Supabase MCP apply_migration 2026-07-14.

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'roommate_invite_accepted', 'building_new_residents', 'admin_announcement',
    'report_resolution', 'listing_freshness', 'roommate_invited'
  ));

CREATE OR REPLACE FUNCTION public.notify_group_member_invited()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group public.ranking_collaborations%ROWTYPE;
  v_owner_name text;
BEGIN
  -- Fresh pending invite to a collaborator only (owner's own accepted row skipped).
  IF NEW.status <> 'pending' OR NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group FROM public.ranking_collaborations WHERE id = NEW.group_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Never notify the group owner about their own group.
  IF NEW.user_id = v_group.owner_id THEN
    RETURN NEW;
  END IF;

  -- Respect blocks in both directions.
  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v_group.owner_id AND b.blocked_id = NEW.user_id)
       OR (b.blocker_id = NEW.user_id AND b.blocked_id = v_group.owner_id)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_owner_name FROM public.profiles WHERE id = v_group.owner_id;

  PERFORM public._create_notification(
    NEW.user_id,
    'roommate_invited',
    jsonb_build_object(
      'actor_id',   v_group.owner_id,
      'actor_name', coalesce(nullif(trim(v_owner_name), ''), 'A roommate'),
      'group_id',   v_group.id,
      'group_name', v_group.group_name,
      'group_type', v_group.group_type,
      'dorm_name',  v_group.dorm_name,
      'term',       v_group.term
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_group_member_invited failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_group_member_invited() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_group_member_invited ON public.ranking_group_members;
CREATE TRIGGER trg_notify_group_member_invited
  AFTER INSERT ON public.ranking_group_members
  FOR EACH ROW
  WHEN (NEW.status = 'pending' AND NEW.role IS DISTINCT FROM 'owner')
  EXECUTE FUNCTION public.notify_group_member_invited();
