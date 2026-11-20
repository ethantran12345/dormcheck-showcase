-- covers: 20260707202917_notifications.sql
-- Adversarial tests for 20260713000000_notifications.sql (backend + nudges).
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/notifications.test.sql

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so under the old idiom
-- session_user stayed superuser — and three shipped triggers (protect_profile_role,
-- protect_profile_is_admin, protect_listing_verified_at) EXEMPT session_user IN
-- ('postgres','supabase_admin'). A plain user's own row took role='superadmin' under the
-- harness and was refused through the real client path: the probe would have passed for the
-- wrong reason, in the direction that says "wide open" about a schema that is sound.
-- pg_temp._assume() reproduces the real client identity — session authorization AND role.
-- Do not go back to set_config('role', …); supabase/tests/harness_role_fidelity.test.sql
-- fails the suite the moment this idiom stops yielding session_user='authenticator'.
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  -- Step back to the connection's own login role first: from 'authenticator' nothing else
  -- is permitted. NULL resets the GUC, so this works whatever the runner connected as.
  PERFORM set_config('session_authorization', NULL, true);
  -- 'postgres' is the identity the seeding phases have always run under, and the one the
  -- three guards exempt, so seeding behaviour is unchanged. Everything else gets the real
  -- client shape: session_user='authenticator', which is NOT exempt.
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin. A '
           'postgres connection cannot set session_authorization, so the harness cannot '
           'reproduce a real client identity and every guard keyed on session_user would be '
           'silently exempt - the failure this helper exists to prevent.';
END $_assume$;

-- Baseline: seeding below runs as session_user='postgres', exactly as it did before this
-- helper existed. Transaction-local on purpose - a session-level set would drop superuser
-- for the whole connection and make the authenticator switch impossible.
SELECT pg_temp._assume('postgres');


