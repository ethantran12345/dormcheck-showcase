-- In-app notifications backend + the two move-in nudges (move-in arc, handoff 3).
-- Expand-only. Creates the notifications table (recipient-owned, server-write-only),
-- a mark-as-read RPC, realtime publication membership for the unread badge, and
-- two nudge triggers: "X confirmed you as a roommate" (ranking_group_members
-- accept transition, both accept paths) and a cron-free rolling digest of
-- "N new people joined your building" (profiles building opt-in).
-- In-app is the primary channel; no email fan-out in v1.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712000000.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL
    CHECK (type IN ('roommate_invite_accepted', 'building_new_residents')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  university_id uuid REFERENCES public.universities(id)
);

-- Dropdown query: recent notifications for me, newest first.
CREATE INDEX idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

-- Unread-badge count.
CREATE INDEX idx_notifications_recipient_unread
  ON public.notifications (recipient_id) WHERE read_at IS NULL;

-- Digest invariant: at most ONE unread building digest per recipient. Also the
-- ON CONFLICT arbiter that makes the nudge-2 upsert race-free.
CREATE UNIQUE INDEX idx_notifications_unread_building_digest
  ON public.notifications (recipient_id)
  WHERE type = 'building_new_residents' AND read_at IS NULL;

-- ── RLS: recipient-only read; server-only writes ─────────────────────────────
-- No INSERT/UPDATE/DELETE policies: rows are written only by the SECURITY
-- DEFINER functions below (owned by the table owner, which bypasses RLS), so a
-- user cannot forge notifications for others.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = recipient_id);

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;

-- ── Internal writer ──────────────────────────────────────────────────────────
-- university_id derives from the recipient's profile (user-owned-table
-- convention, docs/multi-university.md). Callable only by service_role and by
-- the SECURITY DEFINER trigger functions below (which execute as the owner).

CREATE FUNCTION public._create_notification(
  p_recipient uuid,
  p_type text,
  p_payload jsonb
)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.notifications (recipient_id, type, payload, university_id)
  SELECT p_recipient, p_type, p_payload,
         (SELECT university_id FROM public.profiles WHERE id = p_recipient);
$$;

