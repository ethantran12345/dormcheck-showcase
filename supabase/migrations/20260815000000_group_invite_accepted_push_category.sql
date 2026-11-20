-- Email v7 / housing_groups wiring: the "your invite was accepted" push now
-- rides the 'housing_groups' notification category instead of 'movein', so the
-- housing_groups settings toggle actually controls it (previously it drove
-- nothing). CREATE OR REPLACE of notify_group_invite_accepted from
-- 20260711232304_trigger_push.sql — body identical except the dispatch_push
-- category argument. Push copy/route unchanged. Idempotent, non-destructive.
-- PROD APPLY: via Supabase MCP apply_migration (no seed/backfill needed).

CREATE OR REPLACE FUNCTION public.notify_group_invite_accepted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group public.ranking_collaborations%ROWTYPE;
  v_actor_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group
  FROM public.ranking_collaborations WHERE id = NEW.group_id;
  IF NOT FOUND OR v_group.group_type <> 'roommate' THEN
    RETURN NEW;
  END IF;

  IF NEW.role = 'owner' OR NEW.user_id = v_group.owner_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v_group.owner_id AND b.blocked_id = NEW.user_id)
       OR (b.blocker_id = NEW.user_id AND b.blocked_id = v_group.owner_id)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = NEW.user_id;
  v_actor_name := coalesce(nullif(trim(v_actor_name), ''), 'A roommate');

  PERFORM public._create_notification(
    v_group.owner_id,
    'roommate_invite_accepted',
    jsonb_build_object(
      'actor_id',   NEW.user_id,
      'actor_name', v_actor_name,
      'group_id',   v_group.id,
      'group_name', v_group.group_name,
      'group_type', v_group.group_type
    )
  );

  PERFORM private.dispatch_push(
    v_group.owner_id,
    'housing_groups',
    'You''ve got a roommate',
    v_actor_name || ' confirmed you',
    jsonb_build_object(
      'type', 'roommate_confirm',
      'route', '/checklist?confirmRoommates=1',
      'group_id', v_group.id
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_group_invite_accepted failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