-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- All emails @pitt.edu (check_pitt_email_on_signup); on_auth_user_created
-- creates the profiles rows, which we then shape per user.

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'notif-owner-a@pitt.edu',  crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('b2222222-2222-2222-2222-222222222222', 'notif-accept-b@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('c3333333-3333-3333-3333-333333333333', 'notif-joiner-c@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('d4444444-4444-4444-4444-444444444444', 'notif-resident-d@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('e5555555-5555-5555-5555-555555555555', 'notif-joiner-e@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('f6666666-6666-6666-6666-666666666666', 'notif-joiner-f@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('9a777777-7777-7777-7777-777777777777', 'notif-blocked-x@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated'),
  ('9b888888-8888-8888-8888-888888888888', 'notif-otheru-z@pitt.edu', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

-- Ensure profiles exist even if the signup trigger shape changes.
INSERT INTO public.profiles (id)
SELECT u FROM unnest(ARRAY[
  'a1111111-1111-1111-1111-111111111111',
  'b2222222-2222-2222-2222-222222222222',
  'c3333333-3333-3333-3333-333333333333',
  'd4444444-4444-4444-4444-444444444444',
  'e5555555-5555-5555-5555-555555555555',
  'f6666666-6666-6666-6666-666666666666',
  '9a777777-7777-7777-7777-777777777777',
  '9b888888-8888-8888-8888-888888888888'
]::uuid[]) AS u
ON CONFLICT (id) DO NOTHING;

-- Second university for scoping tests.
INSERT INTO public.universities (id, slug, name, short_name, is_active)
VALUES ('99999999-9999-4999-8999-999999999999', 'test-u', 'Test University', 'TestU', true)
ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles SET full_name = 'Owner A',  university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'a1111111-1111-1111-1111-111111111111';
UPDATE public.profiles SET full_name = 'Accepter B', university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'b2222222-2222-2222-2222-222222222222';
UPDATE public.profiles SET full_name = 'Joiner C',  university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'c3333333-3333-3333-3333-333333333333';
UPDATE public.profiles SET full_name = 'Resident D', university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'd4444444-4444-4444-4444-444444444444';
UPDATE public.profiles SET full_name = 'Joiner E',  university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'e5555555-5555-5555-5555-555555555555';
UPDATE public.profiles SET full_name = 'Joiner F',  university_id = '00000000-0000-4000-8000-000000000001' WHERE id = 'f6666666-6666-6666-6666-666666666666';
UPDATE public.profiles SET full_name = 'Blocked X', university_id = '00000000-0000-4000-8000-000000000001' WHERE id = '9a777777-7777-7777-7777-777777777777';
UPDATE public.profiles SET full_name = 'Other Z',   university_id = '99999999-9999-4999-8999-999999999999' WHERE id = '9b888888-8888-8888-8888-888888888888';

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN
    RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE
    RAISE NOTICE 'PASS: %', label;
  END IF;
END;
$$;

-- Run a statement as an authenticated user (auth.uid() = p_uid); returns SQLERRM or NULL.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- ── Nudge 1: roommate confirmed ──────────────────────────────────────────────
DO $$
DECLARE
  uid_a uuid := 'a1111111-1111-1111-1111-111111111111';
  uid_b uuid := 'b2222222-2222-2222-2222-222222222222';
  uid_c uuid := 'c3333333-3333-3333-3333-333333333333';
  uid_x uuid := '9a777777-7777-7777-7777-777777777777';
  g_roommate uuid;
  g_checklist uuid;
  n integer;
  pay jsonb;
BEGIN
  -- Roommate group owned by A (owner member row inserted accepted, like create_ranking_group).
  INSERT INTO public.ranking_collaborations (owner_id, group_name, status, group_type, university_id)
  VALUES (uid_a, 'Test Roomies', 'accepted', 'roommate', '00000000-0000-4000-8000-000000000001')
  RETURNING id INTO g_roommate;
  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (g_roommate, uid_a, 'accepted', 'owner');

  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('owner self row -> no notification', n = 0, 'got ' || n);

  -- Pending row for B; no notification until accepted.
  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (g_roommate, uid_b, 'pending', 'collaborator');
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('pending insert -> no notification', n = 0, 'got ' || n);

  -- Accept (direct-update path, ReceivedInvitations style).
  UPDATE public.ranking_group_members SET status = 'accepted'
  WHERE group_id = g_roommate AND user_id = uid_b;
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_a AND type = 'roommate_invite_accepted';
  PERFORM _assert('pending->accepted -> owner notified once', n = 1, 'got ' || n);

  SELECT payload INTO pay FROM public.notifications
  WHERE recipient_id = uid_a AND type = 'roommate_invite_accepted';
  PERFORM _assert('payload has actor + group facts',
    pay ->> 'actor_id' = uid_b::text
      AND pay ->> 'actor_name' = 'Accepter B'
      AND pay ->> 'group_id' = g_roommate::text
      AND pay ->> 'group_type' = 'roommate',
    pay::text);

  -- Idempotent re-accept (invite-link upsert re-fires with accepted->accepted).
  UPDATE public.ranking_group_members SET status = 'accepted'
  WHERE group_id = g_roommate AND user_id = uid_b;
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('re-accept -> no second notification', n = 1, 'got ' || n);

  -- Direct insert as accepted (invite-link fresh-join path).
  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (g_roommate, uid_c, 'accepted', 'collaborator');
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('fresh accepted insert -> owner notified', n = 2, 'got ' || n);

  -- Non-roommate group accept -> no notification.
  INSERT INTO public.ranking_collaborations (owner_id, group_name, status, group_type, university_id)
  VALUES (uid_a, 'Test Checklist', 'accepted', 'checklist', '00000000-0000-4000-8000-000000000001')
  RETURNING id INTO g_checklist;
  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (g_checklist, uid_b, 'accepted', 'collaborator');
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('non-roommate accept -> no notification', n = 2, 'got ' || n);

  -- Blocked pair -> no notification.
  INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES (uid_a, uid_x);
  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  VALUES (g_roommate, uid_x, 'accepted', 'collaborator');
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_a;
  PERFORM _assert('blocked accepter -> no notification', n = 2, 'got ' || n);
END;
$$;

-- ── Nudge 2: building digest ─────────────────────────────────────────────────
DO $$
DECLARE
  uid_c uuid := 'c3333333-3333-3333-3333-333333333333';
  uid_d uuid := 'd4444444-4444-4444-4444-444444444444';
  uid_e uuid := 'e5555555-5555-5555-5555-555555555555';
  uid_f uuid := 'f6666666-6666-6666-6666-666666666666';
  uid_z uuid := '9b888888-8888-8888-8888-888888888888';
  n integer;
  pay jsonb;
  err text;
BEGIN
  -- D is the pre-existing opted-in resident of the test tower. (No one else is
  -- opted in yet, so D's own opt-in notifies nobody.)
  UPDATE public.profiles
  SET current_dorm = 'Notif Test Tower Q7', housing_type = 'on-campus', show_in_building = true
  WHERE id = uid_d;
  -- Scoped to fixture users so pre-existing app data can't fail the assert.
  SELECT count(*) INTO n FROM public.notifications
  WHERE type = 'building_new_residents'
    AND recipient_id IN (uid_c, uid_d, uid_e, uid_f, uid_z);
  PERFORM _assert('first opt-in with no peers -> no digest rows', n = 0, 'got ' || n);

  -- Z: same dorm string but other university, opted in -> must never be notified.
  UPDATE public.profiles
  SET current_dorm = 'Notif Test Tower Q7', housing_type = 'on-campus', show_in_building = true
  WHERE id = uid_z;
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents';
  PERFORM _assert('other-university joiner -> D not notified', n = 0, 'got ' || n);

  -- C opts in with case/whitespace-varied dorm -> D gets digest count 1; Z gets nothing.
  UPDATE public.profiles
  SET current_dorm = '  notif  test  tower   q7 ', housing_type = 'on-campus', show_in_building = true
  WHERE id = uid_c;
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('normalized dorm match -> D has one unread digest', n = 1, 'got ' || n);
  SELECT payload INTO pay FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('digest count 1 with C as joiner',
    (pay ->> 'count')::int = 1 AND pay -> 'joiner_ids' ? uid_c::text, pay::text);
  SELECT count(*) INTO n FROM public.notifications WHERE recipient_id = uid_z;
  PERFORM _assert('cross-university recipient excluded', n = 0, 'got ' || n);

  -- E opts in -> same unread digest increments to 2 (no second row).
  UPDATE public.profiles
  SET current_dorm = 'Notif Test Tower Q7', housing_type = 'on-campus', show_in_building = true
  WHERE id = uid_e;
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents';
  PERFORM _assert('second joiner -> still one digest row', n = 1, 'got ' || n);
  SELECT payload INTO pay FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('digest count bumped to 2',
    (pay ->> 'count')::int = 2
      AND jsonb_array_length(pay -> 'joiner_ids') = 2
      AND pay -> 'joiner_ids' ? uid_e::text, pay::text);

  -- E re-toggles opt-in -> idempotent, count stays 2.
  UPDATE public.profiles SET show_in_building = false WHERE id = uid_e;
  UPDATE public.profiles SET show_in_building = true  WHERE id = uid_e;
  SELECT payload INTO pay FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('re-toggle does not inflate count', (pay ->> 'count')::int = 2, pay::text);

  -- D marks all read (as authenticated D), then F joins -> fresh digest count 1.
  err := pg_temp._exec_as(uid_d, 'SELECT public.mark_notifications_read()');
  PERFORM _assert('mark_notifications_read as recipient succeeds', err IS NULL, coalesce(err, ''));
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_d AND read_at IS NULL;
  PERFORM _assert('all read -> zero unread', n = 0, 'got ' || n);

  UPDATE public.profiles
  SET current_dorm = 'Notif Test Tower Q7', housing_type = 'on-campus', show_in_building = true
  WHERE id = uid_f;
  SELECT count(*) INTO n FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('post-read joiner -> fresh unread digest', n = 1, 'got ' || n);
  SELECT payload INTO pay FROM public.notifications
  WHERE recipient_id = uid_d AND type = 'building_new_residents' AND read_at IS NULL;
  PERFORM _assert('fresh digest restarts at count 1',
    (pay ->> 'count')::int = 1 AND pay -> 'joiner_ids' ? uid_f::text, pay::text);
END;
$$;

-- ── RLS / privileges ─────────────────────────────────────────────────────────
DO $$
DECLARE
  uid_a uuid := 'a1111111-1111-1111-1111-111111111111';
  uid_d uuid := 'd4444444-4444-4444-4444-444444444444';
  n integer;
  err text;
BEGIN
  -- Recipient sees only own rows.
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.notifications;
  PERFORM pg_temp._assume('postgres');
  PERFORM _assert('RLS: A sees only own rows',
    n = (SELECT count(*) FROM public.notifications WHERE recipient_id = uid_a)
    AND n > 0, 'saw ' || n);

  -- Forged insert fails.
  err := pg_temp._exec_as(uid_a,
    'INSERT INTO public.notifications (recipient_id, type) ' ||
    'VALUES (''' || uid_d || ''', ''roommate_invite_accepted'')');
  PERFORM _assert('RLS: client INSERT denied', err IS NOT NULL, coalesce(err, 'succeeded!'));

  -- Direct update/delete fail (only the RPC mutates read_at).
  err := pg_temp._exec_as(uid_a, 'UPDATE public.notifications SET read_at = now()');
  PERFORM _assert('RLS: client UPDATE denied', err IS NOT NULL, coalesce(err, 'succeeded!'));
  err := pg_temp._exec_as(uid_a, 'DELETE FROM public.notifications');
  PERFORM _assert('RLS: client DELETE denied', err IS NOT NULL, coalesce(err, 'succeeded!'));

  -- Writer + RPC blocked for anon.
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.mark_notifications_read();
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('anon mark_notifications_read denied', false, 'succeeded!');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('anon mark_notifications_read denied', true, SQLERRM);
  END;
  BEGIN
    PERFORM pg_temp._assume('authenticated');
    PERFORM public._create_notification(uid_a, 'roommate_invite_accepted', '{}'::jsonb);
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('authenticated _create_notification denied', false, 'succeeded!');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('authenticated _create_notification denied', true, SQLERRM);
  END;
END;
$$;

SELECT name, pass, detail FROM test_results ORDER BY name;

DO $$
DECLARE
  failures integer;
BEGIN
  SELECT count(*) INTO failures FROM test_results WHERE NOT pass;
  IF failures > 0 THEN
    RAISE EXCEPTION '% notifications test(s) failed', failures;
  END IF;
  RAISE NOTICE 'All % tests passed', (SELECT count(*) FROM test_results);
END;
$$;

ROLLBACK;