REVOKE EXECUTE ON FUNCTION public._create_notification(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._create_notification(uuid, text, jsonb)
  TO service_role;

-- ── Mark-as-read RPC ─────────────────────────────────────────────────────────
-- An RPC rather than an UPDATE policy so read_at is the only mutable column by
-- construction. p_ids NULL = mark all; an id array enables per-notification
-- marking later without a migration.

CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.notifications
  SET read_at = now()
  WHERE recipient_id = v_uid
    AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated, service_role;

-- ── Nudge 1: roommate confirmed ──────────────────────────────────────────────
-- One AFTER trigger catches both accept paths with no edits to either: the
-- join_group_via_invite upsert (20260712000000) and the direct client UPDATE
-- in ReceivedInvitations. Roommate groups only in v1 (payload keeps group_type
-- so widening later is a WHERE-clause change).

CREATE FUNCTION public.notify_group_invite_accepted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group public.ranking_collaborations%ROWTYPE;
  v_actor_name text;
BEGIN
  -- Only a transition INTO 'accepted' (idempotent re-accepts skipped; the
  -- invite-link upsert re-fires with OLD.status already 'accepted').
  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_group
  FROM public.ranking_collaborations WHERE id = NEW.group_id;
  IF NOT FOUND OR v_group.group_type <> 'roommate' THEN
    RETURN NEW;
  END IF;

  -- Never self-notify: the owner's own accepted row is inserted at group
  -- creation (create_ranking_group).
  IF NEW.role = 'owner' OR NEW.user_id = v_group.owner_id THEN
    RETURN NEW;
  END IF;

  -- Respect blocks both directions (the direct-update accept path has no
  -- block check of its own).
  IF EXISTS (
    SELECT 1 FROM public.blocked_users b
    WHERE (b.blocker_id = v_group.owner_id AND b.blocked_id = NEW.user_id)
       OR (b.blocker_id = NEW.user_id AND b.blocked_id = v_group.owner_id)
  ) THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = NEW.user_id;

  PERFORM public._create_notification(
    v_group.owner_id,
    'roommate_invite_accepted',
    jsonb_build_object(
      'actor_id',   NEW.user_id,
      'actor_name', coalesce(nullif(trim(v_actor_name), ''), 'A roommate'),
      'group_id',   v_group.id,
      'group_name', v_group.group_name,
      'group_type', v_group.group_type
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A nudge failure must never block an accept.
  RAISE WARNING 'notify_group_invite_accepted failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_group_invite_accepted
  AFTER INSERT OR UPDATE OF status ON public.ranking_group_members
  FOR EACH ROW
  WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION public.notify_group_invite_accepted();

-- ── Nudge 2: new opted-in building resident (rolling digest, cron-free) ──────
-- On a profile becoming a visible on-campus resident of a building, upsert into
-- each existing opted-in resident's single UNREAD digest row: all joins while a
-- digest is unread collapse into one notification (count + joiner_ids in
-- payload); reading it closes the window (the row leaves the partial unique
-- index) and the next join starts a fresh digest. joiner_ids membership makes
-- re-toggles idempotent. Building match mirrors get_building_residents
-- (20260711000000): normalized current_dorm + on-campus + same university.

CREATE FUNCTION public.notify_building_new_resident()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dorm text;
BEGIN
  v_dorm := lower(btrim(regexp_replace(coalesce(NEW.current_dorm, ''), '\s+', ' ', 'g')));
  IF v_dorm = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, type, payload, university_id)
  SELECT
    r.id,
    'building_new_residents',
    jsonb_build_object(
      'building_name', NEW.current_dorm,
      'count',         1,
      'joiner_ids',    jsonb_build_array(NEW.id),
      'window_start',  now()
    ),
    r.university_id
  FROM public.profiles r
  WHERE r.id <> NEW.id
    AND r.show_in_building = true
    AND r.housing_type = 'on-campus'
    AND lower(btrim(regexp_replace(coalesce(r.current_dorm, ''), '\s+', ' ', 'g'))) = v_dorm
    AND r.university_id IS NOT DISTINCT FROM NEW.university_id
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = r.id AND b.blocked_id = NEW.id)
         OR (b.blocker_id = NEW.id AND b.blocked_id = r.id)
    )
  ON CONFLICT (recipient_id) WHERE type = 'building_new_residents' AND read_at IS NULL
  DO UPDATE SET
    payload = CASE
      WHEN notifications.payload -> 'joiner_ids' ? (excluded.payload #>> '{joiner_ids,0}')
        THEN notifications.payload
      ELSE jsonb_set(
             jsonb_set(
               notifications.payload,
               '{joiner_ids}',
               (notifications.payload -> 'joiner_ids')
                 || (excluded.payload -> 'joiner_ids')
             ),
             '{count}',
             to_jsonb(jsonb_array_length(notifications.payload -> 'joiner_ids') + 1)
           )
    END,
    created_at = CASE
      WHEN notifications.payload -> 'joiner_ids' ? (excluded.payload #>> '{joiner_ids,0}')
        THEN notifications.created_at
      ELSE now()
    END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A nudge failure must never block a profile save.
  RAISE WARNING 'notify_building_new_resident failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_building_new_resident
  AFTER UPDATE OF show_in_building, current_dorm, housing_type ON public.profiles
  FOR EACH ROW
  WHEN (
    NEW.show_in_building = true
    AND NEW.current_dorm IS NOT NULL
    AND NEW.housing_type = 'on-campus'
    AND (
      OLD.show_in_building IS DISTINCT FROM true
      OR OLD.current_dorm IS DISTINCT FROM NEW.current_dorm
      OR OLD.housing_type IS DISTINCT FROM NEW.housing_type
    )
  )
  EXECUTE FUNCTION public.notify_building_new_resident();

-- Trigger functions are never called directly; strip default EXECUTE so they
-- don't surface as callable RPCs (advisor 0028/0029).
REVOKE EXECUTE ON FUNCTION public.notify_group_invite_accepted() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_building_new_resident() FROM PUBLIC, anon, authenticated;

-- ── Realtime (unread badge) ──────────────────────────────────────────────────
-- postgres_changes honors RLS: subscribers only receive rows their SELECT
-- policy allows. First table this repo adds to the publication.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;
