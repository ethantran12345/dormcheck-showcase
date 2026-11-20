-- Trigger-driven push for the two move-in nudges (push handoff, phase 2a).
-- Expand-only. Re-enables pg_net (dropped in 20260515044633), adds a private
-- config table holding the send-push function URL + shared token (seeded
-- MANUALLY per environment — never committed), a fire-and-forget
-- private.dispatch_push() helper, and redefines the two nudge trigger
-- functions from 20260713000000_notifications.sql to also push.
-- A push failure must never block the accept / profile save: dispatch_push
-- swallows every exception with RAISE WARNING, and net.http_post is async.
-- PROD APPLY: via Supabase MCP apply_migration; then INSERT the config row.

-- pg_net is not relocatable; it installs into its own `net` schema.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Private config (server-only; no client grants) ───────────────────────────

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Single row: id is a bool PK defaulting true with CHECK, so a second row is
-- impossible. Seed per environment:
--   INSERT INTO private.push_config (supabase_url, send_push_token)
--   VALUES ('https://<ref>.supabase.co', '<SEND_PUSH_AUTH_TOKEN>');
CREATE TABLE private.push_config (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  supabase_url    text NOT NULL,
  send_push_token text NOT NULL
);
REVOKE ALL ON TABLE private.push_config FROM PUBLIC, anon, authenticated;

-- ── Dispatcher ────────────────────────────────────────────────────────────────
-- Mirrors shouldSendPush() (api/_lib/notificationPrefs.ts): permissive default,
-- a push category is off only when notification_prefs->push-><category> is
-- exactly false. net.http_post is async (result lands in net._http_response);
-- delivery failures are invisible here by design.

CREATE FUNCTION private.dispatch_push(
  p_user uuid,
  p_category text,
  p_title text,
  p_body text,
  p_data jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'private', 'public', 'net'
AS $$
DECLARE
  v_cfg private.push_config%ROWTYPE;
  v_prefs jsonb;
BEGIN
  SELECT * INTO v_cfg FROM private.push_config WHERE id;
  IF NOT FOUND THEN
    RAISE WARNING 'dispatch_push: private.push_config not seeded; skipping';
    RETURN;
  END IF;

  SELECT notification_prefs INTO v_prefs FROM public.profiles WHERE id = p_user;
  IF (v_prefs -> 'push' ->> p_category) = 'false' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_cfg.supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cfg.send_push_token
    ),
    body := jsonb_build_object(
      'user_id', p_user,
      'title', p_title,
      'body', p_body,
      'data', p_data
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'dispatch_push failed for %: %', p_user, SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.dispatch_push(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ── Nudge 1: roommate confirmed — now also pushes ────────────────────────────
-- Body identical to 20260713000000 plus the dispatch_push call.

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
    'movein',
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

-- ── Nudge 2: building digest — now also pushes ───────────────────────────────
-- Recipients are captured BEFORE the upsert, excluding anyone whose unread
-- digest already counts this joiner (re-toggle idempotency, mirroring the
-- payload CASE). After the upsert each recipient gets a push with their own
-- digest count.

CREATE OR REPLACE FUNCTION public.notify_building_new_resident()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dorm text;
  v_push_recipients uuid[];
  v_recipient uuid;
  v_count int;
BEGIN
  v_dorm := lower(btrim(regexp_replace(coalesce(NEW.current_dorm, ''), '\s+', ' ', 'g')));
  IF v_dorm = '' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(r.id) INTO v_push_recipients
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
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_id = r.id
        AND n.type = 'building_new_residents'
        AND n.read_at IS NULL
        AND n.payload -> 'joiner_ids' ? NEW.id::text
    );

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

  FOREACH v_recipient IN ARRAY coalesce(v_push_recipients, '{}'::uuid[]) LOOP
    SELECT (n.payload ->> 'count')::int INTO v_count
    FROM public.notifications n
    WHERE n.recipient_id = v_recipient
      AND n.type = 'building_new_residents'
      AND n.read_at IS NULL;
    v_count := coalesce(v_count, 1);

    PERFORM private.dispatch_push(
      v_recipient,
      'movein',
      NEW.current_dorm,
      CASE WHEN v_count = 1
        THEN '1 new person joined ' || NEW.current_dorm
        ELSE v_count || ' new people joined ' || NEW.current_dorm
      END,
      jsonb_build_object(
        'type', 'building_digest',
        'route', '/my-home?dormTab=people',
        'count', v_count
      )
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_building_new_resident failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
